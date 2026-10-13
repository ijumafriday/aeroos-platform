import { createHash, createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, Controller, Get, Inject, Param, ParseIntPipe, Post, Query, DefaultValuePipe, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { AuditEntryDto, AuditVerifyDto, NotificationDto } from '@aeroos/contracts';
import type { KeyService } from '@aeroos/signing';
import { CurrentPrincipal, Public, type Principal } from './auth/principal';
import { AuthzService } from './authz/authz.service';
import { AuditQuery } from './audit/audit.service';
import { DocumentsService } from './storage/documents.service';
import { AnchorService } from './audit/anchor.service';
import { InternalGuard } from './auth/guards';
import { ObjectStore } from './storage/object-store';
import { DB_TOKEN, type ModuleDb } from './database/module-db';
import { KEY_SERVICE } from './keys/keys.provider';
import { NotificationsService } from './notifications/notifications.service';
import { TemporalService } from './workflows/temporal.service';

/** Version of the running build (package.json of the deployed API), shown by /api/health and smoke.sh. */
const APP_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

export const CHAINS = ['camo', 'amo', 'org', 'ops', 'compliance', 'documents'];

@Controller('health')
export class HealthController {
  constructor(@Inject(DB_TOKEN.platform) private readonly db: ModuleDb, private readonly temporal: TemporalService, private readonly store: ObjectStore) {}

  /** Process liveness: intentionally dependency-free so Kubernetes does not restart a healthy process during an upstream outage. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', version: APP_VERSION, at: new Date().toISOString() };
  }

  /** Readiness: all dependencies required for regulated writes must be reachable. */
  @Public()
  @Get('ready')
  async ready() {
    const within = <T>(p: Promise<T>, timeoutMs = 1000) => Promise.race([p.then(v => v === false ? false : true).catch(() => false), new Promise<boolean>(r => setTimeout(() => r(false), timeoutMs))]);
    const [database, temporal, storage] = await Promise.all([within(this.db.ping()), within(this.temporal.ready()), within(this.store.ping())]);
    if (!database || !temporal || !storage) {
      throw new ServiceUnavailableException(`Not ready: database=${database ? 'up' : 'down'}, temporal=${temporal ? 'up' : 'down'}, storage=${storage ? 'up' : 'down'}`);
    }
    return { status: 'ready', version: APP_VERSION, database: 'up', temporal: 'up', storage: 'up', at: new Date().toISOString() };
  }

  /** Compatibility endpoint used by existing smoke tooling; reports dependency state without hiding degradation. */
  @Public()
  @Get()
  async health() {
    await this.db.ping();
    const within = (p: Promise<boolean>) => Promise.race([p, new Promise<boolean>(r => setTimeout(() => r(false), 500))]);
    const [temporal, storage] = await Promise.all([within(this.temporal.ready()), within(this.store.ping())]);
    return { status: 'ok', version: APP_VERSION, database: 'up', temporal: temporal ? 'up' : 'connecting', storage: storage ? 'up' : 'connecting', at: new Date().toISOString() };
  }
}

@Controller('platform')
export class AuditController {
  constructor(private readonly audit: AuditQuery, private readonly anchors: AnchorService, private readonly authz: AuthzService, @Inject(KEY_SERVICE) private readonly keys: KeyService) {}

  @Get('audit')
  async recent(
    @CurrentPrincipal() p: Principal,
    @Query('chain', new DefaultValuePipe('camo')) chain: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number
  ): Promise<AuditEntryDto[]> {
    await this.authz.check(p, { kind: 'audit_chain', id: chain, attr: { operatorId: p.operatorId } }, 'read');
    return this.audit.recent(this.chain(chain), p.operatorId, Math.min(500, Math.max(1, limit)));
  }

  @Get('audit/verify')
  async verify(@CurrentPrincipal() p: Principal, @Query('chain', new DefaultValuePipe('camo')) chain: string): Promise<AuditVerifyDto> {
    await this.authz.check(p, { kind: 'audit_chain', id: chain, attr: { operatorId: p.operatorId } }, 'verify');
    const c = this.chain(chain);
    const [r, anchor] = await Promise.all([this.audit.verify(c), this.anchors.check(c)]);
    return { ...r, anchor };
  }

  /** Anchor this chain's head now instead of waiting for the hourly workflow. */
  @Post('audit/anchor')
  async anchor(@CurrentPrincipal() p: Principal, @Query('chain', new DefaultValuePipe('camo')) chain: string) {
    await this.authz.check(p, { kind: 'audit_chain', id: chain, attr: { operatorId: p.operatorId } }, 'anchor');
    return this.anchors.anchor(this.chain(chain));
  }

  /** Public key for independent verification of signatures by auditors and authorities. */
  @Get('signing-key')
  async signingKey() {
    const publicKeyPem = await this.keys.publicKeyPem();
    // SHA-256 of the DER SubjectPublicKeyInfo — what the evidence-pack verifier prints and checks (--fingerprint).
    const fingerprint = createHash('sha256').update(createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' })).digest('hex');
    return { keyId: this.keys.keyId, alg: 'Ed25519', publicKeyPem, fingerprint };
  }

  private chain(c: string) {
    if (!CHAINS.includes(c)) throw new BadRequestException(`Unknown audit chain "${c}" (one of ${CHAINS.join(', ')})`);
    return c;
  }
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal): Promise<NotificationDto[]> {
    return this.notifications.list(p.operatorId, p.subject);
  }

  @Post('read-all')
  async readAll(@CurrentPrincipal() p: Principal) {
    await this.notifications.markAllRead(p.operatorId, p.subject);
    return { ok: true };
  }

  @Post(':id/read')
  async read(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    await this.notifications.markRead(p.operatorId, id, p.subject);
    return { ok: true };
  }
}

/** For the Temporal worker only: anchor every chain head to the write-once bucket. */
@Public()
@UseGuards(InternalGuard)
@Controller('internal/platform')
export class PlatformInternalController {
  constructor(private readonly anchors: AnchorService, private readonly documents: DocumentsService) {}

  @Get('identity')
  identity() {
    return { trusted: true };
  }

  @Post('anchors')
  anchor() {
    return this.anchors.anchorAll();
  }

  /** Hourly: abandoned uploads → stored (file arrived, confirm lost) or expired. */
  @Post('documents/sweep')
  sweepUploads() {
    return this.documents.sweepPending();
  }
}

import { BadRequestException, Controller, Get, Header, Inject, Injectable, Query, Res, StreamableFile } from '@nestjs/common';
import { and, asc, desc, eq, gte, lt, lte } from 'drizzle-orm';
import { buildEvidencePack, recordOf, type AnchorRecord, type EvidenceInput } from '@aeroos/audit';
import type { KeyService } from '@aeroos/signing';
import { actorOf, CurrentPrincipal, type Principal } from '../../platform/auth/principal';
import { AnchorService } from '../../platform/audit/anchor.service';
import { AuditQuery, AuditService } from '../../platform/audit/audit.service';
import { AuthzService } from '../../platform/authz/authz.service';
import { DB_TOKEN, type ModuleDb } from '../../platform/database/module-db';
import { auditAnchors, auditLog, documents } from '../../platform/database/platform.tables';
import { KEY_SERVICE } from '../../platform/keys/keys.provider';
import { CHAINS } from '../../platform/platform.controllers';
import { ComplianceService } from './compliance.service';
import { MatrixService } from './matrix.service';

const DAY = 86_400_000;
const MAX_DAYS = 400;
const MAX_ENTRIES = 250_000;

/**
 * Authority evidence pack (ADR-0015): one operator's audit trail for a period as a signed ZIP an inspector
 * verifies offline. Built from the live chains; the export itself is recorded on the compliance chain.
 */
@Injectable()
export class EvidenceService {
  constructor(
    @Inject(DB_TOKEN.platform) private readonly db: ModuleDb,
    @Inject(KEY_SERVICE) private readonly keys: KeyService,
    private readonly anchors: AnchorService,
    private readonly auditQuery: AuditQuery,
    private readonly audit: AuditService,
    private readonly authz: AuthzService,
    private readonly compliance: ComplianceService,
    private readonly matrix: MatrixService
  ) {}

  async export(p: Principal, q: { from: Date; to: Date; chains: string[] }) {
    if (!(q.to > q.from)) throw new BadRequestException('"to" must be after "from"');
    if (q.to.getTime() - q.from.getTime() > MAX_DAYS * DAY) throw new BadRequestException(`At most ${MAX_DAYS} days per pack`);
    for (const c of q.chains) {
      if (!CHAINS.includes(c)) throw new BadRequestException(`Unknown audit chain "${c}"`);
      await this.authz.check(p, { kind: 'audit_chain', id: c, attr: { operatorId: p.operatorId } }, 'export');
    }
    const chains: EvidenceInput['chains'] = [];
    let total = 0;
    for (const chain of q.chains) {
      // Range of links: from the last entry before the period (any operator) — or the chain's first entry —
      // to the first entry at/after its end, extended to the next anchor so the segment ties to a signed head.
      const [before] = await this.db.db.select({ seq: auditLog.seq }).from(auditLog)
        .where(and(eq(auditLog.chain, chain), lt(auditLog.at, q.from))).orderBy(desc(auditLog.seq)).limit(1);
      const [after] = await this.db.db.select({ seq: auditLog.seq }).from(auditLog)
        .where(and(eq(auditLog.chain, chain), gte(auditLog.at, q.to))).orderBy(asc(auditLog.seq)).limit(1);
      let until = after?.seq ?? null;
      if (until !== null) {
        const [tail] = await this.db.db.select({ seq: auditAnchors.seq }).from(auditAnchors)
          .where(and(eq(auditAnchors.chain, chain), gte(auditAnchors.seq, until))).orderBy(asc(auditAnchors.seq)).limit(1);
        if (tail) until = tail.seq;
      }
      const rows = await this.db.db.select().from(auditLog)
        .where(and(eq(auditLog.chain, chain), before ? gte(auditLog.seq, before.seq) : undefined, until !== null ? lte(auditLog.seq, until) : undefined))
        .orderBy(asc(auditLog.seq)).limit(MAX_ENTRIES * 4 + 1);
      if (rows.length > MAX_ENTRIES * 4) throw new BadRequestException('The chain segment is too long for one pack; export a shorter period');
      const inPeriod = (at: Date) => at >= q.from && at < q.to;
      const mine = rows.filter(x => x.operatorId === p.operatorId && inPeriod(x.at));
      total += mine.length;
      if (total > MAX_ENTRIES) throw new BadRequestException(`More than ${MAX_ENTRIES} entries; export a shorter period`);
      const entries = mine.map(x => ({ seq: x.seq, prevHash: x.prevHash, hash: x.hash, record: recordOf(x) }));
      const skeleton = rows.map(x => ({ seq: x.seq, prevHash: x.prevHash, hash: x.hash, at: x.at.toISOString(), operatorId: x.operatorId ?? null }));
      let anchors: AnchorRecord[] = [];
      if (rows.length) {
        const first = rows[0].seq;
        const last = rows[rows.length - 1].seq;
        // Anchors inside the range, plus the latest one before it (the segment starts on anchored ground).
        const [prior] = await this.db.db.select().from(auditAnchors)
          .where(and(eq(auditAnchors.chain, chain), lt(auditAnchors.seq, first))).orderBy(desc(auditAnchors.seq)).limit(1);
        const inRange = await this.db.db.select().from(auditAnchors)
          .where(and(eq(auditAnchors.chain, chain), gte(auditAnchors.seq, first), lte(auditAnchors.seq, last))).orderBy(asc(auditAnchors.seq));
        anchors = [...(prior ? [prior] : []), ...inRange].map(a => ({
          chain: a.chain, seq: a.seq, hash: a.hash, anchoredAt: a.anchoredAt.toISOString(), objectKey: a.objectKey,
          signature: a.signature as unknown as AnchorRecord['signature']
        }));
      }
      const verification = { ...(await this.auditQuery.verify(chain)), anchor: await this.anchors.check(chain) };
      chains.push({ chain, entries, skeleton, anchors, serverVerification: verification, fromGenesis: !before, toHead: until === null });
    }
    const docs = await this.db.db.select().from(documents)
      .where(and(eq(documents.operatorId, p.operatorId), eq(documents.status, 'STORED'), gte(documents.createdAt, q.from), lt(documents.createdAt, q.to)))
      .orderBy(desc(documents.createdAt));
    const generatedAt = new Date();
    const input: EvidenceInput = {
      operatorId: p.operatorId,
      operatorName: this.compliance.engine.profile(p.operatorId).name,
      period: { from: q.from.toISOString(), to: q.to.toISOString() },
      generatedAt: generatedAt.toISOString(),
      generatedBy: actorOf(p),
      signingKeyId: this.keys.keyId,
      keys: await this.keys.publicKeys(),
      chains,
      documents: docs.map(d => ({
        id: d.id, ownerType: d.ownerType, ownerId: d.ownerId, fileName: d.fileName, contentType: d.contentType, sizeBytes: d.sizeBytes,
        sha256: d.sha256, storedAt: d.storedAt?.toISOString() ?? null, uploadedBy: d.uploadedBy
      })),
      // the traceability matrix with this period's evidence counts: the inspector's sampling guide
      extraFiles: [{ path: 'compliance-matrix.json', data: await this.matrix.build(p.operatorId, q.from, q.to, undefined, q.chains) }]
    };
    const pack = await buildEvidencePack(input, payload => this.keys.sign(payload, generatedAt));
    await this.db.transaction(() => this.audit.record(this.db, 'compliance', {
      operatorId: p.operatorId, actor: actorOf(p), action: 'evidence.exported', entityType: 'evidence_pack', entityId: pack.manifestSha256,
      data: { period: input.period, chains: pack.manifest.chains, documents: pack.manifest.documents, bytes: pack.zip.length }
    }));
    const name = `aeroos-evidence-${p.operatorId}-${input.period.from.slice(0, 10)}_${input.period.to.slice(0, 10)}.zip`;
    return { zip: pack.zip, name, manifestSha256: pack.manifestSha256 };
  }
}

const parseDay = (v: string | undefined, name: string) => {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new BadRequestException(`"${name}" must be a date (YYYY-MM-DD or ISO-8601)`);
  return d;
};

@Controller('compliance/evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  /** GET /api/compliance/evidence?from=2026-09-01&to=2026-10-01&chains=ops,camo → application/zip */
  @Get()
  @Header('content-type', 'application/zip')
  async export(
    @CurrentPrincipal() p: Principal,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('chains') chains: string | undefined,
    @Res({ passthrough: true }) res: { header(name: string, value: string): unknown }
  ) {
    const list = (chains ?? CHAINS.join(',')).split(',').map(c => c.trim()).filter(Boolean);
    const r = await this.evidence.export(p, { from: parseDay(from, 'from'), to: parseDay(to, 'to'), chains: [...new Set(list)] });
    res.header('content-disposition', `attachment; filename="${r.name}"`);
    res.header('x-manifest-sha256', r.manifestSha256);
    return new StreamableFile(r.zip);
  }
}

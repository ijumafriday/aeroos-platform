import { Body, Controller, Get, Inject, Injectable, Param, Post } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PasskeyAssertionDto, PasskeyAssertionOptionsDto, PasskeyDto, PasskeyRegistrationOptionsDto } from '@aeroos/contracts';
import { DomainError, canonicalJson } from '@aeroos/kernel';
import { b64url, boundChallenge, verifyAssertion, verifyRegistration, WebAuthnError, type RelyingParty } from '@aeroos/signing';
import { CONFIG, type Config } from '../../config';
import { actorOf, CurrentPrincipal, type Principal } from '../auth/principal';
import { AuditService } from '../audit/audit.service';
import { DB_TOKEN, type ModuleDb } from '../database/module-db';
import { passkeys, webauthnChallenges } from '../database/platform.tables';
import { ZodPipe } from '../http/http';
import { NotificationsService } from '../notifications/notifications.service';

const CHALLENGE_TTL_MS = 2 * 60_000;

/** What a passkey can approve. 'enrol' approves adding another passkey. */
export type PasskeyPurpose = 'enrol' | 'crs' | 'stamp' | 'mel_extension' | 'revoke';
const TIMEOUT_MS = 60_000;

/**
 * What a successful passkey confirmation proves; kept with the approved record (audit log). Everything needed
 * to re-verify it later is here: challenge = sha256(nonce ‖ canonical{purpose, subject, context}); the
 * signature over authenticatorData ‖ sha256(clientDataJSON) verifies with the key in the passkey.registered
 * audit entry for credentialId.
 */
export interface PasskeyEvidence {
  challengeId: string;
  purpose: string;
  subject: string;
  context: Record<string, unknown>;
  nonce: string;
  challenge: string;
  credentialId: string;
  signCount: number;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  verifiedAt: string;
}

/** First enrolment must follow a password sign-in this recent (seconds); later ones need an existing passkey. */
const FIRST_ENROLMENT_MAX_AGE_S = 120;

const wrap = (e: unknown): never => {
  if (e instanceof WebAuthnError) throw new DomainError(`PASSKEY_${e.code}`, e.message, 422);
  throw e;
};

/**
 * Passkeys (ADR-0017). Users enrol a passkey right after a password sign-in; regulated actions are then
 * confirmed with it. Every confirmation signs a single-use challenge derived from the exact record being
 * approved, so the stored assertion is evidence of who approved what, verifiable later with the stored key.
 */
@Injectable()
export class PasskeyService {
  private readonly rp: RelyingParty;

  constructor(
    @Inject(DB_TOKEN.platform) private readonly db: ModuleDb,
    @Inject(CONFIG) private readonly config: Config,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService
  ) {
    this.rp = { rpId: config.WEBAUTHN_RP_ID, origins: config.WEBAUTHN_ORIGINS, requireUserVerification: true };
  }

  private active(subject: string) {
    return this.db.db.select().from(passkeys).where(and(eq(passkeys.subject, subject), isNull(passkeys.revokedAt)));
  }

  async list(p: Principal): Promise<PasskeyDto[]> {
    return (await this.active(p.subject)).map(k => ({
      credentialId: k.credentialId, label: k.label, alg: k.alg, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null
    }));
  }

  async hasPasskey(p: Principal) {
    return (await this.active(p.subject)).length > 0;
  }

  /**
   * Policy gate for a signature other than the CRS: when the purpose is listed in PASSKEY_REQUIRED_FOR and the
   * signer has a passkey, a confirmation bound to `context` is required and verified; otherwise the action
   * proceeds as before (null). Returns the evidence to store with the signed record.
   */
  async requireConfirmation(p: Principal, purpose: Exclude<PasskeyPurpose, 'enrol' | 'crs' | 'revoke'>, context: Record<string, unknown>,
    passkey?: { challengeId: string; assertion: PasskeyAssertionDto }): Promise<PasskeyEvidence | null> {
    if (passkey) return this.confirm(p, passkey.challengeId, purpose, context, passkey.assertion);
    if (this.config.PASSKEY_REQUIRED_FOR.has(purpose) && (await this.hasPasskey(p))) {
      throw new DomainError('PASSKEY_REQUIRED', 'You have a passkey: confirm this signature with it', 422);
    }
    return null;
  }

  private async newChallenge(p: Principal, purpose: 'register' | PasskeyPurpose, context: Record<string, unknown>) {
    // Housekeeping: unused, expired challenges are worthless (used ones are evidence, kept in the audit entry).
    await this.db.db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date(Date.now() - 3_600_000)));
    const id = randomUUID();
    const nonce = randomBytes(32);
    const challenge = boundChallenge(nonce, { purpose, subject: p.subject, context }, canonicalJson);
    await this.db.db.insert(webauthnChallenges).values({
      id, subject: p.subject, purpose, context, nonce: b64url(nonce), challenge: b64url(challenge), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS)
    });
    return { id, challenge: b64url(challenge) };
  }

  /** Single use: the row is claimed before verification, so a response can never be replayed. */
  private async claim(p: Principal, id: string, purpose: string, context?: Record<string, unknown>) {
    const [row] = await this.db.db.update(webauthnChallenges).set({ usedAt: new Date() })
      .where(and(eq(webauthnChallenges.id, id), eq(webauthnChallenges.subject, p.subject), eq(webauthnChallenges.purpose, purpose),
        isNull(webauthnChallenges.usedAt), sql`${webauthnChallenges.expiresAt} > now()`))
      .returning();
    if (!row) throw new DomainError('PASSKEY_CHALLENGE', 'This confirmation expired or was already used; start again', 409);
    if (context && canonicalJson(row.context) !== canonicalJson(context)) throw new DomainError('PASSKEY_CHALLENGE', 'The confirmation was for a different record', 409);
    return row;
  }

  /**
   * Enrolment. The first passkey needs a password sign-in from the last two minutes; every further passkey
   * must be approved with an existing one — so a stolen session cannot add an attacker's key once the user
   * has a passkey. The user is notified of every enrolment.
   */
  async registrationOptions(p: Principal): Promise<PasskeyRegistrationOptionsDto & { approveWith?: PasskeyAssertionOptionsDto }> {
    const existing = await this.active(p.subject);
    if (!existing.length && this.config.STEP_UP_MAX_AGE_SECONDS > 0) { // 0 = step-up disabled (development), as for the CRS
      const age = p.authTime === null ? Infinity : Date.now() / 1000 - p.authTime;
      if (age > FIRST_ENROLMENT_MAX_AGE_S) throw new DomainError('STEP_UP_REQUIRED', 'Sign in again with your password to add your first passkey', 422);
    }
    const c = await this.newChallenge(p, 'register', {});
    const options: PasskeyRegistrationOptionsDto & { approveWith?: PasskeyAssertionOptionsDto } = {
      challengeId: c.id,
      rp: { id: this.rp.rpId, name: this.config.WEBAUTHN_RP_NAME },
      user: { id: b64url(Buffer.from(p.subject, 'utf8')), name: p.username, displayName: p.name },
      challenge: c.challenge,
      pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      timeout: TIMEOUT_MS,
      excludeCredentials: existing.map(k => ({ type: 'public-key' as const, id: k.credentialId })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      attestation: 'none'
    };
    if (existing.length) {
      // Bound to this registration challenge: the approval cannot be reused for another enrolment.
      options.approveWith = await this.assertionOptions(p, 'enrol', { registrationChallengeId: c.id }, 'Approve adding a new passkey to your account');
    }
    return options;
  }

  async register(p: Principal, body: {
    challengeId: string; label: string; response: { clientDataJSON: string; attestationObject: string };
    approval?: { challengeId: string; assertion: PasskeyAssertionDto };
  }): Promise<PasskeyDto> {
    const existing = await this.active(p.subject);
    if (existing.length) {
      if (!body.approval) throw new DomainError('PASSKEY_APPROVAL_REQUIRED', 'Approve the new passkey with one you already have', 422);
      await this.confirm(p, body.approval.challengeId, 'enrol', { registrationChallengeId: body.challengeId }, body.approval.assertion);
    }
    const row = await this.claim(p, body.challengeId, 'register');
    let cred;
    try {
      cred = verifyRegistration(this.rp, Buffer.from(row.challenge, 'base64url'), body.response);
    } catch (e) {
      wrap(e);
    }
    const c = cred!;
    return this.db.transaction(async () => {
      const [exists] = await this.db.db.select({ id: passkeys.credentialId }).from(passkeys).where(eq(passkeys.credentialId, c.credentialId));
      if (exists) throw new DomainError('PASSKEY_EXISTS', 'This passkey is already registered', 409);
      await this.db.db.insert(passkeys).values({
        credentialId: c.credentialId, subject: p.subject, username: p.username, label: body.label, publicKeyPem: c.publicKeyPem, alg: c.alg, signCount: c.signCount, aaguid: c.aaguid
      });
      await this.audit.record(this.db, 'compliance', {
        operatorId: p.operatorId, actor: actorOf(p), action: 'passkey.registered', entityType: 'user', entityId: p.subject,
        data: { credentialId: c.credentialId, label: body.label, alg: c.alg, aaguid: c.aaguid, publicKeyPem: c.publicKeyPem, approvedWithExistingPasskey: existing.length > 0 }
      });
      await this.notifications.raise(this.db, {
        operatorId: p.operatorId, actor: 'system:security', severity: 'amber', link: '/account/passkeys',
        title: `New passkey "${body.label}" added to ${p.username}`, body: 'If this was not you, revoke it now and tell your quality manager.'
      });
      return { credentialId: c.credentialId, label: body.label, alg: c.alg, createdAt: new Date().toISOString(), lastUsedAt: null };
    });
  }

  /**
   * Revoking a passkey lowers the bar for every later signature, so a session alone is not enough: it must be
   * approved with one of the user's passkeys (any, including the one being revoked) or follow a password
   * sign-in from the last two minutes (the lost-device case). The user is notified of every revocation.
   */
  async revokeChallenge(p: Principal, credentialId: string) {
    return this.assertionOptions(p, 'revoke', { credentialId }, 'Approve revoking this passkey');
  }

  async revoke(p: Principal, credentialId: string, approval?: { challengeId: string; assertion: PasskeyAssertionDto }) {
    let method: 'passkey' | 'password';
    if (approval) {
      await this.confirm(p, approval.challengeId, 'revoke', { credentialId }, approval.assertion);
      method = 'passkey';
    } else {
      const age = p.authTime === null ? Infinity : Date.now() / 1000 - p.authTime;
      if (this.config.STEP_UP_MAX_AGE_SECONDS > 0 && age > FIRST_ENROLMENT_MAX_AGE_S) {
        throw new DomainError('STEP_UP_REQUIRED', 'Approve with a passkey, or sign in again with your password, to revoke a passkey', 422);
      }
      method = 'password';
    }
    return this.db.transaction(async () => {
      const r = await this.db.db.update(passkeys).set({ revokedAt: new Date() })
        .where(and(eq(passkeys.credentialId, credentialId), eq(passkeys.subject, p.subject), isNull(passkeys.revokedAt))).returning({ id: passkeys.credentialId, label: passkeys.label });
      if (!r.length) throw new DomainError('PASSKEY_NOT_FOUND', 'No such passkey', 404);
      await this.audit.record(this.db, 'compliance', {
        operatorId: p.operatorId, actor: actorOf(p), action: 'passkey.revoked', entityType: 'user', entityId: p.subject, data: { credentialId, approvedWith: method }
      });
      await this.notifications.raise(this.db, {
        operatorId: p.operatorId, actor: 'system:security', severity: 'amber', link: '/account/passkeys',
        title: `Passkey "${r[0].label}" revoked for ${p.username}`, body: 'If this was not you, sign in again, change your password and tell your quality manager.'
      });
      return { revoked: credentialId };
    });
  }

  /** A challenge to approve one specific record with a passkey. `approving` is shown to the user. */
  async assertionOptions(p: Principal, purpose: PasskeyPurpose, context: Record<string, unknown>, approving: string): Promise<PasskeyAssertionOptionsDto> {
    const keys = await this.active(p.subject);
    if (!keys.length) throw new DomainError('NO_PASSKEY', 'You have no passkey yet; add one, or confirm by signing in again', 409);
    const c = await this.newChallenge(p, purpose, context);
    return {
      challengeId: c.id, challenge: c.challenge, rpId: this.rp.rpId, userVerification: 'required', timeout: TIMEOUT_MS, approving,
      allowCredentials: keys.map(k => ({ type: 'public-key' as const, id: k.credentialId }))
    };
  }

  /**
   * Verify a passkey confirmation of `context` (the same context the challenge was issued for) and advance the
   * key's counter, in one platform transaction (the approved action runs in its own module's transaction).
   */
  async confirm(p: Principal, challengeId: string, purpose: PasskeyPurpose, context: Record<string, unknown>, a: PasskeyAssertionDto): Promise<PasskeyEvidence> {
    return this.db.transaction(async () => {
      const row = await this.claim(p, challengeId, purpose, context);
      const [key] = await this.db.db.select().from(passkeys)
        .where(and(eq(passkeys.credentialId, a.credentialId), eq(passkeys.subject, p.subject), isNull(passkeys.revokedAt))).for('update');
      if (!key) throw new DomainError('PASSKEY_NOT_FOUND', 'This passkey is not registered to you (or was revoked)', 422);
      let r;
      try {
        r = verifyAssertion(this.rp, Buffer.from(row.challenge, 'base64url'), key, a);
      } catch (e) {
        wrap(e);
      }
      await this.db.db.update(passkeys).set({ signCount: r!.signCount, lastUsedAt: new Date() }).where(eq(passkeys.credentialId, key.credentialId));
      return {
        challengeId: row.id, purpose: row.purpose, subject: row.subject, context: row.context, nonce: row.nonce, challenge: row.challenge,
        credentialId: key.credentialId, signCount: r!.signCount, clientDataJSON: a.clientDataJSON, authenticatorData: a.authenticatorData,
        signature: a.signature, verifiedAt: new Date().toISOString()
      };
    });
  }
}


export const assertionSchema = z.object({
  credentialId: z.string().max(1400), clientDataJSON: z.string().max(8192), authenticatorData: z.string().max(4096), signature: z.string().max(2048)
});

const registerSchema = z.object({
  challengeId: z.string().uuid(),
  label: z.string().trim().min(1).max(60),
  response: z.object({ clientDataJSON: z.string().max(8192), attestationObject: z.string().max(16384) }),
  approval: z.object({ challengeId: z.string().uuid(), assertion: assertionSchema }).optional()
});

const revokeSchema = z.object({ approval: z.object({ challengeId: z.string().uuid(), assertion: assertionSchema }).optional() }).default({});

@Controller('platform/passkeys')
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.passkeys.list(p);
  }

  @Post('options')
  options(@CurrentPrincipal() p: Principal) {
    return this.passkeys.registrationOptions(p);
  }

  @Post()
  register(@CurrentPrincipal() p: Principal, @Body(new ZodPipe(registerSchema)) body: z.infer<typeof registerSchema>) {
    return this.passkeys.register(p, body);
  }

  @Post(':id/revoke/challenge')
  revokeChallenge(@CurrentPrincipal() p: Principal, @Param('id') id: string) {
    return this.passkeys.revokeChallenge(p, id);
  }

  @Post(':id/revoke')
  revoke(@CurrentPrincipal() p: Principal, @Param('id') id: string, @Body(new ZodPipe(revokeSchema)) body: z.infer<typeof revokeSchema>) {
    return this.passkeys.revoke(p, id, body.approval);
  }
}


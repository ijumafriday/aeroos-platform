import { canonicalJson, sha256Hex } from '@aeroos/kernel';

/**
 * Hash-chained audit trail.
 *
 * Each module writes to its own chain ("camo", "amo", "org", "platform"). Every entry's hash covers
 * the previous entry's hash plus the canonical form of the record, so editing, deleting or
 * reordering any past entry breaks every hash after it. The head hash can be anchored externally
 * (write-once object storage, or sent to the quality department) to detect wholesale replacement.
 */

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditRecord {
  chain: string;
  /** ISO-8601 instant. */
  at: string;
  /** Who acted: user subject, or "system:<component>". */
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  /** Business payload: before/after values, inputs, outcome. */
  data: Record<string, unknown>;
  /** Rulepack that produced the decision, if any (e.g. "EASA@2026.1"). */
  rule: string | null;
  /**
   * Operator (AOC) the entry concerns. Part of the hash from 0.5 on, so an entry cannot be moved between
   * operators without breaking the chain. Absent on older entries (canonical JSON drops undefined, so their
   * hashes are unchanged).
   */
  operatorId?: string;
}

/** Rebuild the hashed record from stored columns (NULL operator → absent, as it was hashed). */
export const recordOf = (x: { chain: string; at: Date | string; actor: string; action: string; entityType: string; entityId: string; data: Record<string, unknown>; rule: string | null; operatorId?: string | null }): AuditRecord => ({
  chain: x.chain, at: typeof x.at === 'string' ? x.at : x.at.toISOString(), actor: x.actor, action: x.action, entityType: x.entityType,
  entityId: x.entityId, data: x.data, rule: x.rule, ...(x.operatorId ? { operatorId: x.operatorId } : {})
});

export interface ChainEntry {
  seq: number;
  record: AuditRecord;
  prevHash: string;
  hash: string;
}

export const hashEntry = (prevHash: string, record: AuditRecord) => sha256Hex(prevHash + '\n' + canonicalJson(record));

/** Compute the link for a new record given the current head (null for an empty chain). */
export function link(head: { hash: string } | null, record: AuditRecord) {
  const prevHash = head?.hash ?? GENESIS_HASH;
  return { prevHash, hash: hashEntry(prevHash, record) };
}

export type VerifyResult =
  | { ok: true; count: number; head: string }
  | { ok: false; count: number; brokenAtSeq: number; reason: 'LINK_BROKEN' | 'HASH_MISMATCH' | 'WRONG_CHAIN' };

/** Verify a whole chain, in sequence order. Sequence gaps are allowed (rolled-back transactions); broken links are not. */
export function verifyChain(chain: string, entries: ChainEntry[]): VerifyResult {
  let prev = GENESIS_HASH;
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.record.chain !== chain) return { ok: false, count: i, brokenAtSeq: e.seq, reason: 'WRONG_CHAIN' };
    if (e.prevHash !== prev) return { ok: false, count: i, brokenAtSeq: e.seq, reason: 'LINK_BROKEN' };
    if (hashEntry(e.prevHash, e.record) !== e.hash) return { ok: false, count: i, brokenAtSeq: e.seq, reason: 'HASH_MISMATCH' };
    prev = e.hash;
  }
  return { ok: true, count: sorted.length, head: prev };
}

/** A compact statement of the chain state to anchor outside the database. */
export const anchor = (chain: string, head: string, count: number, at: Date) =>
  ({ chain, head, count, at: at.toISOString(), digest: sha256Hex(canonicalJson({ chain, head, count, at: at.toISOString() })) });
export * from './evidence';
export * from './zip';

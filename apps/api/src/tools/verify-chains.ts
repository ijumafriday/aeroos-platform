/**
 * Restore-drill check: recompute every audit chain in a (restored) database and compare each head with
 *  - the heads recorded when the backup was taken (--expect heads.json), and
 *  - the latest signed anchor in that database (platform.audit_anchors).
 * Exit code 0 = every chain intact and consistent; 1 = a mismatch; 2 = usage/connection error.
 *
 *   node dist/tools/verify-chains.js --anchors-dir <dir> [--expect heads.json] [--keys keys.json]
 *   node dist/tools/verify-chains.js --no-objects [...]       (skip the write-once copy; weaker, says so)
 * Connection: PG* environment variables.
 *
 * The decisive check is against the write-once (Object Lock) anchor objects: someone able to rewrite the
 * database consistently — log and anchor table together — still cannot rewrite those objects. Every anchor
 * row must match its object, every object must have its row, and the chain must contain each anchored hash.
 * With --keys (keys.json from an evidence pack or the signing service) every anchor signature is verified too.
 *
 * Read-only. Usable as an independent check after any restore, not only in drills.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Client } from 'pg';
import { recordOf, verifyChain, type ChainEntry } from '@aeroos/audit';
import { canonicalJson } from '@aeroos/kernel';

interface AnchorObject { chain: string; seq: number; hash: string; anchoredAt: string; signature: { alg: string; keyId: string; signedAt: string; payloadSha256: string; signature: string } }

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const walk = (d: string): string[] => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

interface Head { chain: string; seq: number; hash: string }

async function main() {
  const expectFile = arg('--expect');
  const expected: Head[] = expectFile ? JSON.parse(readFileSync(expectFile, 'utf8')) : [];
  const anchorsDir = arg('--anchors-dir');
  const noObjects = process.argv.includes('--no-objects');
  if (!anchorsDir && !noObjects) {
    console.error('verify-chains: give --anchors-dir <copy of the write-once anchors bucket> (or --no-objects for a weaker check)');
    process.exit(2);
  }
  if (anchorsDir && !existsSync(anchorsDir)) {
    console.error(`verify-chains: ${anchorsDir} does not exist — the anchors bucket was not backed up`);
    process.exit(2);
  }
  const keysFile = arg('--keys');
  const keys = new Map<string, ReturnType<typeof createPublicKey>>(
    keysFile ? (JSON.parse(readFileSync(keysFile, 'utf8')) as { keyId: string; publicKeyPem: string }[]).map(k => [k.keyId, createPublicKey(k.publicKeyPem)]) : []
  );
  const objects = new Map<string, AnchorObject>();
  if (anchorsDir) for (const f of walk(anchorsDir).filter(x => x.endsWith('.json'))) objects.set(relative(anchorsDir, f).split('\\').join('/'), JSON.parse(readFileSync(f, 'utf8')));
  const seenObjects = new Set<string>();
  const db = new Client();
  await db.connect();
  let failed = false;
  try {
    const chains = (await db.query<{ chain: string }>('select distinct chain from platform.audit_log order by 1')).rows.map(r => r.chain);
    for (const chain of chains) {
      const rows = (await db.query<{ seq: string; at: Date; actor: string; action: string; entity_type: string; entity_id: string; data: Record<string, unknown>; rule: string | null; prev_hash: string; hash: string; operator_id: string | null }>(
        'select seq, at, actor, action, entity_type, entity_id, data, rule, prev_hash, hash, operator_id from platform.audit_log where chain = $1 order by seq', [chain])).rows;
      const entries: ChainEntry[] = rows.map(r => ({
        seq: Number(r.seq), prevHash: r.prev_hash, hash: r.hash,
        record: recordOf({ chain, at: r.at, actor: r.actor, action: r.action, entityType: r.entity_type, entityId: r.entity_id, data: r.data, rule: r.rule, operatorId: r.operator_id })
      }));
      const v = verifyChain(chain, entries);
      const head = entries[entries.length - 1];
      const line: string[] = [`${chain.padEnd(11)} ${String(entries.length).padStart(7)} entries`];
      if (!v.ok) {
        failed = true;
        line.push(`BROKEN at seq ${v.brokenAtSeq} (${v.reason})`);
      } else {
        line.push('chain intact');
      }
      const exp = expected.find(e => e.chain === chain);
      if (exp) {
        const atExp = entries.find(e => e.seq === exp.seq);
        if (!atExp || atExp.hash !== exp.hash) { failed = true; line.push(`MISSING/CHANGED backup head seq ${exp.seq}`); }
        else line.push(`backup head seq ${exp.seq} present`);
      }
      // Every anchor of this chain: row ↔ write-once object ↔ chain entry (↔ signature when keys are given).
      const anchors = (await db.query<{ seq: string; hash: string; object_key: string; anchored_at: Date; signature: AnchorObject['signature'] }>(
        'select seq, hash, object_key, anchored_at, signature from platform.audit_anchors where chain = $1 order by seq', [chain])).rows;
      let anchorProblems = 0;
      const bySeq = new Map(entries.map(e => [e.seq, e]));
      for (const a of anchors) {
        const seq = Number(a.seq);
        if (bySeq.get(seq)?.hash !== a.hash) { anchorProblems++; line.push(`ANCHOR @${seq} NOT ON CHAIN`); }
        if (anchorsDir) {
          const o = objects.get(a.object_key);
          seenObjects.add(a.object_key);
          if (!o) { anchorProblems++; line.push(`ANCHOR @${seq} has no write-once object`); }
          else if (o.chain !== chain || o.seq !== seq || o.hash !== a.hash || JSON.stringify(o.signature) !== JSON.stringify(a.signature)) { anchorProblems++; line.push(`ANCHOR @${seq} DIFFERS from its write-once object`); }
        }
        const key = keys.get(a.signature?.keyId);
        if (keysFile) {
          const body = { chain, seq, hash: a.hash, anchoredAt: new Date(a.anchored_at).toISOString() };
          const digest = createHash('sha256').update(canonicalJson(body)).digest('hex');
          const msg = Buffer.from(canonicalJson({ keyId: a.signature.keyId, payloadSha256: a.signature.payloadSha256, signedAt: a.signature.signedAt }), 'utf8');
          if (!key || digest !== a.signature.payloadSha256 || !verify(null, msg, key, Buffer.from(a.signature.signature, 'base64'))) { anchorProblems++; line.push(`ANCHOR @${seq} SIGNATURE INVALID`); }
        }
      }
      if (anchorProblems) failed = true;
      line.push(anchors.length ? `${anchors.length} anchor(s)${anchorProblems ? '' : anchorsDir ? ' match write-once copies' : ' (write-once copies NOT checked)'}${keysFile && !anchorProblems ? ', signatures valid' : ''}` : 'no anchor yet');
      if (head && v.ok) line.push(`head ${head.hash.slice(0, 16)}…`);
      console.log(line.join(' · '));
    }
    if (anchorsDir) {
      for (const k of objects.keys()) {
        if (!seenObjects.has(k)) { failed = true; console.log(`write-once anchor ${k} has no row in the database (anchor rows deleted?)`); }
      }
    }
    for (const e of expected) {
      if (!chains.includes(e.chain)) { failed = true; console.log(`${e.chain}: chain present in the backup manifest is missing after restore`); }
    }
  } finally {
    await db.end();
  }
  console.log(failed ? '\nRESTORE CHECK FAILED'
    : noObjects ? '\nRESTORE CHECK PASSED (WEAKER: anchors not compared with their write-once copies): every chain recomputes and contains its backup head.'
    : '\nRESTORE CHECK PASSED: every audit chain recomputes, contains its backup head, and every anchor matches its write-once copy.');
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error(`verify-chains: ${(e as Error).message}`);
  process.exit(2);
});

import { canonicalJson, sha256Hex } from '@aeroos/kernel';
import { hashEntry, type ChainEntry } from './index';
import { VERIFY_SCRIPT } from './verifier-script';
import { zipFiles, type ZipEntry } from './zip';

/**
 * Authority evidence pack: one operator's audit trail for a period, in a form an inspector can check
 * on their own machine without trusting AeroOS.
 *
 *   manifest.json          what is in the pack (operator, period, chains, file hashes), signed →
 *   manifest.sig.json      Ed25519 signature by the platform signing key (Vault/OpenBao Transit)
 *   public-key.pem         the key to check it with
 *   chains/<c>.entries.jsonl   the operator's entries (full records) with seq, prevHash, hash
 *   chains/<c>.skeleton.jsonl  seq/prevHash/hash of EVERY entry in the range, other operators' included
 *                              but without content: proves nothing was removed between them
 *   chains/<c>.anchors.json    signed hourly anchors in the range (also in write-once storage)
 *   chains/<c>.server-verification.json  the platform's own full-chain verification at export time
 *   documents.json         the document register (names, sha256) for the operator and period
 *   verify-evidence.mjs    offline verifier (Node.js, no dependencies) + README.txt
 */

/** One link of the chain. `operatorId`/`at` as stored (other operators' content is not included). */
export interface SkeletonRow { seq: number; prevHash: string; hash: string; at: string; operatorId: string | null }
export interface AnchorRecord {
  chain: string; seq: number; hash: string; anchoredAt: string; objectKey: string;
  signature: { alg: string; keyId: string; signedAt: string; payloadSha256: string; signature: string };
}

export interface EvidenceInput {
  operatorId: string;
  operatorName: string;
  period: { from: string; to: string };
  generatedAt: string;
  generatedBy: string;
  signingKeyId: string;
  /** Every key version (the signing key and older ones that signed anchors). */
  keys: { keyId: string; publicKeyPem: string }[];
  chains: {
    chain: string; entries: ChainEntry[]; skeleton: SkeletonRow[]; anchors: AnchorRecord[]; serverVerification: unknown;
    /** The skeleton starts at the chain's first entry / ends at the chain head at export time (else at an entry outside the period). */
    fromGenesis: boolean; toHead: boolean;
  }[];
  documents: { id: string; ownerType: string; ownerId: string; fileName: string; contentType: string; sizeBytes: number | null; sha256: string | null; storedAt: string | null; uploadedBy: string }[];
  /** Further JSON files for the inspector (e.g. the compliance matrix with evidence counts); listed and signed like the rest. */
  extraFiles?: { path: string; data: unknown }[];
}

export interface EvidenceManifest {
  format: 'aeroos-evidence/1';
  operatorId: string;
  operatorName: string;
  period: { from: string; to: string };
  generatedAt: string;
  generatedBy: string;
  signingKeyId: string;
  chains: { chain: string; entries: number; firstSeq: number | null; lastSeq: number | null; anchors: number; links: number; fromGenesis: boolean; toHead: boolean }[];
  documents: number;
  files: { path: string; sha256: string; bytes: number }[];
}

const enc = (s: string) => Buffer.from(s, 'utf8');
const jsonl = (rows: unknown[]) => enc(rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

/**
 * Self-check before anything is signed (the offline verifier repeats it): every entry recomputes to its
 * hash and sits on an unbroken run of links; every link labelled with this operator inside the period is
 * present with its content; the run starts before the period (or at the chain's first entry) and ends after
 * it (or at the head), so nothing at either end can be left out.
 */
export function checkSegment(
  entries: ChainEntry[], skeleton: SkeletonRow[], ctx?: { operatorId: string; from: string; to: string; fromGenesis: boolean; toHead: boolean }
): string[] {
  const issues: string[] = [];
  const bySeq = new Map(skeleton.map(s => [s.seq, s]));
  for (let i = 1; i < skeleton.length; i++) {
    if (skeleton[i].prevHash !== skeleton[i - 1].hash) issues.push(`link broken between seq ${skeleton[i - 1].seq} and ${skeleton[i].seq}`);
  }
  for (const e of entries) {
    if (hashEntry(e.prevHash, e.record) !== e.hash) issues.push(`entry ${e.seq} does not hash to its stored value`);
    const s = bySeq.get(e.seq);
    if (!s || s.hash !== e.hash || s.prevHash !== e.prevHash) issues.push(`entry ${e.seq} is missing from the skeleton`);
    else if (s.operatorId !== (e.record.operatorId ?? null) || s.at !== e.record.at) issues.push(`entry ${e.seq} labelled differently in the skeleton`);
  }
  if (ctx && skeleton.length) {
    const have = new Set(entries.map(e => e.seq));
    for (const s of skeleton) {
      if (s.operatorId === ctx.operatorId && s.at >= ctx.from && s.at < ctx.to && !have.has(s.seq)) issues.push(`entry ${s.seq} of ${ctx.operatorId} in the period is not in the pack`);
    }
    if (!ctx.fromGenesis && !(skeleton[0].at < ctx.from)) issues.push('the chain segment does not start before the period');
    if (ctx.fromGenesis && skeleton[0].prevHash !== '0'.repeat(64)) issues.push('the chain segment claims to start at the first entry but does not');
    if (!ctx.toHead && !(skeleton[skeleton.length - 1].at >= ctx.to)) issues.push('the chain segment does not end after the period');
  }
  return issues;
}

export function evidenceFiles(i: EvidenceInput): { files: ZipEntry[]; manifest: EvidenceManifest } {
  const files: ZipEntry[] = [];
  for (const c of i.chains) {
    const issues = checkSegment(c.entries, c.skeleton, { operatorId: i.operatorId, from: i.period.from, to: i.period.to, fromGenesis: c.fromGenesis, toHead: c.toHead });
    if (issues.length) throw new Error(`Chain ${c.chain} failed its own check, refusing to export: ${issues.slice(0, 3).join('; ')}`);
    files.push({ path: `chains/${c.chain}.entries.jsonl`, data: jsonl(c.entries.map(e => ({ seq: e.seq, prevHash: e.prevHash, hash: e.hash, record: e.record }))) });
    files.push({ path: `chains/${c.chain}.skeleton.jsonl`, data: jsonl(c.skeleton) });
    files.push({ path: `chains/${c.chain}.anchors.json`, data: enc(JSON.stringify(c.anchors, null, 2)) });
    files.push({ path: `chains/${c.chain}.server-verification.json`, data: enc(JSON.stringify(c.serverVerification, null, 2)) });
  }
  files.push({ path: 'documents.json', data: enc(JSON.stringify(i.documents, null, 2)) });
  const reserved = new Set(['manifest.json', 'manifest.sig.json', 'documents.json', 'keys.json']);
  const seen = new Set<string>();
  for (const x of i.extraFiles ?? []) {
    if (!/^[a-z0-9-]+\.json$/.test(x.path) || reserved.has(x.path) || seen.has(x.path)) throw new Error(`Extra evidence file name not allowed: ${x.path}`);
    seen.add(x.path);
    files.push({ path: x.path, data: enc(JSON.stringify(x.data, null, 2)) });
  }
  const signingKey = i.keys.find(k => k.keyId === i.signingKeyId);
  if (!signingKey) throw new Error(`Signing key ${i.signingKeyId} is not among the published keys`);
  files.push({ path: 'public-key.pem', data: enc(signingKey.publicKeyPem) });
  files.push({ path: 'keys.json', data: enc(JSON.stringify(i.keys, null, 2)) });
  files.push({ path: 'verify-evidence.mjs', data: enc(VERIFY_SCRIPT) });
  files.push({ path: 'README.txt', data: enc(readme(i)) });
  const manifest: EvidenceManifest = {
    format: 'aeroos-evidence/1',
    operatorId: i.operatorId,
    operatorName: i.operatorName,
    period: i.period,
    generatedAt: i.generatedAt,
    generatedBy: i.generatedBy,
    signingKeyId: i.signingKeyId,
    chains: i.chains.map(c => ({
      chain: c.chain, entries: c.entries.length, firstSeq: c.entries[0]?.seq ?? null, lastSeq: c.entries[c.entries.length - 1]?.seq ?? null,
      anchors: c.anchors.length, links: c.skeleton.length, fromGenesis: c.fromGenesis, toHead: c.toHead
    })),
    documents: i.documents.length,
    files: files.map(f => ({ path: f.path, sha256: sha256Hex(f.data), bytes: f.data.length }))
  };
  return { files, manifest };
}

/** Build the signed ZIP. `sign` is the platform key service (signs the canonical form of the manifest). */
export async function buildEvidencePack(i: EvidenceInput, sign: (payload: unknown) => Promise<AnchorRecord['signature']>): Promise<{ zip: Buffer; manifest: EvidenceManifest; manifestSha256: string }> {
  const { files, manifest } = evidenceFiles(i);
  const signature = await sign(manifest);
  const zip = zipFiles([
    { path: 'manifest.json', data: enc(JSON.stringify(manifest, null, 2)) },
    { path: 'manifest.sig.json', data: enc(JSON.stringify(signature, null, 2)) },
    ...files
  ], new Date(i.generatedAt));
  return { zip, manifest, manifestSha256: sha256Hex(canonicalJson(manifest)) };
}

function readme(i: EvidenceInput): string {
  return `AeroOS evidence pack
====================
Operator: ${i.operatorName} (${i.operatorId})
Period:   ${i.period.from} → ${i.period.to}  (UTC)
Exported: ${i.generatedAt} by ${i.generatedBy}

What this proves
- manifest.json lists every file with its SHA-256 and is signed (manifest.sig.json, Ed25519) with the
  platform signing key ${i.signingKeyId}; public-key.pem is that key. A pack can only prove it came from
  AeroOS if you confirm that key's fingerprint through a separate channel (the operator's quality
  department, or the fingerprint published in Quality → Audit Trail) and pass it with --fingerprint.
  keys.json lists older key versions (vouched for by the signed manifest) that signed older anchors.
- chains/<chain>.entries.jsonl holds every audit entry of this operator in the period. Each entry's hash
  covers the previous entry's hash and the canonical JSON of the record, so no entry can be changed
  without breaking every later hash.
- chains/<chain>.skeleton.jsonl lists the hash links of ALL entries from just before the period to just
  after it (other operators' entries with time and operator but without content). The verifier checks
  that every link labelled with this operator inside the period is in the pack, so nothing was left out.
  Limit: the operator label of other operators' links is as recorded by the platform; the labels of this
  operator's own entries are covered by their hashes.
- chains/<chain>.anchors.json are the hourly signed checkpoints of the chain head, also written to
  write-once (Object Lock) storage at the time.
- compliance-matrix.json (when present) maps each regulatory requirement to the exposition section, how
  the system meets it and the audit actions recorded for it in this period (counts) — a sampling guide.

How to check (Node.js 18 or later, no installation needed)
    unzip <pack>.zip -d pack
    node pack/verify-evidence.mjs pack --fingerprint <SHA-256 of the signing key, from the operator>

Exit code 0 = verified and signed by the confirmed key; 3 = internally consistent but the signing key
was not confirmed (no --fingerprint); 1 = verification failed.

The verifier recomputes every hash, checks every link and signature, and fails if any file was changed,
removed or added.
`;
}

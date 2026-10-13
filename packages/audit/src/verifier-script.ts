/**
 * The offline verifier shipped inside every evidence pack (verify-evidence.mjs). Plain Node.js 18+,
 * no dependencies, so an authority inspector can run it on their own machine:
 *     unzip pack.zip -d pack && node pack/verify-evidence.mjs pack
 * Kept as a string so the API can embed exactly this text; the unit tests run it against real packs.
 */
export const VERIFY_SCRIPT = String.raw`#!/usr/bin/env node
// AeroOS evidence pack verifier. Usage: node verify-evidence.mjs <unzipped-pack-directory>
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const fpArg = args.indexOf('--fingerprint');
const expectedFp = fpArg >= 0 ? String(args[fpArg + 1] ?? '').toLowerCase().replace(/[^0-9a-f]/g, '') : null;
const dir = args.find((a, i) => !a.startsWith('--') && (fpArg < 0 || i !== fpArg + 1)) ?? '.';
const read = p => readFileSync(join(dir, p));
const sha256 = b => createHash('sha256').update(b).digest('hex');
function normalise(v) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.map(x => (x === undefined ? null : normalise(x)));
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = normalise(v[k]); return o; }
  return v;
}
const canonical = v => JSON.stringify(normalise(v));
const failures = [];
const notes = [];
const fail = m => failures.push(m);

const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const sig = JSON.parse(read('manifest.sig.json').toString('utf8'));
const signingKey = createPublicKey(read('public-key.pem'));
const fingerprint = sha256(signingKey.export({ format: 'der', type: 'spki' }));
function verifyWith(key, payload, env) {
  if (env.alg !== 'Ed25519') return false;
  if (sha256(canonical(payload)) !== env.payloadSha256) return false;
  const msg = Buffer.from(canonical({ keyId: env.keyId, payloadSha256: env.payloadSha256, signedAt: env.signedAt }), 'utf8');
  try { return verify(null, msg, key, Buffer.from(env.signature, 'base64')); } catch { return false; }
}
// 1. The manifest must be signed by the key in public-key.pem, under the key id the manifest names.
if (sig.keyId !== manifest.signingKeyId) fail('manifest signed under key id ' + sig.keyId + ', manifest names ' + manifest.signingKeyId);
if (!verifyWith(signingKey, manifest, sig)) fail('manifest signature does not verify with public-key.pem');
// Older key versions come from keys.json, which the signed manifest covers (checked below).
let keys = new Map();
try { for (const k of JSON.parse(read('keys.json').toString('utf8'))) keys.set(k.keyId, createPublicKey(k.publicKeyPem)); } catch { fail('keys.json missing or unreadable'); }
const signingInKeys = keys.get(manifest.signingKeyId);
if (!signingInKeys || sha256(signingInKeys.export({ format: 'der', type: 'spki' })) !== fingerprint) fail('keys.json does not contain public-key.pem under ' + manifest.signingKeyId);

// Every file is listed with its hash, and nothing else is in the pack.
const listed = new Set(['manifest.json', 'manifest.sig.json']);
for (const f of manifest.files) {
  listed.add(f.path);
  let b;
  try { b = read(f.path); } catch { fail('missing file ' + f.path); continue; }
  if (sha256(b) !== f.sha256) fail('file changed: ' + f.path);
}
const walk = d => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [relative(dir, join(d, n)).split('\\').join('/')]));
for (const f of walk(dir)) if (!listed.has(f)) fail('unexpected file not covered by the manifest: ' + f);

// Chains: every entry recomputes to its hash; entries sit on an unbroken skeleton; anchors are signed and match.
const lines = p => read(p).toString('utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
for (const c of manifest.chains) {
  const entries = lines('chains/' + c.chain + '.entries.jsonl');
  const skeleton = lines('chains/' + c.chain + '.skeleton.jsonl');
  const anchors = JSON.parse(read('chains/' + c.chain + '.anchors.json').toString('utf8'));
  const bySeq = new Map(skeleton.map(s => [s.seq, s]));
  for (let i = 1; i < skeleton.length; i++) {
    if (skeleton[i].prevHash !== skeleton[i - 1].hash) fail(c.chain + ': chain broken between seq ' + skeleton[i - 1].seq + ' and ' + skeleton[i].seq);
  }
  for (const e of entries) {
    if (e.record.chain !== c.chain) fail(c.chain + ': entry ' + e.seq + ' belongs to chain ' + e.record.chain);
    if (sha256(e.prevHash + '\n' + canonical(e.record)) !== e.hash) fail(c.chain + ': entry ' + e.seq + ' was altered');
    const s = bySeq.get(e.seq);
    if (!s || s.hash !== e.hash || s.prevHash !== e.prevHash) fail(c.chain + ': entry ' + e.seq + ' is not on the chain');
  }
  if (entries.length !== c.entries) fail(c.chain + ': manifest says ' + c.entries + ' entries, file has ' + entries.length);
  // Completeness: every link of this operator inside the period has its entry; the run of links starts
  // before the period (or at the first entry of the chain) and ends after it (or at the head at export).
  const have = new Set(entries.map(e => e.seq));
  for (const s of skeleton) {
    if (s.operatorId === manifest.operatorId && s.at >= manifest.period.from && s.at < manifest.period.to && !have.has(s.seq)) fail(c.chain + ': entry ' + s.seq + ' of ' + manifest.operatorId + ' in the period is missing');
  }
  for (const e of entries) {
    const s = bySeq.get(e.seq);
    if (s && (s.operatorId !== (e.record.operatorId ?? null) || s.at !== e.record.at)) fail(c.chain + ': entry ' + e.seq + ' is labelled differently on the chain');
    if ((e.record.operatorId ?? null) !== manifest.operatorId) fail(c.chain + ': entry ' + e.seq + ' belongs to ' + (e.record.operatorId ?? 'no operator'));
  }
  if (skeleton.length) {
    if (c.fromGenesis ? skeleton[0].prevHash !== '0'.repeat(64) : !(skeleton[0].at < manifest.period.from)) fail(c.chain + ': the chain segment does not cover the start of the period');
    if (!c.toHead && !(skeleton[skeleton.length - 1].at >= manifest.period.to)) fail(c.chain + ': the chain segment does not cover the end of the period');
    if (c.toHead) notes.push(c.chain + ': segment ends at the chain head at export time (' + manifest.generatedAt + ')');
  }
  if (skeleton.length !== c.links) fail(c.chain + ': manifest says ' + c.links + ' links, file has ' + skeleton.length);
  let anchoredTail = false;
  for (const a of anchors) {
    const key = keys.get(a.signature.keyId);
    if (!key) fail(c.chain + ' anchor @' + a.seq + ': signed with unknown key ' + a.signature.keyId);
    else if (!verifyWith(key, { chain: a.chain, seq: a.seq, hash: a.hash, anchoredAt: a.anchoredAt }, a.signature)) fail(c.chain + ' anchor @' + a.seq + ': signature does not verify');
    const s = bySeq.get(a.seq);
    if (s && s.hash !== a.hash) fail(c.chain + ': anchor at seq ' + a.seq + ' does not match the chain');
    if (s && skeleton.length && a.seq === skeleton[skeleton.length - 1].seq) anchoredTail = true;
  }
  notes.push(c.chain + ': ' + entries.length + ' entries on ' + skeleton.length + ' chain links, ' + anchors.length + ' anchor(s)' +
    (anchoredTail ? ', end of range anchored' : ', end of range NOT yet anchored (anchoring is hourly)'));
}

console.log('AeroOS evidence pack — ' + manifest.operatorName + ' (' + manifest.operatorId + '), ' + manifest.period.from + ' → ' + manifest.period.to);
console.log('Signing key ' + manifest.signingKeyId + ', SHA-256 fingerprint ' + fingerprint);
for (const n of notes) console.log('  · ' + n);
if (failures.length) {
  console.log('\nFAILED (' + failures.length + '):');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
if (expectedFp === null) {
  console.log('\nCONSISTENT, SIGNER NOT CONFIRMED: the pack is internally intact, but anyone can sign a pack with their own key.');
  console.log('Confirm the fingerprint above with the operator through a separate channel and re-run with --fingerprint <hex>.');
  process.exit(3);
}
if (expectedFp !== fingerprint) {
  console.log('\nFAILED: the pack is signed by a different key than the one you were given (' + expectedFp + ').');
  process.exit(1);
}
console.log('\nVERIFIED: signed by the confirmed key; every file matches the manifest; every audit entry of this operator in the period is present and intact on its chain.');
`;

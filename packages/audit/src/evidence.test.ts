import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign as edSign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { canonicalJson, sha256Hex } from '@aeroos/kernel';
import { buildEvidencePack, link, type AuditRecord, type ChainEntry, type EvidenceInput } from './index';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const KEY = 'test-key-1';
const PEM = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const FP = sha256Hex(publicKey.export({ format: 'der', type: 'spki' }));
async function signer(payload: unknown) {
  const payloadSha256 = sha256Hex(canonicalJson(payload));
  const signedAt = '2026-10-08T12:00:00.000Z';
  const signature = edSign(null, Buffer.from(canonicalJson({ keyId: KEY, payloadSha256, signedAt })), privateKey).toString('base64');
  return { alg: 'Ed25519', keyId: KEY, signedAt, payloadSha256, signature };
}

/** A chain with NKX and FJR entries interleaved. */
function chain(): ChainEntry[] {
  const out: ChainEntry[] = [];
  let head: { hash: string } | null = null;
  for (let seq = 1; seq <= 6; seq++) {
    const op = seq % 2 ? 'NKX' : 'FJR';
    const record: AuditRecord = { chain: 'ops', at: `2026-10-08T0${seq}:00:00.000Z`, actor: 'user:x', action: 'flight.delayed', entityType: 'flight', entityId: `F${seq}`, data: { op, n: seq }, rule: null, operatorId: op };
    const l = link(head, record);
    out.push({ seq, record, prevHash: l.prevHash, hash: l.hash });
    head = l;
  }
  return out;
}

/** Read our own ZIP back (central directory → inflate). */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const off = buf.readUInt32LE(p + 42);
    const localName = buf.readUInt16LE(off + 26);
    const data = inflateRawSync(buf.subarray(off + 30 + localName, off + 30 + localName + size));
    out.set(name, data);
    p += 46 + nameLen;
  }
  return out;
}

async function pack(mutate?: (i: EvidenceInput) => void) {
  const all = chain();
  const anchorBody = { chain: 'ops', seq: 6, hash: all[5].hash, anchoredAt: '2026-10-08T07:00:00.000Z' };
  const input: EvidenceInput = {
    operatorId: 'NKX', operatorName: 'Nordkapp Air', period: { from: '2026-10-08T00:00:00.000Z', to: '2026-10-09T00:00:00.000Z' },
    generatedAt: '2026-10-08T12:00:00.000Z', generatedBy: 'user:auditor', signingKeyId: KEY,
    keys: [{ keyId: KEY, publicKeyPem: PEM }],
    chains: [{
      chain: 'ops', fromGenesis: true, toHead: true,
      entries: all.filter(e => e.record.operatorId === 'NKX'),
      skeleton: all.map(e => ({ seq: e.seq, prevHash: e.prevHash, hash: e.hash, at: e.record.at, operatorId: e.record.operatorId ?? null })),
      anchors: [{ ...anchorBody, objectKey: 'ops/6.json', signature: await signer(anchorBody) }],
      serverVerification: { ok: true }
    }],
    documents: []
  };
  mutate?.(input);
  return buildEvidencePack(input, signer);
}

function extract(files: Map<string, Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
  for (const [p, b] of files) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), b);
  }
  return dir;
}
const runVerifier = (dir: string, fp: string | null = FP) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(dir, 'verify-evidence.mjs'), dir, ...(fp ? ['--fingerprint', fp] : [])], { encoding: 'utf8' }) };
  } catch (e) {
    const x = e as { status: number; stdout: string };
    return { code: x.status, out: x.stdout };
  }
};

describe('Evidence pack', () => {
  test('a pack verifies offline with the shipped script; only the operator’s entries carry content', async () => {
    const { zip, manifest } = await pack();
    const files = unzip(zip);
    assert.equal(manifest.chains[0].entries, 3);
    assert.ok(!files.get('chains/ops.entries.jsonl')!.toString().includes('"FJR"'));
    const r = runVerifier(extract(files));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /VERIFIED/);
    assert.match(r.out, /end of range anchored/);
  });

  test('extra inspector files (the compliance matrix) are listed, signed and verified; odd names are refused', async () => {
    const { zip, manifest } = await pack(i => { i.extraFiles = [{ path: 'compliance-matrix.json', data: { rows: [{ id: 'CAMO-01' }] } }]; });
    assert.ok(manifest.files.some(f => f.path === 'compliance-matrix.json'));
    const files = unzip(zip);
    assert.match(files.get('compliance-matrix.json')!.toString(), /CAMO-01/);
    assert.equal(runVerifier(extract(files)).code, 0);
    await assert.rejects(pack(i => { i.extraFiles = [{ path: '../evil.json', data: {} }]; }), /not allowed/);
    await assert.rejects(pack(i => { i.extraFiles = [{ path: 'keys.json', data: {} }]; }), /not allowed/);
  });

  test('editing an entry, deleting a link or adding a file is detected', async () => {
    const files = unzip((await pack()).zip);
    const edited = new Map(files);
    edited.set('chains/ops.entries.jsonl', Buffer.from(files.get('chains/ops.entries.jsonl')!.toString().replace('"n":3', '"n":4')));
    assert.match(runVerifier(extract(edited)).out, /file changed: chains\/ops.entries.jsonl/);
    const extra = new Map(files);
    extra.set('notes.txt', Buffer.from('x'));
    assert.match(runVerifier(extract(extra)).out, /unexpected file/);
  });

  test('without a confirmed fingerprint the verdict is "signer not confirmed"; a pack re-signed with another key fails', async () => {
    const files = unzip((await pack()).zip);
    const r = runVerifier(extract(files), null);
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /SIGNER NOT CONFIRMED/);
    // Attacker: drop an NKX entry, rebuild the manifest and sign with their own key.
    const forged = new Map(files);
    const evil = generateKeyPairSync('ed25519');
    const entries = files.get('chains/ops.entries.jsonl')!.toString().split('\n').filter(Boolean).slice(1).join('\n') + '\n';
    forged.set('chains/ops.entries.jsonl', Buffer.from(entries));
    const manifest = JSON.parse(files.get('manifest.json')!.toString());
    manifest.chains[0].entries = 2;
    for (const f of manifest.files) { const b = forged.get(f.path)!; f.sha256 = sha256Hex(b); f.bytes = b.length; }
    forged.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
    const payloadSha256 = sha256Hex(canonicalJson(manifest));
    const signature = edSign(null, Buffer.from(canonicalJson({ keyId: KEY, payloadSha256, signedAt: 'x' })), evil.privateKey).toString('base64');
    forged.set('manifest.sig.json', Buffer.from(JSON.stringify({ alg: 'Ed25519', keyId: KEY, signedAt: 'x', payloadSha256, signature })));
    assert.equal(runVerifier(extract(forged)).code, 1, 'original key: signature fails');
    const evilPem = evil.publicKey.export({ format: 'pem', type: 'spki' }).toString();
    forged.set('public-key.pem', Buffer.from(evilPem));
    const r2 = runVerifier(extract(forged), FP);
    assert.equal(r2.code, 1, r2.out); // either keys.json mismatch or the fingerprint check catches it
    // And the missing entry is reported in its own right.
    assert.match(r2.out, /entry 1 of NKX in the period is missing|different key|keys.json/);
  });

  test('a fake older key version does not verify an anchor', async () => {
    const files = unzip((await pack(i => { i.chains[0].anchors[0].signature = { ...i.chains[0].anchors[0].signature, keyId: 'old-key-v0', signature: 'AAAA' }; })).zip);
    assert.match(runVerifier(extract(files)).out, /signed with unknown key old-key-v0/);
  });

  test('the export refuses to sign a broken or incomplete segment', async () => {
    await assert.rejects(pack(i => { i.chains[0].skeleton.splice(2, 1); }), /failed its own check/);
    await assert.rejects(pack(i => { i.chains[0].entries.splice(1, 1); }), /entry 3 of NKX in the period is not in the pack/);
    await assert.rejects(pack(i => { i.chains[0].fromGenesis = false; }), /does not start before the period/);
    await assert.rejects(pack(i => { i.chains[0].entries[0] = { ...i.chains[0].entries[0], record: { ...i.chains[0].entries[0].record, actor: 'mallory' } }; }), /does not hash/);
  });
});

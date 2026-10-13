import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import type { TaskCard } from '@aeroos/mro-domain';
import { renderCrsPdf, winAnsi } from './crs-pdf';

const sig = { alg: 'Ed25519' as const, keyId: 'transit:aeroos-signing:v1', signedAt: '2026-10-08T12:00:00.000Z', payloadSha256: 'a'.repeat(64), signature: 'B'.repeat(88) };
const stamp = { personnelId: 'P-4471', name: 'Kevin Mwangi', licence: 'NO.66.4471', at: new Date('2026-10-08T11:00:00Z'), rule: 'EASA@2026.1', via: 'Part-66 B1.1 · B737-800 · C-AUTH 145-112', signature: sig };
const card: TaskCard = {
  id: 'TC-77901', operatorId: 'NKX', tail: 'LN-ABC', aircraftType: 'B737-800', title: 'Rectify — landing light (one of two)', ata: '33', trade: 'AVIONICS',
  source: { type: 'EO', id: 'EO-2026-0431' },
  steps: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: `Step ${i + 1}: inspect the operator’s “item” per AMM 33-42-01 …`, stamp })),
  status: 'CERTIFIED', crs: { ...stamp, number: 'CRS-88201' }, createdAt: new Date('2026-10-08T09:00:00Z'), version: 32
};

test('the CRS PDF renders, survives non-WinAnsi text and paginates', async () => {
  const bytes = await renderCrsPdf({ operatorName: 'Nordkapp Air', card, publicKeyFingerprint: 'f'.repeat(64) });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(doc.getTitle(), 'CRS-88201 - LN-ABC');
});

test('typography is mapped to the standard font encoding', () => {
  assert.equal(winAnsi('A — B · C ’d “q” 漢'), `A - B - C 'd "q" ?`);
});

test('a card without a CRS cannot be rendered', async () => {
  await assert.rejects(renderCrsPdf({ operatorName: 'X', card: { ...card, crs: null }, publicKeyFingerprint: '' }), /has no CRS/);
});

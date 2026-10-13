import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { TaskCard } from '@aeroos/mro-domain';

/**
 * Renders the Certificate of Release to Service as a PDF (Part-145.A.50 / AMC). The PDF is a
 * human-readable rendering: the legally significant record is the signed CRS in the task card and
 * the audit chain. The PDF carries the signature, key id and payload hash so anyone can check it
 * against the published public key, and its own SHA-256 is recorded in the "documents" audit chain.
 */

/** Standard PDF fonts only cover WinAnsi; map common typography and drop anything else. */
export function winAnsi(s: string): string {
  return s
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/·/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E -ÿ]/g, '?');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of winAnsi(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      // Very long tokens (signatures) are broken by character.
      let w = word;
      while (font.widthOfTextAtSize(w, size) > width) {
        let n = w.length;
        while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--;
        if (line) { out.push(line); line = ''; }
        out.push(w.slice(0, n));
        w = w.slice(n);
      }
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > width) { out.push(line); line = w; } else line = candidate;
    }
    out.push(line);
  }
  return out;
}

export interface CrsPdfInput {
  operatorName: string;
  card: TaskCard;
  publicKeyFingerprint: string;
}

export async function renderCrsPdf({ operatorName, card, publicKeyFingerprint }: CrsPdfInput): Promise<Uint8Array> {
  const crs = card.crs;
  if (!crs) throw new Error(`${card.id} has no CRS`);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${crs.number} - ${card.tail}`);
  pdf.setAuthor(operatorName);
  pdf.setSubject('Certificate of Release to Service');
  pdf.setProducer('AeroOS');
  pdf.setCreationDate(crs.at);

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const ink = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.38, 0.42, 0.48);
  const M = 48;
  let page: PDFPage = pdf.addPage([595.28, 841.89]); // A4
  let y = page.getHeight() - M;
  const W = page.getWidth() - 2 * M;

  const ensure = (h: number) => {
    if (y - h < M) { page = pdf.addPage([595.28, 841.89]); y = page.getHeight() - M; }
  };
  const text = (s: string, o: { f?: PDFFont; size?: number; color?: typeof ink; gap?: number; indent?: number } = {}) => {
    const size = o.size ?? 10;
    const f = o.f ?? font;
    for (const line of wrap(s, f, size, W - (o.indent ?? 0))) {
      ensure(size + 4);
      page.drawText(line, { x: M + (o.indent ?? 0), y: y - size, size, font: f, color: o.color ?? ink });
      y -= size + 4;
    }
    y -= o.gap ?? 0;
  };
  const rule = () => { ensure(10); page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + W, y: y - 4 }, thickness: 0.6, color: muted }); y -= 12; };
  const field = (label: string, value: string) => {
    ensure(14);
    page.drawText(winAnsi(label), { x: M, y: y - 10, size: 8, font: bold, color: muted });
    const lines = wrap(value, font, 10, W - 130);
    lines.forEach((l, i) => page.drawText(l, { x: M + 130, y: y - 10 - i * 14, size: 10, font, color: ink }));
    y -= Math.max(1, lines.length) * 14;
  };

  text(operatorName.toUpperCase(), { f: bold, size: 9, color: muted });
  text('CERTIFICATE OF RELEASE TO SERVICE', { f: bold, size: 18, gap: 2 });
  text(`${crs.number}`, { f: mono, size: 12, gap: 6 });
  rule();
  field('Aircraft', `${card.tail} (${card.aircraftType})`);
  field('Task card', `${card.id} - ${card.title}`);
  field('Engineering order', card.source.id);
  field('ATA / trade', `${card.ata} / ${card.trade.toLowerCase()}`);
  field('Released', `${crs.at.toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  rule();

  text('Work performed', { f: bold, size: 11, gap: 2 });
  for (const s of card.steps) {
    text(`${s.n}. ${s.text}`, { indent: 0 });
    if (s.stamp) text(`Stamped by ${s.stamp.name} (${s.stamp.licence}) at ${s.stamp.at.toISOString().slice(0, 16).replace('T', ' ')} UTC under ${s.stamp.rule} - ${s.stamp.via}`, { size: 8, color: muted, indent: 14, gap: 2 });
  }
  y -= 6;
  rule();

  text('Certification', { f: bold, size: 11, gap: 2 });
  text('Certifies that the work specified, except as otherwise specified, was carried out in accordance with Part-145 and in respect to that work the aircraft is considered ready for release to service.', { gap: 8 });
  field('Certifying staff', crs.name);
  field('Licence', crs.licence);
  field('Privilege', crs.via);
  field('Rule applied', crs.rule);
  rule();

  text('Electronic signature', { f: bold, size: 11, gap: 2 });
  field('Algorithm', crs.signature.alg);
  field('Key', `${crs.signature.keyId}  (public key SHA-256 ${publicKeyFingerprint.slice(0, 16)}...)`);
  field('Signed at', crs.signature.signedAt);
  field('Payload SHA-256', crs.signature.payloadSha256);
  ensure(14);
  page.drawText('Signature', { x: M, y: y - 10, size: 8, font: bold, color: muted });
  y -= 14;
  text(crs.signature.signature, { f: mono, size: 7 });
  y -= 6;
  text('Verify with the organisation public key published at /api/platform/signing-key. This PDF is a rendering of the signed record held in AeroOS; its SHA-256 is recorded in the tamper-evident audit trail.', { size: 8, color: muted });

  pdf.getPages().forEach((p, i, all) => p.drawText(`${crs.number} - page ${i + 1} of ${all.length}`, { x: M, y: 24, size: 7, font, color: muted }));
  return pdf.save();
}

import { useRef, useState } from 'react';

export function BarcodeScanButton({ onCode, label='Scan' }: { onCode(code: string): void; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  async function scan(file: File) {
    setError('');
    const Detector = (window as any).BarcodeDetector;
    if (!Detector) { setError('Barcode scanning is not supported by this browser'); return; }
    try {
      const detector = new Detector({ formats: ['qr_code','code_128','code_39','ean_13','ean_8','data_matrix'] });
      const image = await createImageBitmap(file);
      const found = await detector.detect(image);
      image.close();
      const code = found?.[0]?.rawValue?.trim();
      if (!code) setError('No barcode or QR code found'); else onCode(code);
    } catch (e) { setError((e as Error).message); }
  }
  return <span className="row" style={{ gap: 4 }}>
    <input ref={input} hidden type="file" accept="image/*" capture="environment" onChange={e => { const f=e.target.files?.[0]; if(f) void scan(f); e.target.value=''; }} />
    <button className="btn sm ghost" type="button" onClick={() => input.current?.click()}>{label}</button>
    {error && <span className="note" title={error}>scan unavailable</span>}
  </span>;
}

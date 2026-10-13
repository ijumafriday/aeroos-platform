import { useEffect, type ReactNode } from 'react';
import { remaining, tone } from '../lib/format';
import { useNow, useUi } from '../lib/store';

export const Pill = ({ children, tone: t = '' }: { children: ReactNode; tone?: string }) => <span className={`pill ${t}`}>{children}</span>;

export function Countdown({ until, size }: { until: string; size?: number }) {
  const now = useNow();
  const ms = Date.parse(until) - now;
  return <span className={`cd ${tone(ms)} ${ms < 6 * 3_600_000 ? 'blink' : ''}`} style={size ? { fontSize: size } : undefined}>{remaining(ms)}</span>;
}

export function Card({ title, meta, children, flush }: { title: ReactNode; meta?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      <div className="card-h"><h2>{title}</h2>{meta != null && <div className="meta">{meta}</div>}</div>
      <div className={`card-b ${flush ? 'flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Head({ crumb, title, desc, actions }: { crumb: string; title: string; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mhead">
      <div style={{ minWidth: 0 }}>
        <div className="crumb">{crumb}</div>
        <h1>{title}</h1>
        {desc && <p>{desc}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, eyebrow, title, tags, children }: {
  open: boolean; onClose(): void; eyebrow: string; title: string; tags?: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <aside id="drawer" className={open ? 'open' : ''} role="dialog" aria-label={title} aria-hidden={!open}>
      {open && (
        <>
          <div className="dr-head">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="crumb">{eyebrow}</div>
              <h2>{title}</h2>
              {tags && <div className="row" style={{ marginTop: 6 }}>{tags}</div>}
            </div>
            <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
          </div>
          <div className="dr-body">{children}</div>
        </>
      )}
    </aside>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose(): void; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="dialog-scrim" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-h"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close">✕</button></div>
        <div className="dialog-b">{children}</div>
        <div className="dialog-f">{footer}</div>
      </div>
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return <dl className="dl">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Toasts() {
  const toasts = useUi(s => s.toasts);
  return <div id="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}</div>;
}

export const ErrorNote = ({ error }: { error: unknown }) => (error ? <div className="err">{(error as Error).message}</div> : null);

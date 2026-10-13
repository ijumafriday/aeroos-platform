import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { AuditEntryDto, AuditVerifyDto } from '@aeroos/contracts';
import { api, download, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { short, zulu } from '../../lib/format';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

const CHAINS = [['camo', 'CAMO'], ['amo', 'AMO'], ['ops', 'OPS'], ['org', 'ORG'], ['documents', 'DOCS'], ['compliance', 'QA']] as const;
type Chain = (typeof CHAINS)[number][0];

export function AuditPage() {
  const [chain, setChain] = useState<Chain>('camo');
  const entries = useQuery({ queryKey: ['audit', chain], queryFn: () => api<AuditEntryDto[]>(`/platform/audit?chain=${chain}&limit=200`) });
  const key = useQuery({ queryKey: ['signing-key'], queryFn: () => api<{ keyId: string; alg: string; publicKeyPem: string; fingerprint: string }>('/platform/signing-key') });
  const verify = useMutation({ mutationFn: () => api<AuditVerifyDto>(`/platform/audit/verify?chain=${chain}`) });
  const toast = useUi(s => s.toast);
  const anchor = useMutation({
    mutationFn: () => post<{ seq: number | null; anchored: boolean }>(`/platform/audit/anchor?chain=${chain}`),
    onSuccess: r => { toast(r.anchored ? `Anchored ${chain} at entry #${r.seq}` : 'Already anchored at the current head', 'cyan'); verify.reset(); }
  });

  return (
    <>
      <Head
        crumb="Quality / Compliance"
        title="Audit Trail & Verification"
        desc="Every regulated action is appended to a hash-chained, append-only log, and each chain head is signed into write-once storage every hour. Verification recomputes every hash and compares the chain with its latest external anchor."
        actions={<>
          <div className="seg">{CHAINS.map(([k, l]) => <button key={k} className={chain === k ? 'on' : ''} onClick={() => { setChain(k); verify.reset(); }}>{l}</button>)}</div>
          <button className="btn" disabled={anchor.isPending} onClick={() => anchor.mutate()} title="Sign the chain head into write-once storage now">{anchor.isPending ? 'Anchoring…' : 'Anchor now'}</button>
          <button className="btn pri" disabled={verify.isPending} onClick={() => verify.mutate()}>{verify.isPending ? 'Verifying…' : 'Verify chain'}</button>
        </>}
      />
      <EvidenceExport />
      {verify.data && (
        <div className={`callout ${verify.data.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }}>
          {verify.data.ok
            ? <><b>Chain intact.</b> {verify.data.count} entries verified at {zulu(verify.data.verifiedAt)}. Head <span className="mono">{verify.data.head}</span></>
            : <><b>Chain broken at entry #{verify.data.brokenAtSeq}</b> ({verify.data.reason}). Report this to the quality manager.</>}
        </div>
      )}
      {verify.data && (
        <div className={`callout ${!verify.data.anchor ? '' : verify.data.anchor.matches ? 'green' : 'red'}`} style={{ marginBottom: 14 }}>
          {!verify.data.anchor
            ? <>No external anchor yet for this chain. Chain heads are signed and written to write-once storage every hour.</>
            : verify.data.anchor.matches
              ? <><b>Matches external anchor.</b> Entry #{verify.data.anchor.seq} equals the signed checkpoint written to write-once storage at {zulu(verify.data.anchor.anchoredAt)} (<span className="mono">{verify.data.anchor.objectKey}</span>).</>
              : <><b>Does not match the external anchor</b> at entry #{verify.data.anchor.seq} ({zulu(verify.data.anchor.anchoredAt)}). History before the anchor has been altered or the anchor cannot be verified. Report this to the quality manager.</>}
        </div>
      )}
      <ErrorNote error={verify.error ?? anchor.error ?? entries.error} />
      <div className="grid g-wide">
        <Card title={`Chain: ${chain}`} meta={`${entries.data?.length ?? 0} most recent`} flush>
          <div className="tbl-wrap" style={{ maxHeight: '62vh' }}>
            <table className="t">
              <thead><tr><th>#</th><th>When</th><th>Action</th><th>Entity</th><th>Actor</th><th>Rule</th><th>Hash</th></tr></thead>
              <tbody>
                {(entries.data ?? []).map(e => (
                  <tr key={e.seq}>
                    <td className="n">{e.seq}</td>
                    <td className="mono">{zulu(e.at)}</td>
                    <td><b>{e.action}</b></td>
                    <td className="mono">{e.entityId}</td>
                    <td className="note">{e.actor}</td>
                    <td>{e.rule ? <Pill tone="cyan">{e.rule}</Pill> : <span className="note">—</span>}</td>
                    <td className="mono note">{short(e.hash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Signature verification key">
          <p className="note">Authorities and auditors can verify any task-card stamp or CRS offline with this public key; they need no access to AeroOS.</p>
          {key.data && <div className="sigbox">key {key.data.keyId} · {key.data.alg}<br />SHA-256 fingerprint (give to inspectors separately): <b>{key.data.fingerprint}</b><br /><br />{key.data.publicKeyPem}</div>}
        </Card>
      </div>
    </>
  );
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Signed evidence pack for the authority: this operator's trail for a period, verifiable offline. */
function EvidenceExport() {
  const toast = useUi(s => s.toast);
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date(Date.now() + 86_400_000)));
  const exp = useMutation({
    mutationFn: () => download(`/compliance/evidence?from=${from}&to=${to}&chains=${CHAINS.map(c => c[0]).join(',')}`, 'aeroos-evidence.zip'),
    onSuccess: r => toast(`${r.name} · ${Math.round(r.bytes / 1024)} kB · manifest ${r.manifestSha256?.slice(0, 12) ?? ''}…`, 'green')
  });
  return (
    <Card title="Evidence pack for the authority" meta="signed ZIP · offline verifier included" >
      <div className="card-b stack">
        <span className="note">All audit chains of this operator for the period, the hash links that prove nothing was removed, the signed hourly anchors and the document register — signed with the platform key. The inspector runs <span className="mono">node verify-evidence.mjs pack --fingerprint …</span> on their own machine, with the key fingerprint you give them separately (shown below).</span>
        <div className="row">
          <label className="field" style={{ maxWidth: 170 }}><span>From (UTC)</span><input className="inp mono" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
          <label className="field" style={{ maxWidth: 170 }}><span>To (exclusive)</span><input className="inp mono" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
          <button className="btn pri" style={{ alignSelf: 'flex-end' }} disabled={exp.isPending || !from || !to} onClick={() => exp.mutate()}>{exp.isPending ? 'Building…' : 'Export evidence pack'}</button>
        </div>
        <ErrorNote error={exp.error} />
      </div>
    </Card>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FatigueReportDto, MeDto } from '@aeroos/contracts';
import { api, post } from '../../lib/api';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';
import { fatigueTone } from './Roster';

const KSS = ['', 'extremely alert', 'very alert', 'alert', 'rather alert', 'neither alert nor sleepy', 'some signs of sleepiness', 'sleepy, no effort to stay awake', 'sleepy, some effort to stay awake', 'very sleepy, fighting sleep'];
const SP = ['', 'fully alert, wide awake', 'very lively, not at peak', 'okay, somewhat fresh', 'a little tired', 'moderately tired, let down', 'extremely tired', 'completely exhausted'];

/** Fatigue reports (ORO.FTL.120): the safety office reviews them; a crew member sees and files their own. */
export function Fatigue() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const isCrew = !!me.data?.roles.includes('flight_crew');
  return (
    <>
      <Head crumb="Flight Ops / Fatigue Reports" title="Fatigue Reports (FRM)"
        desc="Confidential, non-punitive fatigue reporting: Karolinska Sleepiness Scale (1–9), Samn-Perelli (1–7), sleep in the last 24 hours and what happened. The safety office reviews each report (not the person who filed it); the operations control centre does not see them." />
      {isCrew && <FatigueForm />}
      <FatigueList />
    </>
  );
}

export function FatigueList({ reports }: { reports?: FatigueReportDto[] }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const q = useQuery({ queryKey: ['fatigue'], queryFn: () => api<FatigueReportDto[]>('/ops/fatigue'), enabled: !reports });
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<MeDto>('/me') });
  const canReview = !!me.data?.roles.includes('safety_manager');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const review = useMutation({ mutationFn: (id: number) => post<FatigueReportDto>(`/ops/fatigue/${id}/review`, { note: notes[id] ?? '' }),
    onSuccess: r => { toast(`FR-${r.id} reviewed`, 'green'); void qc.invalidateQueries({ queryKey: ['fatigue'] }); } });
  const list = reports ?? q.data ?? [];
  return (
    <Card title="Reports" meta={`${list.length}`}>
      <ErrorNote error={q.error ?? review.error} />
      {list.length === 0 && <div className="empty">No fatigue reports.</div>}
      {list.map(r => (
        <div key={r.id} className="block" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b className="mono">FR-{r.id}</b> <Pill tone={fatigueTone[r.severity]}>{r.severity.toLowerCase()}</Pill>
            <span className="note">{r.mine ? 'you' : r.crewName} · {r.reportedAt.slice(0, 16).replace('T', ' ')}Z{r.flightId ? ` · ${r.flightId}` : ''}</span>
            <span className="note">KSS {r.kss} ({KSS[r.kss]}) · Samn-Perelli {r.samnPerelli} ({SP[r.samnPerelli]}){r.sleepHours24 !== null ? ` · ${r.sleepHours24} h sleep in 24 h` : ''}</span>
            <Pill tone={r.status === 'OPEN' ? 'amber' : 'green'}>{r.status.toLowerCase()}</Pill>
          </div>
          <p style={{ margin: '6px 0' }}>{r.narrative}</p>
          {r.status === 'REVIEWED' && <div className="note">Reviewed by {r.reviewedBy} {r.reviewedAt?.slice(0, 10)}: {r.reviewNote}</div>}
          {r.status === 'OPEN' && canReview && !r.mine && (
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1 }}><label htmlFor={`rv-${r.id}`}>Review: what the safety office did</label>
                <input id={`rv-${r.id}`} className="inp" value={notes[r.id] ?? ''} maxLength={2000} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} /></div>
              <button className="btn" disabled={(notes[r.id] ?? '').trim().length < 3 || review.isPending} onClick={() => review.mutate(r.id)}>Mark reviewed</button>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

export function FatigueForm({ flights = [] }: { flights?: { id: string; label: string }[] }) {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [f, setF] = useState({ kss: 5, samnPerelli: 3, sleep: '', flightId: '', narrative: '' });
  const submit = useMutation({
    mutationFn: () => post<FatigueReportDto>('/ops/fatigue', {
      kss: f.kss, samnPerelli: f.samnPerelli, sleepHours24: f.sleep === '' ? null : Number(f.sleep), flightId: f.flightId || null, narrative: f.narrative
    }),
    onSuccess: r => {
      toast(`FR-${r.id} filed (${r.severity.toLowerCase()}) — thank you`, 'green');
      setF({ kss: 5, samnPerelli: 3, sleep: '', flightId: '', narrative: '' });
      void qc.invalidateQueries({ queryKey: ['fatigue'] });
      void qc.invalidateQueries({ queryKey: ['crew-hub'] });
    }
  });
  return (
    <Card title="Report fatigue">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="fr-kss">Sleepiness (KSS)</label>
          <select id="fr-kss" className="inp" value={f.kss} onChange={e => setF({ ...f, kss: Number(e.target.value) })}>
            {KSS.slice(1).map((t, i) => <option key={t} value={i + 1}>{i + 1} — {t}</option>)}
          </select></div>
        <div className="field"><label htmlFor="fr-sp">Fatigue (Samn-Perelli)</label>
          <select id="fr-sp" className="inp" value={f.samnPerelli} onChange={e => setF({ ...f, samnPerelli: Number(e.target.value) })}>
            {SP.slice(1).map((t, i) => <option key={t} value={i + 1}>{i + 1} — {t}</option>)}
          </select></div>
        <div className="field"><label htmlFor="fr-sleep">Sleep in last 24 h (h)</label>
          <input id="fr-sleep" className="inp" type="number" min={0} max={24} step={0.5} value={f.sleep} onChange={e => setF({ ...f, sleep: e.target.value })} /></div>
        {flights.length > 0 && <div className="field"><label htmlFor="fr-flight">Flight</label>
          <select id="fr-flight" className="inp" value={f.flightId} onChange={e => setF({ ...f, flightId: e.target.value })}>
            <option value="">—</option>{flights.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select></div>}
      </div>
      <div className="field"><label htmlFor="fr-text">What happened (at least 10 characters)</label>
        <textarea id="fr-text" className="inp" rows={3} maxLength={4000} value={f.narrative} onChange={e => setF({ ...f, narrative: e.target.value })} /></div>
      <div className="row"><button className="btn pri" disabled={f.narrative.trim().length < 10 || submit.isPending} onClick={() => submit.mutate()}>File report</button></div>
      <ErrorNote error={submit.error} />
    </Card>
  );
}

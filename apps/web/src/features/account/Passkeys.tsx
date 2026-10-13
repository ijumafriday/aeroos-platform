import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { PasskeyAssertionOptionsDto, PasskeyDto, PasskeyRegistrationOptionsDto } from '@aeroos/contracts';
import { api, ApiRequestError, post } from '../../lib/api';
import { reauthenticate, takePendingStepUp } from '../../lib/auth';
import { zulu } from '../../lib/format';
import { confirmWithPasskey, createPasskey, passkeysSupported } from '../../lib/passkey';
import { useUi } from '../../lib/store';
import { Card, ErrorNote, Head, Pill } from '../../components/ui';

const ALG: Record<number, string> = { [-7]: 'ES256', [-8]: 'EdDSA', [-257]: 'RS256' };

/** The signed-in user's passkeys: used to confirm a CRS (and later other regulated signatures). */
export function Passkeys() {
  const qc = useQueryClient();
  const toast = useUi(s => s.toast);
  const [label, setLabel] = useState('');
  const keys = useQuery({ queryKey: ['passkeys'], queryFn: () => api<PasskeyDto[]>('/platform/passkeys') });
  useEffect(() => { takePendingStepUp('add-passkey', 'me'); }, []);
  const add = useMutation({
    // A further passkey must be approved with one you already have (the server asks via approveWith).
    mutationFn: async () => {
      const o = await post<PasskeyRegistrationOptionsDto & { approveWith?: PasskeyAssertionOptionsDto }>('/platform/passkeys/options');
      const approval = o.approveWith ? { challengeId: o.approveWith.challengeId, assertion: await confirmWithPasskey(o.approveWith) } : undefined;
      const response = await createPasskey(o);
      return post<PasskeyDto>('/platform/passkeys', { challengeId: o.challengeId, label: label.trim() || 'Passkey', response, approval });
    },
    onSuccess: k => { setLabel(''); toast(`Passkey "${k.label}" added`, 'green'); void qc.invalidateQueries({ queryKey: ['passkeys'] }); }
  });
  const [revoking, setRevoking] = useState<string | null>(null);
  // Revoking needs approval with a passkey, or (lost device) a password sign-in from the last two minutes.
  const revoke = useMutation({
    mutationFn: async ({ id, withPassword }: { id: string; withPassword?: boolean }) => {
      const key = encodeURIComponent(id);
      if (!withPassword && passkeysSupported()) {
        const o = await post<PasskeyAssertionOptionsDto>(`/platform/passkeys/${key}/revoke/challenge`);
        return post(`/platform/passkeys/${key}/revoke`, { approval: { challengeId: o.challengeId, assertion: await confirmWithPasskey(o) } });
      }
      return post(`/platform/passkeys/${key}/revoke`, {});
    },
    onSuccess: () => { setRevoking(null); toast('Passkey revoked', 'amber'); void qc.invalidateQueries({ queryKey: ['passkeys'] }); }
  });
  // Back from signing in again to revoke a passkey (e.g. the device was lost).
  useEffect(() => {
    for (const k of keys.data ?? []) if (takePendingStepUp('revoke-passkey', k.credentialId)) revoke.mutate({ id: k.credentialId, withPassword: true });
  }, [keys.data]);
  const stepUp = add.error instanceof ApiRequestError && add.error.code === 'STEP_UP_REQUIRED';
  // Offer the password path only when the passkey prompt failed (browser error) or the server asked for a fresh sign-in.
  const revokeStepUp = !!revoking && revoke.isError && (!(revoke.error instanceof ApiRequestError) || revoke.error.code === 'STEP_UP_REQUIRED');

  return (
    <>
      <Head crumb="Account" title="Passkeys" desc="A passkey on your phone, laptop or security key confirms your consequential signatures — step stamps, MEL extensions, the certificate of release to service — with your fingerprint, face or PIN. It signs over the exact record you approve, and the evidence is kept with the record." />
      {!passkeysSupported() && <div className="callout amber">This browser does not support passkeys. You can still confirm a CRS by signing in again.</div>}
      <Card title="Your passkeys" meta={`${keys.data?.length ?? 0}`} flush>
        <div className="list">
          {(keys.data ?? []).map(k => (
            <div key={k.credentialId} className="li">
              <span className="sev green" />
              <div style={{ minWidth: 0 }}>
                <b>{k.label}</b> <Pill>{ALG[k.alg] ?? k.alg}</Pill>
                <div className="sub">added {zulu(k.createdAt)} · last used {k.lastUsedAt ? zulu(k.lastUsedAt) : 'never'} · <span className="mono">{k.credentialId.slice(0, 16)}…</span></div>
              </div>
              <button className="btn sm ghost" disabled={revoke.isPending} onClick={() => { setRevoking(k.credentialId); revoke.mutate({ id: k.credentialId }); }}>Revoke</button>
            </div>
          ))}
          {keys.data?.length === 0 && <div className="empty">No passkeys yet.</div>}
        </div>
        <div className="card-b row">
          <input className="inp" style={{ maxWidth: 260 }} placeholder="Name, e.g. Hangar tablet" value={label} onChange={e => setLabel(e.target.value)} />
          <button className="btn pri" disabled={!passkeysSupported() || add.isPending} onClick={() => add.mutate()}>{add.isPending ? 'Waiting for your device…' : (keys.data?.length ? 'Add another passkey (approve with an existing one)' : 'Add a passkey')}</button>
        </div>
        <div className="card-b">
          {stepUp
            ? <div className="callout amber"><b>Sign in again first.</b> Adding a passkey needs a sign-in from the last few minutes.
                <div className="row" style={{ marginTop: 8 }}><button className="btn pri" onClick={() => void reauthenticate({ action: 'add-passkey', target: 'me' })}>Sign in again</button></div></div>
            : revokeStepUp
              ? <div className="callout amber"><b>Could not confirm with a passkey.</b> {revoke.error instanceof Error ? revoke.error.message : ''} If you no longer have the device, sign in again with your password and the passkey will be revoked.
                  <div className="row" style={{ marginTop: 8 }}><button className="btn pri" onClick={() => void reauthenticate({ action: 'revoke-passkey', target: revoking! })}>Sign in again and revoke</button></div></div>
              : <ErrorNote error={add.error ?? revoke.error} />}
        </div>
      </Card>
    </>
  );
}

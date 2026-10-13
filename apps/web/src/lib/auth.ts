import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

export interface RuntimeConfig { oidcAuthority: string; oidcClientId: string }

let manager: UserManager | null = null;

/** Runtime configuration is served by the web container, so one image fits every deployment. */
export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const res = await fetch('/runtime-config.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load /runtime-config.json');
  return res.json();
}

/**
 * OIDC authorization code flow with PKCE against Keycloak. Returns the signed-in user, or null
 * when the browser is being redirected to the login page.
 */
export async function initAuth(cfg: RuntimeConfig): Promise<User | null> {
  const m = new UserManager({
    authority: cfg.oidcAuthority,
    client_id: cfg.oidcClientId,
    redirect_uri: `${location.origin}/callback`,
    post_logout_redirect_uri: `${location.origin}/`,
    response_type: 'code',
    scope: 'openid profile email',
    automaticSilentRenew: true,
    userStore: new WebStorageStateStore({ store: window.sessionStorage })
  });
  manager = m;

  if (location.pathname === '/callback') {
    const user = await m.signinRedirectCallback();
    const target = typeof user.state === 'string' && user.state.startsWith('/') ? user.state : '/';
    history.replaceState({}, '', target);
    return user;
  }

  const user = await m.getUser();
  if (user && !user.expired) return user;
  try {
    if (user?.refresh_token) return await m.signinSilent();
  } catch {
    /* fall through to interactive login */
  }
  await m.signinRedirect({ state: location.pathname + location.search });
  return null;
}

/** A valid access token, refreshed if needed. */
export async function accessToken(): Promise<string> {
  if (!manager) throw new Error('Authentication not initialised');
  const user = await manager.getUser();
  if (user && !user.expired && (user.expires_in ?? 0) > 30) return user.access_token;
  try {
    const renewed = await manager.signinSilent();
    if (renewed) return renewed.access_token;
  } catch {
    /* session ended */
  }
  await manager.signinRedirect({ state: location.pathname + location.search });
  throw new Error('Signing in again');
}

export function onTokenRenewed(cb: (token: string) => void) {
  manager?.events.addUserLoaded(u => cb(u.access_token));
}

/**
 * Step-up: force a fresh login (OIDC prompt=login) and come back to the same page. Used before a
 * CRS, where the API requires an authentication younger than a few minutes. The pending action is
 * remembered so the page can offer to complete it on return.
 */
export async function reauthenticate(pending?: { action: string; target: string }) {
  try {
    if (pending) sessionStorage.setItem('aeroos:step-up', JSON.stringify({ ...pending, at: Date.now() }));
  } catch {
    /* storage unavailable — the user simply repeats the action */
  }
  await manager?.signinRedirect({ state: location.pathname + location.search, prompt: 'login' });
}

/** The action that was waiting for step-up, if the user just came back from re-authenticating (≤ 10 min). */
export function takePendingStepUp(action: string, target: string): boolean {
  try {
    const raw = sessionStorage.getItem('aeroos:step-up');
    if (!raw) return false;
    const p = JSON.parse(raw) as { action: string; target: string; at: number };
    if (p.action !== action || p.target !== target) return false;
    sessionStorage.removeItem('aeroos:step-up');
    return Date.now() - p.at < 10 * 60_000;
  } catch {
    return false;
  }
}

export function signOut() {
  void manager?.signoutRedirect();
}

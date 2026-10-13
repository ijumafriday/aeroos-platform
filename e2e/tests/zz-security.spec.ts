import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Runs last. Security headers on every kind of response, and the Content Security Policy (report-only in this
 * release): the pages below — sign-in, live updates, charts, downloads — must not trigger a single violation, so
 * the policy can be switched to enforcing.
 */
test('security headers on the app, the runtime config and the API', async ({ request }) => {
  for (const path of ['/', '/runtime-config.json', '/api/health']) {
    const r = await request.get(path);
    const h = r.headers();
    expect(h['x-content-type-options'], path).toBe('nosniff');
    expect(h['x-frame-options'], path).toBe('DENY');
    expect(h['referrer-policy'], path).toBeTruthy();
    expect(h['content-security-policy-report-only'] ?? h['content-security-policy'], path).toContain("frame-ancestors 'none'");
  }
  expect((await request.get('/runtime-config.json')).headers()['cache-control']).toBe('no-store');
});

test('no Content Security Policy violation across the main screens', async ({ page }) => {
  test.setTimeout(240_000);
  // The browser fires securitypolicyviolation for report-only policies too; collect them in every document
  // of the app origin (the Keycloak login page has its own policy and is not ours to judge).
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener('securitypolicyviolation', e => w.__csp.push(`${e.effectiveDirective} ${e.blockedURI || '(inline)'} @ ${location.pathname}`));
  });
  const violations: string[] = [];
  const collect = async () => { violations.push(...await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? [])); };
  await signIn(page, 'camo.manager', '/camo/mel');
  await collect();
  for (const path of ['/ops/occ', '/camo/programme', '/camo/health?tab=engines&engine=896230', '/camo/health?tab=damage&tail=LN-ABD', '/quality/compliance', '/quality/audit', '/finance/executive']) {
    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(1500);
    await collect();
  }
  expect(violations, violations.join('\n')).toEqual([]);
});

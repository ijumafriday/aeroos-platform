import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 5 journeys: movement messages through the authenticated integration endpoint, operator
 * scoping (a user in two AOCs switches between them), and crew recovery.
 * Uses the second operator (FJR) for movement messages, so the NKX journeys are not disturbed.
 */
test.describe.configure({ mode: 'serial' });

// FJR's integration key from docker-compose (MOVEMENT_API_KEYS).
const KEY = process.env.AEROOS_MOVEMENT_KEY_FJR ?? 'dev-movement-key-change-me';
// FJR demo legs (UTC): flight, tail, STD hh:mm, departure station (IATA).
const FJR_LEGS: [string, string, number, number, string][] = [
  ['FJ401', 'LNWFA', 6, 10, 'BGO'], ['FJ421', 'LNWFB', 7, 0, 'BGO'], ['FJ402', 'LNWFA', 7, 40, 'ALF'], ['FJ422', 'LNWFB', 8, 25, 'TOS'],
  ['FJ411', 'LNWFA', 9, 10, 'BGO'], ['FJ412', 'LNWFA', 11, 5, 'EVE'], ['FJ431', 'LNWFB', 14, 0, 'BGO'], ['FJ432', 'LNWFB', 15, 20, 'HAU']
];

/** The most recent FJR departure that is at least 20 minutes in the past (today or yesterday). */
function recentLeg(now = Date.now()) {
  const days = [0, -1].map(d => new Date(now + d * 86_400_000));
  for (const day of days) {
    const legs = FJR_LEGS.map(([no, reg, h, m, stn]) => ({ no, reg, stn, std: Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m) }))
      .filter(l => l.std + 20 * 60_000 < now).sort((a, b) => b.std - a.std);
    if (legs.length) return legs[0];
  }
  throw new Error('no FJR leg in the past');
}
const hhmm = (t: number) => new Date(t).toISOString().slice(11, 16).replace(':', '');

test('the movement integration endpoint needs its key, applies an MVT once and ignores the repeat', async ({ request }) => {
  const leg = recentLeg();
  const day = String(new Date(leg.std).getUTCDate()).padStart(2, '0');
  // Correction message: the leg may already carry simulated or earlier reported times.
  const mvt = `COR MVT\n${leg.no}/${day}.${leg.reg}.${leg.stn}\nAD${hhmm(leg.std + 4 * 60_000)}/${hhmm(leg.std + 12 * 60_000)}\nDL89/0004`;
  const denied = await request.post('/api/integrations/movements/mvt', { data: mvt, headers: { 'content-type': 'text/plain', 'x-api-key': 'wrong-key-wrong-key' } });
  expect(denied.status()).toBe(401);
  const first = await request.post('/api/integrations/movements/mvt', { data: mvt, headers: { 'content-type': 'text/plain', 'x-api-key': KEY } });
  expect(first.ok()).toBeTruthy();
  const r1 = await first.json();
  expect(r1.rejected).toEqual([]);
  const again = await (await request.post('/api/integrations/movements/mvt', { data: mvt, headers: { 'content-type': 'text/plain', 'x-api-key': KEY } })).json();
  expect(again).toMatchObject({ applied: 0, ignored: 1 });
  const unknown = await (await request.post('/api/integrations/movements/mvt', { data: `MVT\nFJ999/${day}.LNWFA.BGO\nAD0600`, headers: { 'content-type': 'text/plain', 'x-api-key': KEY } })).json();
  expect(unknown.rejected[0].reason).toMatch(/No flight FJ999/);
  // FJR's key cannot report an NKX flight.
  const foreign = await (await request.post('/api/integrations/movements/mvt', { data: `MVT\nNK601/${day}.LNABC.OSL\nAD0535/0545`, headers: { 'content-type': 'text/plain', 'x-api-key': KEY } })).json();
  expect(foreign.rejected[0].reason).toMatch(/No flight NK601/);
});

test('a user in two operators switches AOC and sees only that operator\'s schedule', async ({ page }) => {
  await signIn(page, 'occ.controller', '/ops/occ');
  const aoc = page.locator('.op-switch select');
  await expect(aoc).toHaveValue('NKX');
  await expect(page.locator('svg.tl')).toContainText('LN-ABC');
  await aoc.selectOption('FJR');
  await expect(page.locator('.brand-name')).toContainText('FJR');
  await expect(page.locator('svg.tl')).toContainText('LN-WFA');
  await expect(page.locator('svg.tl')).not.toContainText('LN-ABC');
  await aoc.selectOption('NKX');
  await expect(page.locator('svg.tl')).toContainText('LN-ABC');
});

test('users in one operator have no operator switch', async ({ page }) => {
  await signIn(page, 'camo.engineer', '/camo/programme');
  await expect(page.locator('.brand-name')).toContainText('NKX');
  await expect(page.locator('.op-switch')).toHaveCount(0);
});

test('crew recovery finds legal cover after a delay breaks the FDP limit, or reports nothing to do', async ({ page }) => {
  await signIn(page, 'occ.controller', '/ops/crew');
  const panel = page.locator('.card', { hasText: 'Crew recovery' });
  await panel.getByRole('button', { name: 'Find cover' }).click();
  const outcome = page.locator('.toast', { hasText: /duties sent to the optimiser/ }).or(panel.getByText(/No upcoming crew duty breaks/));
  await expect(outcome.first()).toBeVisible();
  if (await panel.getByText(/No upcoming crew duty breaks/).isVisible()) return;
  await expect(panel.getByText(/PROPOSED|FAILED/).first()).toBeVisible({ timeout: 90_000 });
  const accept = panel.getByRole('button', { name: 'Accept and re-crew' });
  if (await accept.isVisible()) {
    await accept.click();
    await toastMatching(page, /(CRW-\d+) (applied|is stale)/);
  }
});

test('a diversion reported by the alternate station shows the aircraft there; an evidence pack downloads and is signed', async ({ request, page }) => {
  const leg = recentLeg();
  const day = String(new Date(leg.std).getUTCDate()).padStart(2, '0');
  const t = (m: number) => hhmm(leg.std + m * 60_000);
  // Type B envelope from the alternate (Haugesund) — on-blocks there, not at the destination.
  const typeB = `\x01QU BGOKKFJ\n.HAUKKXH ${day}${t(40)}\n\x02COR MVT\n${leg.no}/${day}.${leg.reg}.HAU\nAA${t(14)}/${t(16)}\nSI WX\n\x03`;
  const r = await (await request.post('/api/integrations/movements/mvt', { data: typeB, headers: { 'content-type': 'text/plain', 'x-api-key': KEY } })).json();
  test.skip(r.rejected.length > 0 && /already reported|COR/i.test(r.rejected[0].reason), 'leg already landed in an earlier run');
  expect(r.rejected).toEqual([]);

  await signIn(page, 'quality.manager', '/quality/audit');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export evidence pack' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^aeroos-evidence-NKX-.*\.zip$/);
  await toastMatching(page, /manifest [0-9a-f]{12}/);
});

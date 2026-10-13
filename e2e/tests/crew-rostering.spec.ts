import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 13: crew planning builds a roster proposal for days without crew and accepts it; a short-notice
 * publication needs a reason; a crew member sees their hub and files a fatigue report that the safety office
 * reviews. Repeatable: a second run finds the days already crewed (nothing to propose) and carries on.
 * Uses days +8 and +9 so it stays clear of the live days the other journeys work on.
 */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('crew planning: build, accept and publish a roster', async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, 'occ.controller', `/ops/roster?from=${day(8)}&to=${day(9)}`);
  await expect(page.getByRole('heading', { name: 'Crew Rostering' })).toBeVisible();
  await page.getByRole('button', { name: /Build roster proposal/ }).click();
  const m = await toastMatching(page, /(RR-\d+): (\d+) assignments proposed/);
  if (Number(m[2]) > 0) {
    const run = page.locator('.block', { hasText: m[1] });
    await run.getByRole('button', { name: 'Accept' }).click();
    await toastMatching(page, new RegExp(`${m[1]} accepted`));
  }
  // less than 14 days ahead: refused without a reason, accepted with one
  await page.getByRole('button', { name: /^Publish / }).click();
  await expect(page.locator('.err')).toContainText('14 days');
  await page.locator('#pub-note').fill('e2e: schedule change from the commercial department');
  await page.getByRole('button', { name: /^Publish / }).click();
  await toastMatching(page, /published \(short notice\)/);
});

test('a crew member sees their roster and reports fatigue; the safety office reviews it', async ({ browser }) => {
  test.setTimeout(180_000);
  const crew = await browser.newPage();
  await signIn(crew, 'ola.hansen', '/crew/me');
  await expect(crew.getByRole('heading', { name: /My roster — Ola Hansen/ })).toBeVisible();
  await crew.locator('#fr-kss').selectOption('8');
  await crew.locator('#fr-text').fill('e2e: very sleepy on the last sector after two early starts in a row');
  await crew.getByRole('button', { name: 'File report' }).click();
  const m = await toastMatching(crew, /FR-(\d+) filed \(high\)/);
  await crew.close();

  const qm = await browser.newPage();
  await signIn(qm, 'safety.manager', '/ops/fatigue');
  const report = qm.locator('.block', { hasText: `FR-${m[1]}` });
  await expect(report).toContainText('two early starts');
  await report.locator(`#rv-${m[1]}`).fill('Discussed with crew planning: no third consecutive early start for this pattern.');
  await report.getByRole('button', { name: 'Mark reviewed' }).click();
  await toastMatching(qm, new RegExp(`FR-${m[1]} reviewed`));
  await qm.close();
});

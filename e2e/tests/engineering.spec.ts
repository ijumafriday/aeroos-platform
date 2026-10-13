import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 9 journeys: an AD is recorded and evaluated by one CAMO engineer, incorporated by the CAMO manager
 * (four-eyes) and appears on the due list; a certifying engineer acknowledges the effective MOE revision.
 * Each run records its own AD (unique reference), so the suite can be repeated against the same stack.
 */
const ref = `EASA AD 2099-${String(Date.now()).slice(-6)}`;

test('an AD is recorded and evaluated by CAMO', async ({ page }) => {
  await signIn(page, 'camo.engineer', '/camo/directives');
  await page.getByRole('button', { name: 'Record AD / SB' }).click();
  await page.locator('#d-ref').fill(ref);
  await page.locator('#d-title').fill('E2E — pitot probe connector inspection');
  await page.locator('#d-ata').fill('34');
  await page.getByLabel('B737-800').check();
  await page.locator('#d-act').fill('Inspect the pitot probe electrical connector for corrosion.');
  await page.locator('#d-fc').fill('1200');
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await toastMatching(page, /recorded — \d+ aircraft affected/);
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText(ref);
  await drawer.getByRole('button', { name: 'Record evaluation' }).click();
  await toastMatching(page, /evaluated — evaluated/);
  // The evaluator cannot also incorporate it.
  await expect(drawer.getByRole('button', { name: 'Incorporate into the maintenance programme' })).toBeDisabled();
});

test('the CAMO manager incorporates it and it is on the due list', async ({ page }) => {
  await signIn(page, 'camo.manager', '/camo/directives');
  await page.locator('tr', { hasText: ref }).click();
  const drawer = page.locator('#drawer');
  await drawer.getByRole('button', { name: 'Incorporate into the maintenance programme' }).click();
  await toastMatching(page, /is now on the due list/);
  await page.goto('/camo/programme');
  await expect(page.getByText(ref).first()).toBeVisible({ timeout: 30_000 });
});

test('a certifying engineer reads and acknowledges the effective MOE revision', async ({ page }) => {
  await signIn(page, 'k.mwangi', '/org/documents');
  await page.locator('tr', { hasText: 'Maintenance Organisation Exposition' }).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText(/Effective revision \d+/); // wait for the drawer's data before branching
  const ack = drawer.getByRole('button', { name: /I have read and understood revision/ });
  if (await ack.isVisible()) {
    await ack.click();
    await toastMatching(page, /acknowledged/);
  }
  await expect(drawer.getByText('you acknowledged it')).toBeVisible();
});

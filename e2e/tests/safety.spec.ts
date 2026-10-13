import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 10: a mechanic files a confidential safety report; the safety manager sees who filed it, a colleague
 * does not; the safety manager triages it on the risk matrix. Each run files its own report.
 */
const title = `E2E hazard ${String(Date.now()).slice(-6)} — unlit hangar door step`;
let id = '';

test('a mechanic files a confidential safety report', async ({ page }) => {
  await signIn(page, 'k.mwangi', '/safety/reports');
  await page.getByRole('button', { name: 'Report an occurrence' }).click();
  await page.locator('#o-title').fill(title);
  await page.locator('#o-desc').fill('The step at the H2 personnel door is not lit at night; two people tripped this week.');
  await page.getByLabel(/Confidential/).check();
  await page.getByRole('button', { name: 'Submit report' }).click();
  id = (await toastMatching(page, /(OR-\d{4}-\d{4}) reported/))[1];
});

test('the safety manager sees the reporter and triages on the risk matrix', async ({ page }) => {
  await signIn(page, 'safety.manager', `/safety/reports?report=${id}`);
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText(title);
  await expect(drawer).toContainText('k.mwangi');
  await drawer.getByRole('cell', { name: '2D' }).click();
  await drawer.getByRole('button', { name: 'Record triage' }).click();
  await toastMatching(page, new RegExp(`${id} triaged`));
});

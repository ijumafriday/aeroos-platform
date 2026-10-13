import { expect, test } from '@playwright/test';
import { acknowledgeRequiredReading, signIn, toastMatching } from './helpers';

/**
 * The Delivery 1 + 2 reference journey, end to end across CAMO → AMO → Org Core → Quality:
 * deferral → engineering order → task card → refused / allowed certification → CRS + PDF →
 * deferral closed → audit chain verified against its external anchor.
 */
test.describe.configure({ mode: 'serial' });

let melId = '';
let eoId = '';

test('CAMO engineer raises a deferral and releases an engineering order', async ({ page }) => {
  await signIn(page, 'camo.engineer', '/camo/mel');
  await page.getByRole('button', { name: 'Raise deferral' }).click();
  await page.locator('#rd-tail').selectOption('LN-ABC');
  await page.locator('#rd-mel').selectOption('33-42-01');
  await page.locator('#rd-desc').fill(`E2E LDG LIGHT L INOP ${Date.now()}`);
  await page.getByRole('dialog').getByRole('button', { name: 'Raise deferral' }).click();
  melId = (await toastMatching(page, /(DD-\d+) raised/))[1];

  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText(melId);
  await expect(drawer).toContainText('EASA@2026.1'); // the rule behind the deadline is shown
  await drawer.getByRole('button', { name: 'Generate AMO engineering order' }).click();
  eoId = (await toastMatching(page, /(EO-\d{4}-\d+) released/))[1];
});

test('an engineer whose continuation training has lapsed is refused, citing the rule', async ({ page }) => {
  await signIn(page, 'j.otieno', '/amo/task-cards');
  const card = page.locator('.tcard', { hasText: eoId });
  await expect(card).toBeVisible({ timeout: 60_000 }); // created by AMO from the Kafka event
  await card.click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('You may not certify this work');
  await expect(drawer).toContainText('Continuation training expired');
  await expect(drawer.getByRole('button', { name: 'Sign' }).first()).toBeDisabled();
});

test('a current, authorised engineer stamps every step and issues the CRS with its PDF', async ({ page }) => {
  await signIn(page, 'k.mwangi', '/amo/task-cards'); // fresh login, so the CRS step-up is satisfied
  await acknowledgeRequiredReading(page); // the exposition must have been read before signing (145.A.30(e))
  await page.goto('/amo/task-cards');
  await page.locator('.tcard', { hasText: eoId }).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('You may certify this work');
  const sign = drawer.getByRole('button', { name: 'Sign', exact: true });
  for (let left = await sign.count(); left > 0; left--) {
    await sign.first().click();
    await expect(sign).toHaveCount(left - 1); // wait for the card to refresh before the next step
  }
  await drawer.getByRole('button', { name: 'Issue Certificate of Release to Service' }).click();
  await toastMatching(page, /(CRS-\d+) issued/);
  await expect(drawer.getByRole('button', { name: 'Open CRS (PDF)' })).toBeVisible({ timeout: 60_000 });
});

test('the deferral closed itself from the CRS event', async ({ page }) => {
  await signIn(page, 'camo.engineer', `/camo/mel?item=${melId}`);
  await expect(page.locator('#drawer')).toContainText(/CLOSED/i, { timeout: 60_000 });
});

test('the quality manager records training and the engineer becomes current', async ({ page }) => {
  await signIn(page, 'quality.manager', '/org/personnel');
  await page.getByRole('row', { name: /Joseph Otieno/ }).click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Not current');
  await drawer.getByRole('button', { name: 'Record training' }).click();
  await page.getByRole('dialog', { name: /Record training/ }).getByRole('button', { name: 'Record' }).click();
  await toastMatching(page, /Training recorded for Joseph Otieno/);
  await expect(drawer).toContainText('Current — may exercise certification privileges');
});

test('suspending an authorisation is immediate and reasoned; reinstating restores it', async ({ page }) => {
  await signIn(page, 'quality.manager', '/org/personnel');
  await page.getByRole('row', { name: /Joseph Otieno/ }).click();
  const drawer = page.locator('#drawer');
  await drawer.getByRole('button', { name: 'Suspend' }).click();
  await page.locator('#st-r').fill('E2E audit finding QA-2026-999');
  await page.getByRole('dialog', { name: /Suspend/ }).getByRole('button', { name: 'Suspend' }).click();
  await expect(drawer).toContainText('SUSPENDED');
  await drawer.getByRole('button', { name: 'Reinstate' }).click();
  await page.locator('#st-r').fill('E2E finding closed');
  await page.getByRole('dialog', { name: /Reinstate/ }).getByRole('button', { name: 'Reinstate' }).click();
  await expect(drawer.locator('.auth-card.live')).toBeVisible();
});

test('the auditor verifies the AMO chain and its external anchor', async ({ page }) => {
  await signIn(page, 'auditor', '/quality/audit');
  await page.locator('.seg').getByRole('button', { name: 'AMO' }).click();
  await page.getByRole('button', { name: 'Anchor now' }).click();
  await page.getByRole('button', { name: 'Verify chain' }).click();
  await expect(page.getByText('Chain intact.')).toBeVisible();
  await expect(page.getByText('Matches external anchor.')).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 12: the OCC prepares a domestic flight — load sheet, fuel, flight plan — and the release checks
 * reflect each step. Uses tomorrow's first Bergen flight so it is still scheduled; repeatable (saves overwrite).
 */
test('the OCC prepares a flight: load sheet, fuel, flight plan, checks', async ({ page }) => {
  const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await signIn(page, 'occ.controller', `/ops/dispatch?day=${day}`);
  await page.locator('tr', { hasText: 'ENGM–ENBR' }).first().click();
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText('Release checks');
  await drawer.locator('#ld-adults').fill('150');
  await drawer.locator('#ld-bags').fill('100');
  await drawer.getByRole('button', { name: 'Save load' }).click();
  await toastMatching(page, /Load sheet saved|release withdrawn/);
  await drawer.getByLabel('Block fuel kg').fill('7500');
  await drawer.getByRole('button', { name: 'Save fuel' }).click();
  await toastMatching(page, /Fuel saved/);
  await expect(drawer).toContainText('Zero-fuel mass');
  const file = drawer.getByRole('button', { name: /File flight plan|File again/ });
  if (await file.isEnabled()) { await file.click(); await toastMatching(page, /Flight plan filed/); }
  await expect(drawer).toContainText('(FPL-NKX');
});

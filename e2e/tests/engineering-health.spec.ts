import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 14: the EGT shift on 896230 (LN-ABC #2) is flagged with a borescope recommendation; a dent recorded on
 * LN-FNX beyond the allowable limits needs a repair and grounds the aircraft until a certifying engineer records
 * the repair. Uses LN-FNX (already AOG, not in the flying programme) at a fresh x position per run so runs do not interact.
 */
test('engine trend alert and a structural damage that grounds until repaired', async ({ browser }) => {
  test.setTimeout(240_000);
  const eng = await browser.newPage();
  await signIn(eng, 'camo.engineer', '/camo/health?tab=engines&engine=896230');
  const drawer = eng.locator('#drawer');
  await expect(drawer).toContainText(/egt shift/i, { timeout: 60_000 });
  await expect(drawer).toContainText('Borescope');

  await eng.goto('/camo/health?tab=damage&tail=LN-FNX');
  await eng.locator('#dm-zone').selectOption('200');
  // a fresh spot per run (dents repaired permanently below no longer interact; this keeps an interrupted run's dent away)
  const sec = Math.floor(Date.now() / 1000);
  const x = String(20000 + (sec % 350) * 200);
  const y = String(2500 + (Math.floor(sec / 350) % 40) * 300);
  await eng.locator('#dm-xMm').fill(x);
  await eng.locator('#dm-yMm').fill(y);
  await eng.locator('#dm-lengthMm').fill('60');
  await eng.locator('#dm-widthMm').fill('40');
  await eng.locator('#dm-depthMm').fill('3');
  await eng.locator('#dm-desc').fill('e2e: bird strike dent on the crown skin');
  await eng.getByRole('button', { name: 'Record & assess' }).click();
  const m = await toastMatching(eng, /(SD-\d+): repair — aircraft grounded until repaired/);
  await eng.close();

  const mech = await browser.newPage();
  await signIn(mech, 'k.mwangi', '/camo/health?tab=damage&tail=LN-FNX');
  await mech.locator('tr', { hasText: m[1] }).click();
  const d = mech.locator('#drawer');
  await expect(d).toContainText('grounds the aircraft');
  await d.locator('#rp-kind').selectOption('PERMANENT');
  await d.locator('#rp-data').fill('SRM 53-20-01 Fig 201 — blend out and external doubler');
  await d.getByRole('button', { name: 'Record repair' }).click();
  await toastMatching(mech, /Repair recorded/);
  await expect(d).toContainText('Does not ground the aircraft');
  await mech.close();
});

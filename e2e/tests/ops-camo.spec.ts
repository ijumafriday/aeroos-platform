import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Delivery 3 + 4 journeys: OCC disruption handling with the optimiser, the maintenance programme
 * loop (due list → work package → hangar task cards) and cross-domain search.
 */
test.describe.configure({ mode: 'serial' });

test('OCC sees the AOG tail and the optimiser proposes a recovery the controller can apply', async ({ page }) => {
  await signIn(page, 'occ.controller', '/ops/occ');
  await expect(page.locator('svg.tl')).toBeVisible();
  await expect(page.locator('.kpi', { hasText: 'Not dispatchable' })).toContainText('LN-RKG');
  await page.getByRole('button', { name: 'Run optimiser' }).click();
  const panel = page.locator('.card', { hasText: 'Disruption recovery' });
  await expect(panel.getByText(/PROPOSED|FAILED/)).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText('PROPOSED')).toBeVisible();
  const accept = panel.getByRole('button', { name: 'Accept and apply' });
  if (await accept.isVisible()) {
    await accept.click();
    await toastMatching(page, /(REC-\d+) (applied|is stale)/);
  }
});

test('a delay entered in the OCC reports its knock-on and the crew FTL impact', async ({ page }) => {
  await signIn(page, 'occ.controller', '/ops/occ');
  const disruption = page.locator('.card', { hasText: 'Disruptions' }).locator('button.li').first();
  test.skip(!(await disruption.isVisible()), 'no changeable flight with warnings in the window right now');
  await disruption.click();
  const drawer = page.locator('#drawer');
  test.skip(!(await drawer.getByRole('button', { name: 'Set delay' }).isVisible()), 'flight no longer changeable');
  await page.locator('#fd-delay').fill('45');
  await page.locator('#fd-reason').fill('93 late inbound (E2E)');
  await drawer.getByRole('button', { name: 'Set delay' }).click();
  await toastMatching(page, /ETD \d\d:\d\dZ/);
  await expect(drawer.getByText('FTL impact of your change')).toBeVisible();
});

test('CAMO turns due items into a planned, released work package and the hangar receives task cards', async ({ page }) => {
  await signIn(page, 'camo.engineer', '/camo/programme');
  await page.locator('button.kpi', { hasText: 'LN-ABD' }).click();
  const boxes = page.locator('table.t input[type=checkbox]');
  await expect(boxes.first()).toBeVisible();
  await boxes.first().check();
  await page.getByRole('button', { name: /Create work package/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
  const wpId = (await toastMatching(page, /(WP-\d+) created/))[1];
  const drawer = page.locator('#drawer');
  await expect(drawer).toContainText(wpId);
  await page.locator('#wp-bay').selectOption('OSL-H2');
  await drawer.getByRole('button', { name: 'Plan' }).click();
  await toastMatching(page, /planned in OSL-H2/);
  const readiness = drawer.locator('.dsec', { hasText: 'Release readiness' });
  for (const input of await readiness.locator('input[type=number]').all()) await input.fill('100');
  await readiness.getByRole('button', { name: 'Save readiness' }).click();
  await toastMatching(page, /readiness plan saved/);
  await readiness.getByRole('button', { name: 'Freeze scope' }).click();
  await toastMatching(page, /scope frozen/);
  await readiness.getByRole('button', { name: 'Release to AMO' }).click();
  await toastMatching(page, /released/);

  await page.goto('/amo/task-cards');
  await expect(page.locator('.tcard', { hasText: 'LN-ABD' }).first()).toBeVisible({ timeout: 60_000 });
  await page.goto('/amo/stores');
  await expect(page.locator('table.t', { hasText: wpId })).toBeVisible({ timeout: 60_000 });
});

test('Cmd+K finds things across domains', async ({ page }) => {
  await signIn(page, 'camo.manager', '/camo/mel');
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Search and commands' }).getByLabel('Search').fill('LN-NGX');
  await expect(page.locator('.cmd-item', { hasText: 'Aircraft' }).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

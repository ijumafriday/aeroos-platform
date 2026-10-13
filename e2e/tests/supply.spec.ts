import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 11: stores raises a requisition, records a quote from an approved supplier, awards it (below the approval
 * threshold, so the order is issued at once) and receives the parts against a certificate of conformity
 * (a standard part). Each run uses its own reason text, so it can be repeated.
 */
const reason = `E2E restock ${String(Date.now()).slice(-6)}`;

test('requisition → quote → order → receipt into stock', async ({ page }) => {
  await signIn(page, 'storekeeper', '/amo/supply?tab=requisitions');
  await page.locator('#rq-pn').fill('O-RING-MS29513');
  await page.locator('#rq-q').fill('10');
  await page.locator('#rq-r').fill(reason);
  await page.getByRole('button', { name: 'Raise requisition' }).click();
  await toastMatching(page, /Requisition raised/);

  const card = page.locator('.card', { hasText: reason });
  await card.getByLabel('Supplier').selectOption({ label: 'Nordic Aero Components AS' });
  await card.getByPlaceholder('Unit price').fill('2.40');
  await card.getByRole('button', { name: 'Record quote' }).click();
  await toastMatching(page, /Quote recorded/);
  await card.getByRole('button', { name: 'Award' }).first().click();
  const po = (await toastMatching(page, /(PO-\d+) issued/))[1];

  await page.goto('/amo/supply?tab=orders');
  const order = page.locator('.card', { hasText: po });
  await order.getByLabel('Certificate').selectOption('COC');
  await order.getByPlaceholder('Certificate tracking no.').fill('NAC-CoC-E2E');
  await order.getByRole('button', { name: 'Receive' }).click();
  await toastMatching(page, new RegExp(`${po}: received 10 into stock`));
  await expect(order).toContainText('received 10/10');
});

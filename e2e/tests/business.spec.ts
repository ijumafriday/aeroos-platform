import { expect, test } from '@playwright/test';
import { signIn, toastMatching } from './helpers';

/**
 * Round 15: a third-party maintenance order end to end — the manager quotes and records the customer's approval,
 * a certifying engineer books the work, finance invoices and records the payment, and the invoice appears in the
 * general ledger (posted from the event). Creates a new small order each run, so it is repeatable.
 */
test('third-party order: quote → approval → work → invoice → payment → ledger', async ({ browser }) => {
  test.setTimeout(300_000);
  const mgr = await browser.newPage();
  await signIn(mgr, 'camo.manager', '/amo/billing');
  await mgr.locator('#q-cust').selectOption({ label: 'Arctic Charter AS' });
  await mgr.locator('#q-reg').fill('LN-ACY');
  await mgr.locator('#q-type').fill('DHC-8-400');
  await mgr.locator('#q-title').fill('e2e: wheel and brake inspection');
  await mgr.getByLabel('Description 1').fill('Wheel and brake inspection');
  await mgr.getByLabel('Quantity 1').fill('2');
  await mgr.getByRole('button', { name: 'Create quote' }).click();
  const m = await toastMatching(mgr, /(CO-\d+) quoted/);
  const order = m[1];
  const drawer = mgr.locator('#drawer');
  await drawer.locator('#ap-ref').fill('AC-E2E-PO');
  await drawer.getByRole('button', { name: 'Record approval' }).click();
  await toastMatching(mgr, new RegExp(`${order} approved`));
  await mgr.close();

  const mech = await browser.newPage();
  await signIn(mech, 'k.mwangi', `/amo/billing?order=${order}`);
  const d2 = mech.locator('#drawer');
  await d2.getByLabel('Description', { exact: true }).fill('Wheel and brake inspection, both mains');
  await d2.getByLabel('Quantity', { exact: true }).fill('2');
  await d2.getByRole('button', { name: 'Book', exact: true }).click();
  await toastMatching(mech, /Work booked/);
  await d2.getByRole('button', { name: 'Work completed' }).click();
  await toastMatching(mech, new RegExp(`${order} completed`));
  await mech.close();

  const fin = await browser.newPage();
  await signIn(fin, 'finance', `/amo/billing?order=${order}`);
  const d3 = fin.locator('#drawer');
  await d3.getByRole('button', { name: /Issue invoice/ }).click();
  const inv = (await toastMatching(fin, /Invoiced: (INV-[A-Z]+-\d+-\d+)/))[1];
  await d3.locator(`#pa-${inv}`).fill('2625');
  await d3.locator(`#pr-${inv}`).fill(`E2E-${Date.now()}`);
  await d3.getByRole('button', { name: 'Record payment' }).click();
  await toastMatching(fin, /Saved/);
  await expect(d3).toContainText(/paid\b/);

  // the ledger posts from the event stream: give it a moment
  await expect(async () => {
    await fin.goto('/finance/ledger?entity=NKT');
    await expect(fin.locator('body')).toContainText(`Invoice ${inv}`, { timeout: 5_000 });
  }).toPass({ timeout: 90_000 });
  await expect(fin.locator('body')).toContainText('balanced');
  await fin.close();
});

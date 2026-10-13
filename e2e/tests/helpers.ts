import { expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.AEROOS_PASSWORD ?? 'aeroos';

/** Sign in through the Keycloak login page; each test starts with a fresh browser context. */
export async function signIn(page: Page, username: string, path = '/') {
  await page.goto(path);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#kc-login').click();
  await expect(page.locator('.user-chip')).toBeVisible();
}

/** Read the most recent toast that matches, e.g. "DD-24507 raised — …". */
export async function toastMatching(page: Page, re: RegExp): Promise<RegExpMatchArray> {
  const toast = page.locator('.toast', { hasText: re }).last();
  await expect(toast).toBeVisible();
  const m = (await toast.innerText()).match(re);
  if (!m) throw new Error(`toast did not match ${re}`);
  return m;
}

/**
 * Revoke every passkey of the signed-in user, via the lost-device path (sign in again with the password):
 * keys left by an interrupted earlier run belong to a virtual authenticator that no longer exists.
 * The page must be /account/passkeys.
 */
export async function revokeAllPasskeys(page: Page, username: string) {
  const rows = page.locator('.li', { hasText: 'added' });
  await expect(page.getByText(/Your passkeys/)).toBeVisible();
  for (let n = await rows.count(), i = 0; n > 0 && i < 10; n = await rows.count(), i++) {
    await rows.first().getByRole('button', { name: 'Revoke' }).click();
    const again = page.getByRole('button', { name: 'Sign in again and revoke' });
    // Either the passkey prompt fails (no such authenticator any more) and the password path is offered, or it is gone.
    await expect.poll(async () => (await again.isVisible()) || (await rows.count()) < n, { timeout: 90_000 }).toBe(true);
    if (await again.isVisible()) {
      await again.click();
      await expect(page.locator('#password')).toBeVisible();
      const user = page.locator('#username');
      if (await user.isEditable().catch(() => false)) await user.fill(username);
      await page.locator('#password').fill(PASSWORD);
      await page.locator('#kc-login').click();
    }
    await expect(rows).toHaveCount(n - 1, { timeout: 90_000 }); // wait for this revocation before the next
  }
}

/**
 * Certifying staff must have acknowledged the current exposition and key procedures before they may sign
 * (145.A.30(e)). Acknowledge whatever is outstanding for the signed-in user.
 */
export async function acknowledgeRequiredReading(page: Page) {
  await page.goto('/org/documents');
  // Wait for the list itself (the card title renders before the data).
  await expect(page.locator('tr', { hasText: 'Maintenance Organisation Exposition' })).toBeVisible();
  for (let i = 0; i < 6; i++) {
    const row = page.locator('tr', { hasText: 'to read' }).first();
    if (!(await row.isVisible())) break;
    await row.click();
    const drawer = page.locator('#drawer');
    await expect(drawer).toContainText(/Effective revision \d+/);
    await drawer.getByRole('button', { name: /I have read and understood revision/ }).click();
    await expect(drawer.getByText('you acknowledged it')).toBeVisible();
    await page.goto('/org/documents');
    await expect(page.locator('tr', { hasText: 'Maintenance Organisation Exposition' })).toBeVisible();
  }
}

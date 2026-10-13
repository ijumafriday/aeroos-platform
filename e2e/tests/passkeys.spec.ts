import { expect, test } from '@playwright/test';
import { revokeAllPasskeys, signIn, toastMatching } from './helpers';

/**
 * Passkeys with Chromium's virtual authenticator (DevTools protocol): a platform authenticator with
 * user verification, so the real WebAuthn ceremony runs end to end against the API's verifier.
 *
 * Uses quality.manager (who signs nothing passkey-gated in the other journeys) and leaves no passkey behind, so the
 * other journeys and the next run of this one start from a user without passkeys.
 */
const USER = 'quality.manager';

test('a passkey is added right after signing in, listed, and revoked with itself', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'virtual authenticator is a Chromium DevTools feature');
  test.setTimeout(300_000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true }
  });
  await signIn(page, USER, '/account/passkeys');
  await revokeAllPasskeys(page, USER);

  await page.getByPlaceholder('Name, e.g. Hangar tablet').fill('E2E virtual key');
  await page.getByRole('button', { name: 'Add a passkey' }).click();
  await toastMatching(page, /Passkey "E2E virtual key" added/);
  const row = page.locator('.li', { hasText: 'E2E virtual key' });
  await expect(row).toBeVisible();

  // Revoking needs approval with a passkey: the virtual authenticator signs the revoke challenge.
  await row.getByRole('button', { name: 'Revoke' }).click();
  await toastMatching(page, /Passkey revoked/);
  await expect(row).toHaveCount(0);
});

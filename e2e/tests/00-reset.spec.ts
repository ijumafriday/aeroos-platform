import { test } from '@playwright/test';
import { revokeAllPasskeys, signIn } from './helpers';

/**
 * Runs first (files run in name order, one worker): users whose journeys sign without a passkey must not
 * have one left over from an earlier, interrupted run (for example the 0.7 passkey journey enrolled k.mwangi).
 */
for (const user of ['k.mwangi', 'quality.manager', 'camo.engineer']) {
  test(`${user} starts without passkeys`, async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, user, '/account/passkeys');
    await revokeAllPasskeys(page, user);
  });
}

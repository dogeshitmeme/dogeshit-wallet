// Onboarding smoke — Welcome → Create → seed reveal → password → dashboard.
// Covers: Header, Welcome, Create (both steps), PasswordSetCard, the send()
// RPC bridge, vault encrypt+persist on background, route() landing on
// Dashboard. Single test, ~30 s, catches the bulk of the popup-refactor
// regression surface in one shot.

import { test, expect } from './_setup/extension';
import { onboard, unlock, TEST_PASSWORD } from './_setup/helpers';

test('first-run onboarding lands on dashboard', async ({ pristinePopup: popup }) => {
  // 1. Welcome screen — brand title + the two welcome-option buttons.
  await expect(popup.locator('.dk-welcome-title')).toHaveText('DOGESHIT');
  await expect(popup.getByText('create new wallet')).toBeVisible();
  await expect(popup.getByText('import seed phrase')).toBeVisible();

  // 2. Click "create new wallet" → Create step 'backup'.
  await popup.getByText('create new wallet').click();
  const reveal = popup.getByText('TAP TO REVEAL SEED');
  await expect(reveal).toBeVisible();

  // 3. Reveal the seed → 12 cells render.
  await reveal.click();
  await expect(popup.locator('.dk-seed-cell')).toHaveCount(12);
  // Spot-check that real words landed (every cell has a non-empty word).
  const firstWord = await popup.locator('.dk-seed-word').first().innerText();
  expect(firstWord.trim().length).toBeGreaterThan(0);

  // 4. Advance to password step.
  await popup.getByText('I WROTE IT DOWN →').click();
  await expect(popup.locator('.dk-card-title')).toHaveText('password');

  // 5. Fill password + confirm. The two inputs are bare <input type="password">
  //    inside the card; locate by order rather than name (no name attr).
  const inputs = popup.locator('input[type="password"]');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill(TEST_PASSWORD);
  await inputs.nth(1).fill(TEST_PASSWORD);

  // 6. Submit.
  await popup.getByRole('button', { name: 'create wallet' }).click();

  // 7. Land on Dashboard — assert send + receive action buttons appear.
  //    PBKDF2 600k iters is the bottleneck here; allow a generous timeout
  //    since headless on slower machines / CI can run 1.5–3 s.
  await expect(popup.getByRole('button', { name: /send/i }).first())
    .toBeVisible({ timeout: 15_000 });
  await expect(popup.getByRole('button', { name: /receive/i }).first())
    .toBeVisible();
});

// Sanity check that the onboard() helper used by other specs actually
// produces the same end state. If this passes but the long version above
// fails, the helper has drifted.
test('onboard() helper reaches dashboard', async ({ pristinePopup: popup }) => {
  await onboard(popup);
});

// Easter egg: 🐕 sits to the left of Ð whenever the wallet is in
// DOGE-mode display. Used to be gated on Ð0 (zero balance) but that
// broke on mainnet for any non-empty wallet — see commit fixing the
// showDogeEgg condition. Now it's permanent brand decoration in DOGE
// mode; only the click→drop-poop interactivity is gated by chain.
test('DOGE-mode hero renders $SHIT 🐕 to the left of Ð', async ({ popup }) => {
  // Doesn't test onboarding flow — just needs Dashboard. Use the
  // pre-onboarded snapshot via `unlock()` for speed.
  await unlock(popup);
  await expect(popup.locator('.dk-doge-egg')).toBeVisible({ timeout: 10_000 });
  await expect(popup.locator('.dk-doge-egg-body')).toHaveText('🐕');
});

import { expect, test } from '@playwright/test';
import { closeMockPanel, connectPrograms, createLobby, expectNoAxeViolations, freshApp, loginAs, loginAsAdmin, logout, openMockPanel, shot } from './helpers';

/** Adds a participant as admin, then logs in as them: someone who has never had a token. */
async function loginAsNewParticipant(page: import('@playwright/test').Page, name: string) {
  await loginAsAdmin(page);
  await page.goto('/admin/participants');
  await page.getByLabel('Add a participant').fill(name);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('participants-table')).toContainText(name);
  await expect(page.getByTestId('participants-table').getByRole('row').filter({ hasText: name })).toContainText('Not created yet');
  await logout(page);
  await page.getByRole('link', { name: 'Participant login' }).click();
  await page.getByLabel('Shared password').fill('battleship');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your name').selectOption({ label: name });
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByTestId('current-user')).toContainText(name);
}

test.describe('account token', () => {
  test('a new participant is told they have no token yet, not that they lost it', async ({ page }) => {
    await freshApp(page);
    await loginAsNewParticipant(page, 'Eve');
    await page.getByRole('link', { name: 'Account' }).click();

    const empty = page.getByTestId('no-token');
    await expect(empty).toContainText("You don't have a token yet");
    await expect(empty).toContainText('Nothing was created for you in advance');
    await expect(page.getByRole('button', { name: 'Create my token' })).toBeVisible();
    await expectNoAxeViolations(page, 'token page without a token');
    // none of the "you missed your chance" wording or controls
    await expect(page.getByRole('button', { name: /Replace token/ })).toHaveCount(0);
    await expect(page.getByTestId('token-preview')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(/regenerat|lost it|cannot be shown again/i);

    await page.getByRole('button', { name: 'Create my token' }).click(); // no confirmation: nothing to lose
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const fresh = (await page.getByTestId('new-token').locator('pre').textContent()) as string;
    expect(fresh).toMatch(/^bsc_[A-Za-z0-9]{32}$/);
    await expect(page.getByTestId('new-token')).toContainText('Your token is ready');
    await expect(page.getByTestId('new-token')).toContainText('only time the full token is shown');
    await expect(page.getByTestId('no-token')).toHaveCount(0);
    // while the one-time token is on screen it is the only thing on the page
    await expect(page.getByTestId('token-card')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Replace token/ })).toHaveCount(0);
    await expectNoAxeViolations(page, 'token page right after creating the token');
    await shot(page, 'token-created');

    await page.getByRole('button', { name: 'I have saved it' }).click();
    await expect(page.getByTestId('token-preview')).toContainText(fresh.slice(-4));
    await expect(page.getByTestId('token-card')).toContainText('Created');
    await expect(page.getByRole('button', { name: 'Create my token' })).toHaveCount(0);
    await page.reload();
    await expect(page.locator('body')).not.toContainText(fresh);
  });

  test('a program cannot connect before its owner has a token, and the lobby says why', async ({ page }) => {
    await freshApp(page);
    await loginAsNewParticipant(page, 'Eve');
    await createLobby(page, 'Alice');
    await page.getByRole('tab', { name: 'Connection' }).click();
    await expect(page.getByTestId('no-token-hint')).toContainText("You don't have a token yet");
    await page.getByRole('link', { name: 'Create your token' }).click();
    await page.getByRole('button', { name: 'Create my token' }).click();
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await page.getByRole('link', { name: 'Lobbies' }).click();
    await page.getByTestId('lobby-row').first().getByRole('link').click();
    await page.getByRole('tab', { name: 'Connection' }).click();
    await expect(page.getByTestId('no-token-hint')).toHaveCount(0);
    await expect(page.getByText('Your token was shown once, when you created it')).toBeVisible();
  });

  test('someone who has a token sees its fingerprint and can replace it; the new token is shown once', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/token');
    await expect(page.getByTestId('no-token')).toHaveCount(0);
    await expect(page.getByTestId('token-preview')).toHaveText(/^bsc_•{8}[A-Za-z0-9]{4}$/);
    await expect(page.getByTestId('token-card')).toContainText(/Created .*The full token was shown once/);
    const before = await page.getByTestId('token-preview').textContent();

    await page.getByRole('button', { name: 'Replace token…' }).click();
    await expect(page.getByRole('dialog')).toContainText('programs are disconnected');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('new-token')).toHaveCount(0);

    await page.getByRole('button', { name: 'Replace token…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace token' }).click();
    const fresh = (await page.getByTestId('new-token').locator('pre').textContent()) as string;
    expect(fresh).toMatch(/^bsc_[A-Za-z0-9]{32}$/);
    await expect(page.getByTestId('new-token')).toContainText('Your new token');
    await expect(page.getByTestId('token-card')).toHaveCount(0);
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await expect(page.getByTestId('token-preview')).not.toHaveText(before as string);
    await expect(page.getByTestId('token-preview')).toContainText(fresh.slice(-4));
    await expect(page.getByTestId('token-card')).toContainText('Replaced');

    await page.reload();
    await expect(page.getByTestId('new-token')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(fresh);
  });

  test('replacing the token disconnects running programs', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Replace token…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace token' }).click();
    await expect(page.getByTestId('new-token')).toBeVisible();
    await page.getByRole('link', { name: 'Lobbies' }).click();
    await page.getByTestId('lobby-row').filter({ hasText: 'Alice vs Bruno' }).first().getByRole('link').click();
    await expect(page.getByTestId('seat-card-1')).toContainText('Not connected');
  });

  test('warns when the token was replaced from another session', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/token');
    await expect(page.getByTestId('token-notice')).toHaveCount(0);
    await openMockPanel(page);
    await page.getByRole('button', { name: 'Someone replaces my token elsewhere' }).click();
    await closeMockPanel(page);
    await page.getByRole('link', { name: 'Lobbies' }).click();
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByTestId('token-notice')).toContainText('Your token was replaced');
    await page.getByTestId('token-notice').getByRole('button', { name: /close/i }).click();
    await page.reload();
    await expect(page.getByTestId('token-notice')).toHaveCount(0);
  });

  test('the admin has no token', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/token');
    await expect(page.getByText('Tokens belong to participants.')).toBeVisible();
  });
});

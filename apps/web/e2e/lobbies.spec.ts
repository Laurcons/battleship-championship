import { expect, test } from '@playwright/test';
import { createLobby, freshApp, loginAs, loginAsAdmin, logout, openLobbyWith } from './helpers';

test.describe('lobbies', () => {
  test('each participant sees only their own lobbies; the admin sees all', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    const rows = page.getByTestId('lobby-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.filter({ hasText: 'Alice vs Bruno' })).toHaveCount(1);
    await expect(page.getByTestId('lobbies-table')).not.toContainText('Chen');

    await logout(page);
    await loginAs(page, 'Chen');
    await expect(page.getByTestId('lobby-row')).toHaveCount(1);
    await expect(page.getByTestId('lobbies-table')).toContainText('Chen vs Dana');

    await logout(page);
    await loginAsAdmin(page);
    await page.goto('/lobbies');
    await expect(page.getByTestId('lobby-row')).toHaveCount(5);
  });

  test('a lobby you are not part of looks like it does not exist', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Chen');
    await openLobbyWith(page, 'Chen', 'Dana');
    const url = page.url();
    await logout(page);
    await loginAs(page, 'Alice');
    await page.goto(url);
    await expect(page.getByTestId('lobby-not-found')).toBeVisible();
    await page.goto('/lobbies/ZZZZ-ZZZZ-Z');
    await expect(page.getByTestId('lobby-not-found')).toBeVisible();
  });

  test('creates a lobby against another participant; the opponent sees it too', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await expect(page.getByTestId('lobby-id')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]$/);
    await expect(page.getByTestId('lobby-status')).toContainText('Waiting for programs');
    await expect(page.getByRole('button', { name: /^Start/ })).toBeDisabled();
    const id = (await page.getByTestId('lobby-id').textContent()) as string;

    await logout(page);
    await loginAs(page, 'Bruno');
    await expect(page.getByTestId('lobbies-table')).toContainText(id);
    await page.getByRole('link', { name: id }).click();
    await expect(page.getByTestId('seat-card-2')).toContainText('you');
  });

  test('uses the default ruleset, shows its rules, and rejects incomplete forms', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/lobbies/new');
    await expect(page.getByLabel('Ruleset')).toHaveValue('classic-10x10');
    await expect(page.getByTestId('ruleset-summary')).toContainText('A hit gives another turn');
    await page.getByLabel('Ruleset').selectOption('quick-8x8');
    await expect(page.getByTestId('ruleset-summary')).toContainText('8×8');
    await expect(page.getByTestId('ruleset-summary')).toContainText('Turns alternate after every shot');
    await expect(page.getByLabel('Ruleset').locator('option')).not.toContainText(['strict-10x10']);
    await page.getByRole('button', { name: 'Create lobby' }).click();
    await expect(page.getByText('Choose an opponent.')).toBeVisible();
  });

  test('the creator chooses god mode; it is locked on against yourself or a practice bot', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/lobbies/new');
    const god = page.getByLabel('Show both fleets live (god mode)');
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expect(god).toBeChecked(); // on to begin with
    await expect(god).toBeEnabled();
    await expect(page.getByTestId('view-note')).toContainText('Both players see both fleets during a game.');
    await god.uncheck();
    await expect(page.getByTestId('view-note')).toContainText('Each player only sees what their own program knows during a game.');
    await expect(page.getByTestId('view-note')).toContainText('Fixed once the lobby is created.');

    for (const value of ['participant:p_alice', 'bot:random']) {
      await page.getByLabel('Opponent').selectOption(value);
      await expect(god).toBeChecked();
      await expect(god).toBeDisabled();
      await expect(page.getByTestId('view-note')).toContainText('Always on against yourself or a practice bot.');
    }
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expect(god).not.toBeChecked(); // the earlier choice is still there
    await page.getByRole('button', { name: 'Create lobby' }).click();
    await expect(page.getByTestId('lobby-id')).toBeVisible();
    await expect(page.getByText('Restricted view')).toBeVisible();
    const id = (await page.getByTestId('lobby-id').textContent()) as string;

    // the opponent sees the creator's choice, in the list and in the lobby
    await logout(page);
    await loginAs(page, 'Bruno');
    await expect(page.getByTestId('lobby-row').filter({ hasText: id })).toContainText('Restricted view');
    await page.getByRole('link', { name: id }).click();
    await page.getByRole('tab', { name: 'Rules' }).click();
    await expect(page.getByTestId('lobby-visibility')).toContainText('Alice chose this when creating the lobby');
  });

  test('deletes a lobby from the lobby page (any participant may)', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    const id = (await page.getByTestId('lobby-id').textContent()) as string;
    await page.getByRole('button', { name: 'Delete lobby' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete lobby' }).click();
    await expect(page).toHaveURL(/\/lobbies$/);
    await expect(page.getByTestId('lobbies-table')).not.toContainText(id);
  });

  test('persists everything across a reload', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Dana');
    const id = (await page.getByTestId('lobby-id').textContent()) as string;
    await page.waitForTimeout(700); // the mock saves with a short debounce
    await page.reload();
    await expect(page.getByTestId('lobby-id')).toHaveText(id);
  });
});

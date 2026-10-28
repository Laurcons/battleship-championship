import { expect, test } from '@playwright/test';
import { createLobby, expectNoAxeViolations, freshApp, loginAs, loginAsAdmin, logout, shot } from './helpers';

const GOD = 'Show both fleets live (god mode)';

test.describe('god mode is chosen by the lobby creator', () => {
  test('the checkbox quietly remembers your last choice, per participant, and says nothing about it', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno', undefined, false); // Alice picks restricted

    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expect(page.getByLabel(GOD)).not.toBeChecked(); // starts where she left it
    await expect(page.locator('body')).not.toContainText(/preference|remember|default for/i);

    // a locked choice (a bot) does not overwrite what she picked
    await createLobby(page, 'Alice (yourself: two of your programs play each other)');
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expect(page.getByLabel(GOD)).not.toBeChecked();

    // she can change it, and that sticks too
    await page.getByLabel(GOD).check();
    await page.getByRole('button', { name: 'Create lobby' }).click();
    await expect(page.getByText('God mode', { exact: true })).toBeVisible();
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption({ label: 'Dana' });
    await expect(page.getByLabel(GOD)).toBeChecked();
    await page.getByLabel(GOD).uncheck();
    await page.getByRole('button', { name: 'Create lobby' }).click();
    await expect(page.getByText('Restricted view')).toBeVisible();
    await page.reload();

    // it survives a reload, and other participants are not affected
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expect(page.getByLabel(GOD)).not.toBeChecked();
    await logout(page);
    await loginAs(page, 'Bruno');
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption({ label: 'Alice' });
    await expect(page.getByLabel(GOD)).toBeChecked();
  });

  test('the account page only holds the token', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId('token-preview')).toBeVisible();
    await expect(page.getByText(/god mode/i)).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await page.goto('/token'); // the old address still works
    await expect(page).toHaveURL(/\/account$/);
  });

  test('when the admin turns god mode off, new lobbies are restricted and turning it on restores the choice', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/settings');
    await page.getByLabel('Allow participants to choose god mode').click();
    await expect(page.getByLabel('Allow participants to choose god mode')).not.toBeChecked();
    await logout(page);

    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno'); // the option is locked off, so this is a restricted lobby
    await expect(page.getByText('Restricted view')).toBeVisible();

    await logout(page);
    await loginAsAdmin(page);
    await page.goto('/admin/settings');
    await page.getByLabel('Allow participants to choose god mode').click();
    await expect(page.getByLabel('Allow participants to choose god mode')).toBeChecked();
    await logout(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Dana');
    await expect(page.getByText('God mode', { exact: true })).toBeVisible();
  });

  test('the new-lobby form is accessible with the option checked, unchecked and locked', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expectNoAxeViolations(page, 'new lobby: god mode checked');
    await page.getByLabel(GOD).uncheck();
    await expectNoAxeViolations(page, 'new lobby: god mode unchecked');
    await page.getByLabel('Opponent').selectOption('bot:random');
    await expectNoAxeViolations(page, 'new lobby: god mode locked');
    await shot(page, 'new-lobby-god-mode');
  });
});

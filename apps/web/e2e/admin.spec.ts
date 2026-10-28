import { expect, test } from '@playwright/test';
import { connectPrograms, createLobby, freshApp, loginAs, loginAsAdmin, logout, openLobbyWith, startBattery } from './helpers';

test.describe('admin', () => {
  test('manages participants, and new names show up in the login dropdown', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    await expect(page.getByTestId('participants-table').getByRole('row')).toHaveCount(5); // header + 4

    await page.getByLabel('Add a participant').fill('Eve');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('participants-table')).toContainText('Eve');

    await page.getByLabel('Add a participant').fill('eve');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('error-alert')).toContainText('already a participant');
    await page.getByLabel('Add a participant').fill('<script>');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('error-alert')).toContainText('letters, digits');

    await page.getByRole('button', { name: 'Rename Eve' }).click();
    await page.getByLabel('New name').fill('Evelyn');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('participants-table')).toContainText('Evelyn');

    await page.getByRole('button', { name: 'Delete Alice' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete participant' }).click();
    await expect(page.getByTestId('error-alert')).toContainText('part of 3 lobbies');
    await page.keyboard.press('Escape');

    await logout(page);
    await page.getByRole('link', { name: 'Participant login' }).click();
    await page.getByLabel('Shared password').fill('battleship');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Your name').locator('option')).toContainText(['Select your name…', 'Alice', 'Bruno', 'Chen', 'Dana', 'Evelyn']);
  });

  test('creates rulesets with validation; a new ruleset does not become the default', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/rulesets');
    await expect(page.getByTestId('ruleset-row')).toHaveCount(4);

    await page.getByRole('button', { name: 'New ruleset' }).click();
    await page.getByLabel('Id', { exact: true }).fill('classic-10x10');
    await page.getByRole('button', { name: 'Create ruleset' }).click();
    await expect(page.getByTestId('error-alert')).toContainText('already exists');
    await page.getByLabel('Id', { exact: true }).fill('tiny-6x6');
    await page.getByLabel('Width').fill('2');
    await page.getByRole('button', { name: 'Create ruleset' }).click();
    await expect(page.getByTestId('error-alert')).toContainText('width must be');
    await page.getByLabel('Width').fill('6');
    await page.getByLabel('Height').fill('6');
    await page.getByLabel('Fleet (ship lengths)').fill('three');
    await page.getByRole('button', { name: 'Create ruleset' }).click();
    await expect(page.getByText('Comma-separated ship lengths')).toBeVisible();
    await page.getByLabel('Fleet (ship lengths)').fill('3,2,2');
    await page.getByLabel('Description').fill('Tiny test board');
    await page.getByRole('button', { name: 'Create ruleset' }).click();
    await expect(page.getByTestId('ruleset-row')).toHaveCount(5);
    // classic-10x10 stays the default and is listed first; the new one is just another enabled ruleset
    await expect(page.getByTestId('ruleset-row').first()).toContainText('classic-10x10');
    await expect(page.getByTestId('ruleset-row').first()).toContainText('default for new lobbies');
    await expect(page.getByTestId('ruleset-row').filter({ hasText: 'tiny-6x6' })).not.toContainText('default for new lobbies');

    // cloning pre-fills the form
    await page.getByRole('button', { name: 'Clone quick-8x8' }).click();
    await expect(page.getByLabel('Id', { exact: true })).toHaveValue('quick-8x8-2');
    await expect(page.getByLabel('Width')).toHaveValue('8');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('the admin chooses the default ruleset; it is preselected, listed first, and cannot be disabled', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/rulesets');
    const rows = page.getByTestId('ruleset-row');
    await expect(rows.first()).toContainText('classic-10x10');
    // the default row offers no "Make default" and its switch is locked
    await expect(page.getByRole('button', { name: 'Make classic-10x10 the default' })).toHaveCount(0);
    await expect(page.getByLabel('classic-10x10 enabled')).toBeDisabled();
    // a disabled ruleset cannot be made the default
    await expect(page.getByRole('button', { name: 'Make strict-10x10 the default' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Make quick-8x8 the default' }).click();
    await expect(rows.first()).toContainText('quick-8x8');
    await expect(rows.first()).toContainText('default for new lobbies');
    await expect(page.getByLabel('quick-8x8 enabled')).toBeDisabled();
    await expect(page.getByLabel('classic-10x10 enabled')).toBeEnabled();
    await expect(rows.last()).toContainText('strict-10x10'); // disabled ones at the end

    // disabling the old default is now allowed; the default stays where it is
    await page.getByLabel('classic-10x10 enabled').click();
    await expect(page.getByLabel('classic-10x10 enabled')).not.toBeChecked();
    await expect(rows.first()).toContainText('quick-8x8');

    await logout(page);
    await loginAs(page, 'Alice');
    await page.goto('/lobbies/new');
    await expect(page.getByLabel('Ruleset')).toHaveValue('quick-8x8');
    await expect(page.getByLabel('Ruleset').locator('option')).toHaveText(['quick-8x8 (default)', 'classic-10x10-touching']);
    await logout(page);

    await loginAsAdmin(page);
    await page.goto('/admin/audit');
    await expect(page.getByTestId('audit-table')).toContainText('default_ruleset_changed');
  });

  test('disabling a ruleset only affects new lobbies', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/rulesets');
    await page.getByLabel('quick-8x8 enabled').click();
    await expect(page.getByLabel('quick-8x8 enabled')).not.toBeChecked();
    await logout(page);
    await loginAs(page, 'Alice');
    await page.goto('/lobbies/new');
    await expect(page.getByLabel('Ruleset').locator('option')).toHaveText(['classic-10x10 (default)', 'classic-10x10-touching']);
    await logout(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana'); // this lobby uses quick-8x8
    await expect(page.getByTestId('lobby-ruleset')).toHaveText('quick-8x8');
  });

  test('a new ruleset is playable', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/rulesets');
    await page.getByRole('button', { name: 'New ruleset' }).click();
    await page.getByLabel('Id', { exact: true }).fill('tiny-6x6');
    await page.getByLabel('Width').fill('6');
    await page.getByLabel('Height').fill('6');
    await page.getByLabel('Fleet (ship lengths)').fill('3,2,2');
    await page.getByRole('button', { name: 'Create ruleset' }).click();
    await expect(page.getByTestId('ruleset-row').filter({ hasText: 'tiny-6x6' })).toBeVisible();
    await logout(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno', 'tiny-6x6');
    await connectPrograms(page);
    await startBattery(page, 3);
    await expect(page.getByTestId('series-progress')).toContainText('3 of 3 games', { timeout: 30_000 });
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByTestId('game-row').first().click();
    await expect(page.locator('[data-testid=board-seat-1] [data-cell]')).toHaveCount(36);
  });

  test('the god-mode policy only applies to lobbies created afterwards; the battery limit is enforced', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    const before = (await page.getByTestId('lobby-id').textContent()) as string;
    await expect(page.getByText('God mode', { exact: true })).toBeVisible();
    await logout(page);

    await loginAsAdmin(page);
    await page.goto('/admin/settings');
    await expect(page.getByLabel('Allow participants to choose god mode')).toBeChecked();
    await page.getByLabel('Allow participants to choose god mode').click();
    await expect(page.getByLabel('Allow participants to choose god mode')).not.toBeChecked();
    await page.getByLabel('Maximum battery size (games)').fill('5');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await expect(page.getByTestId('constants-table')).toContainText('Move timeout');
    await expect(page.getByTestId('constants-table')).toContainText('10 s');
    await page.getByLabel('Maximum battery size (games)').fill('0');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('At least 1.')).toBeVisible();
    await logout(page);

    await loginAs(page, 'Alice');
    await page.getByRole('link', { name: before }).click();
    await expect(page.getByTestId('lobby-id')).toHaveText(before);
    await expect(page.getByText('God mode', { exact: true })).toBeVisible(); // unchanged

    // with the policy off the option is locked off between participants, but still on against a bot
    await page.goto('/lobbies/new');
    const god = page.getByLabel('Show both fleets live (god mode)');
    await page.getByLabel('Opponent').selectOption({ label: 'Bruno' });
    await expect(god).not.toBeChecked();
    await expect(god).toBeDisabled();
    await expect(page.getByTestId('view-note')).toContainText('admin has turned god mode off');
    await page.getByLabel('Opponent').selectOption('bot:random');
    await expect(god).toBeChecked();
    await expect(god).toBeDisabled();

    await createLobby(page, 'Bruno');
    await expect(page.getByText('Restricted view')).toBeVisible();
    await connectPrograms(page);
    await page.getByRole('button', { name: /^Start/ }).click();
    await page.getByLabel('Number of games').fill('6');
    await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('At most 5 games.')).toBeVisible();
  });

  test('the audit log records sensitive actions and links to lobbies', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    const id = (await page.getByTestId('lobby-id').textContent()) as string;
    await connectPrograms(page);
    await startBattery(page, 2);
    await expect(page.getByTestId('series-progress')).toContainText('2 of 2 games', { timeout: 30_000 });
    await page.goto('/token');
    await page.getByRole('button', { name: 'Replace token…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace token' }).click();
    await expect(page.getByTestId('new-token')).toBeVisible();
    await logout(page);

    await loginAsAdmin(page);
    await page.goto('/admin/audit');
    const table = page.getByTestId('audit-table');
    await expect(table).toContainText('token_replaced');
    await expect(table).toContainText('token_created');
    await expect(table).toContainText('series_started');
    await expect(table).toContainText('lobby_created');
    await page.getByLabel('Filter audit log').fill('token_replaced');
    await expect(table.getByRole('row')).toHaveCount(3); // header + Bruno's (seeded) + Alice's
    await page.getByLabel('Filter audit log').fill(id);
    await expect(table.getByRole('link', { name: id }).first()).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { connectPrograms, createLobby, expectNoAxeViolations, freshApp, loginAs, loginAsAdmin, logout, openLobbyWith, rowAction, rowActionEnabled, startBattery } from './helpers';

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

    await rowAction(page, 'Eve', 'Rename…');
    await page.getByLabel('New name').fill('Evelyn');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('participants-table')).toContainText('Evelyn');

    // Deleting a participant also deletes every lobby they sit in, and the dialog says which.
    await rowAction(page, 'Alice', 'Delete…');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('This also deletes');
    await expect(dialog.getByTestId('doomed-count')).toHaveText('3');
    await expect(dialog.getByTestId('doomed-lobbies').getByRole('listitem')).toHaveCount(3);
    await expect(dialog.getByTestId('doomed-lobbies')).toContainText('Alice vs');
    await dialog.getByRole('button', { name: 'Delete participant' }).click();
    await expect(page.getByTestId('participants-table')).not.toContainText('Alice');
    await expect(page.getByTestId('error-alert')).toHaveCount(0);

    await logout(page);
    await page.getByRole('link', { name: 'Participant login' }).click();
    await page.getByLabel('Shared password').fill('battleship');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Your name').locator('option')).toContainText(['Select your name…', 'Bruno', 'Chen', 'Dana', 'Evelyn']);
    await expect(page.getByLabel('Your name').locator('option', { hasText: 'Alice' })).toHaveCount(0);
  });

  test('deleting a participant removes the lobbies of others that include them, and says so up front', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/lobbies');
    await expect(page.getByTestId('lobby-row').first()).toBeVisible();
    const before = await page.getByTestId('lobby-row').count();
    await page.goto('/admin/participants');
    const row = page.getByTestId('participants-table').getByRole('row').filter({ hasText: 'Dana' });
    const count = Number(await row.getByRole('cell').nth(1).textContent());
    expect(count).toBeGreaterThan(0);
    await rowAction(page, 'Dana', 'Delete…');
    await expect(page.getByRole('dialog').getByTestId('doomed-count')).toHaveText(String(count));
    await page.getByRole('dialog').getByRole('button', { name: 'Delete participant' }).click();
    await expect(page.getByTestId('participants-table')).not.toContainText('Dana');
    await page.goto('/lobbies');
    await expect(page.getByTestId('lobby-row')).toHaveCount(before - count);
    await expect(page.getByTestId('lobby-row').filter({ hasText: 'Dana' })).toHaveCount(0);
    await page.goto('/admin/audit');
    await expect(page.getByText('participant_deleted')).toBeVisible();
    await expect(page.getByText('lobby_deleted').first()).toBeVisible();
  });

  test('a participant without lobbies is deleted with a plain confirmation', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    await page.getByLabel('Add a participant').fill('Eve');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await rowAction(page, 'Eve', 'Delete…');
    await expect(page.getByRole('dialog')).toContainText('Eve is not part of any lobby.');
    await expect(page.getByRole('dialog').getByTestId('doomed-lobbies')).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete participant' }).click();
    await expect(page.getByTestId('participants-table')).not.toContainText('Eve');
  });

  test('resets a participant token: they are told, and create a new one', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    const row = page.getByTestId('participants-table').getByRole('row').filter({ hasText: 'Chen' });
    await expect(row).toContainText('Created');
    await rowAction(page, 'Chen', 'Reset token…');
    await expect(page.getByRole('dialog')).toContainText('you never see it');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toContainText('Created'); // cancelling changes nothing

    await rowAction(page, 'Chen', 'Reset token…');
    await page.getByRole('dialog').getByRole('button', { name: 'Reset token' }).click();
    await expect(row).toContainText('Not created yet');
    expect(await rowActionEnabled(page, 'Chen', 'Reset token…')).toBe(false); // nothing left to reset
    expect(await rowActionEnabled(page, 'Dana', 'Reset token…')).toBe(true);
    await page.goto('/admin/audit');
    await expect(page.getByText('token_reset')).toBeVisible();

    await logout(page);
    await loginAs(page, 'Chen');
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByTestId('token-notice')).toContainText('An admin reset your token');
    await expect(page.getByTestId('no-token')).toContainText("You don't have a token yet");
    await expectNoAxeViolations(page, 'account page after an admin reset the token');
    await page.getByRole('button', { name: 'Create my token' }).click();
    await expect(page.getByTestId('new-token')).toBeVisible();
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await page.reload();
    await expect(page.getByTestId('token-notice')).toHaveCount(0);
    await expect(page.getByTestId('token-preview')).toBeVisible();
  });

  test('allows plain ws:// per participant, off by default, and records it', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    const alice = page.getByLabel('Allow ws:// for Alice');
    await expect(alice).not.toBeChecked();
    await alice.click();
    await expect(alice).toBeChecked();
    await expect(page.getByLabel('Allow ws:// for Bruno')).not.toBeChecked();
    await page.reload();
    await expect(page.getByLabel('Allow ws:// for Alice')).toBeChecked();
    await page.getByLabel('Allow ws:// for Alice').click();
    await expect(page.getByLabel('Allow ws:// for Alice')).not.toBeChecked();
    await page.goto('/admin/audit');
    await expect(page.getByText('insecure_allowed')).toBeVisible();
    await expect(page.getByText('insecure_forbidden')).toBeVisible();
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

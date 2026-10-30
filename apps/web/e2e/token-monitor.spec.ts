import { expect, test } from '@playwright/test';
import { closeMockPanel, connectPrograms, createLobby, expectNoAxeViolations, freshApp, loginAs, loginAsAdmin, logout, openMockPanel, rowAction, shot } from './helpers';

test.describe('token activity', () => {
  test('the participants list shows the last connection and flags what is unreviewed', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    const table = page.getByTestId('participants-table');
    const bruno = table.getByRole('row').filter({ hasText: 'Bruno' });
    await expect(bruno.getByTestId('last-connection')).toContainText('5.6.7.8'); // the address that took over
    await expect(page.getByTestId('signal-badge-Bruno')).toHaveAccessibleName(/Open activity of Bruno: 1 high, 1 notice/);
    await expect(page.getByTestId('signal-badge-Alice')).toHaveAccessibleName(/1 notice/);
    await expect(bruno.getByTestId('signal-dot')).toBeAttached();
    await shot(page, 'participants-activity');
    await expectNoAxeViolations(page, 'participants list with activity');

    // Every action lives in the "⋯" menu, in a fixed order, and works from the keyboard.
    await page.getByRole('button', { name: 'Actions for Bruno' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem')).toHaveText(['Activity…', 'Rename…', 'Reset token…', 'Delete…']);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
  });

  test('the activity modal lists the signals with their evidence, and reviewing clears the badge', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    await rowAction(page, 'Bruno', 'Activity…');
    const modal = page.getByTestId('activity-modal');
    await expect(modal).toContainText('Token activity: Bruno');
    await expect(modal.getByTestId('activity-summary')).toContainText('last used');
    await expect(modal.getByTestId('unreviewed-count')).toHaveText('2 unreviewed');
    const taken = modal.getByTestId('signal-item').filter({ hasText: 'taken over' });
    await expect(taken).toContainText('High');
    await expect(taken).toContainText('5.6.7.8');
    await expect(modal.getByTestId('signal-item').filter({ hasText: 'New address' })).toContainText('Notice');
    await expect(modal.getByTestId('address-table')).toContainText('91.77.3.9');
    await expect(modal.getByTestId('address-table')).toContainText('5.6.7.8');
    await expectNoAxeViolations(page, 'activity modal');
    await shot(page, 'activity-modal');

    // "Show connections" narrows the history to the evidence for one signal.
    const all = await modal.getByTestId('connection-row').count();
    await taken.getByRole('button', { name: 'Show connections' }).click();
    await expect(modal.getByTestId('evidence-chip')).toContainText('taken over');
    const evidence = modal.getByTestId('connection-row');
    expect(await evidence.count()).toBeLessThan(all);
    await expect(evidence.first()).toHaveAttribute('data-flagged', 'true');
    await modal.getByRole('button', { name: 'Show all connections' }).click();
    await expect(modal.getByTestId('connection-row')).toHaveCount(all);
    await modal.getByRole('group', { name: 'Filter connections' }).getByRole('button', { name: 'Flagged' }).click();
    for (const row of await modal.getByTestId('connection-row').all()) await expect(row).toHaveAttribute('data-flagged', 'true');

    await modal.getByRole('button', { name: 'Mark all reviewed' }).click();
    await expect(modal.getByTestId('unreviewed-count')).toHaveText('0 unreviewed');
    await expect(modal.getByTestId('no-signals')).toBeVisible();
    await expect(modal.getByTestId('reviewed-signals')).toContainText('2 reviewed');
    await expect(modal.getByRole('button', { name: 'Mark all reviewed' })).toBeDisabled();
    await modal.locator('.modal-footer').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('signal-badge-Bruno')).toHaveCount(0);
    await expect(page.getByTestId('signal-badge-Alice')).toBeVisible(); // only Bruno was reviewed
  });

  test('resetting a token from the activity modal reviews it too', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/participants');
    await rowAction(page, 'Dana', 'Activity…');
    await page.getByTestId('activity-modal').getByRole('button', { name: 'Reset token…' }).click();
    await page.getByRole('dialog').filter({ hasText: 'Reset the token of Dana' }).getByRole('button', { name: 'Reset token' }).click();
    await expect(page.getByTestId('activity-modal').getByTestId('unreviewed-count')).toHaveText('0 unreviewed');
    await expect(page.getByTestId('activity-modal').getByRole('button', { name: 'Reset token…' })).toBeDisabled();
  });

  test('the token monitor shows everything at a glance, filters it, and clears what has been reviewed', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    // The navigation tells the admin that something needs attention.
    await expect(page.getByTestId('admin-attention')).toHaveText(/2/);
    await page.locator('#admin-menu').click();
    await page.getByRole('link', { name: /Token monitor/ }).click();
    await expect(page).toHaveURL(/\/admin\/tokens$/);
    await expect(page.getByTestId('stat-attention')).toContainText('2');
    await expect(page.getByTestId('stat-notices')).toContainText('3');
    await expect(page.getByTestId('stat-infos')).toContainText('3');
    await expect(page.getByTestId('stat-active')).toContainText('2 of 4');
    await expect(page.getByTestId('proxy-warning')).toHaveCount(0);
    const rows = page.getByTestId('signal-row');
    await expect(rows).toHaveCount(8);
    await expectNoAxeViolations(page, 'token monitor');
    await shot(page, 'token-monitor');

    // Filters.
    await page.getByLabel('Filter by severity').selectOption('high');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'taken over' })).toContainText('Bruno');
    await expect(rows.filter({ hasText: 'not theirs' })).toContainText('Dana');
    await page.getByLabel('Filter by participant').selectOption({ label: 'Dana' });
    await expect(rows).toHaveCount(1);
    await page.getByLabel('Filter by severity').selectOption('all');
    await expect(rows).toHaveCount(3); // all of Dana's
    await page.getByLabel('Filter by participant').selectOption('all');

    // Investigate opens the same modal as the participants page.
    await rows.filter({ hasText: 'taken over' }).getByRole('button', { name: 'Investigate Bruno' }).click();
    await expect(page.getByTestId('activity-modal')).toContainText('Token activity: Bruno');
    await page.getByTestId('activity-modal').locator('.modal-footer').getByRole('button', { name: 'Close' }).click();

    // Reviewing one participant clears their rows (and the navigation count), not anyone else's.
    await rows.filter({ hasText: 'taken over' }).getByRole('button', { name: 'Mark Bruno reviewed' }).click();
    await expect(page.getByTestId('stat-attention')).toContainText('1');
    await expect(page.getByTestId('admin-attention')).toHaveText(/1/);
    await expect(rows.filter({ hasText: 'Bruno' })).toHaveCount(0);
    await page.getByLabel('Show reviewed').check();
    await expect(rows.filter({ hasText: 'Bruno' })).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Bruno' }).first()).toContainText('reviewed');
    await page.getByLabel('Show reviewed').uncheck();

    await page.getByRole('button', { name: 'Mark Dana reviewed' }).first().click();
    await page.getByRole('button', { name: 'Mark Alice reviewed' }).first().click();
    await page.getByRole('button', { name: 'Mark Chen reviewed' }).first().click();
    await expect(page.getByTestId('no-signals')).toContainText('No unreviewed signals');
    await expect(page.getByTestId('admin-attention')).toHaveCount(0);
  });

  test('lists every connection live in the second tab', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/tokens');
    await page.getByRole('tab', { name: 'All connections' }).click();
    const table = page.getByTestId('all-connections');
    await expect(table.getByRole('row')).not.toHaveCount(1);
    await expect(table).toContainText('5.6.7.8');
    await expect(table).toContainText('Bruno');
    await table.getByRole('button', { name: 'Bruno' }).first().click();
    await expect(page.getByTestId('activity-modal')).toContainText('Token activity: Bruno');
  });

  test('a token used from a second address while a program is connected shows up for the admin', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Chen');
    await connectPrograms(page);
    await openMockPanel(page);
    await page.getByTestId('mock-seat-1').getByRole('button', { name: 'From another address' }).click();
    await page.getByRole('button', { name: "Someone else's token tries this lobby" }).click();
    await closeMockPanel(page);
    await logout(page);
    await page.getByRole('link', { name: 'Admin login' }).click();
    await loginAsAdmin(page);
    await page.goto('/admin/tokens');
    const rows = page.getByTestId('signal-row');
    await expect(rows.filter({ hasText: 'Alice' }).filter({ hasText: 'taken over' })).toBeVisible();
    await expect(rows.filter({ hasText: 'not theirs' }).filter({ hasText: 'Bruno' })).toBeVisible(); // Bruno is the first outsider
  });

  test('is for the admin only', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/admin/tokens');
    await expect(page.getByTestId('admin-only')).toBeVisible();
    await expect(page.getByTestId('signal-table')).toHaveCount(0);
    await expect(page.getByTestId('admin-attention')).toHaveCount(0);
  });
});

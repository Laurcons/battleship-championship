import { expect, test } from '@playwright/test';
import { closeMockPanel, connectPrograms, createLobby, expectNoAxeViolations, freshApp, loginAs, loginAsAdmin, openLobbyWith, openMockPanel, startBattery } from './helpers';

test.describe('accessibility (axe, WCAG 2 A/AA)', () => {
  test('login pages', async ({ page }) => {
    await freshApp(page);
    await page.goto('/login');
    await expect(page.getByLabel('Shared password')).toBeVisible();
    await expectNoAxeViolations(page, 'login');
    await page.getByLabel('Shared password').fill('battleship');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expectNoAxeViolations(page, 'login: pick a name');
    await page.goto('/admin/login');
    await expectNoAxeViolations(page, 'admin login');
  });

  test('participant pages', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await expect(page.getByTestId('lobbies-table')).toBeVisible();
    await expectNoAxeViolations(page, 'lobbies');
    await page.getByRole('link', { name: 'New lobby' }).click();
    await expect(page.getByLabel('Opponent')).toBeVisible();
    await expectNoAxeViolations(page, 'new lobby');
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByTestId('token-preview')).toBeVisible();
    await expectNoAxeViolations(page, 'token');
  });

  test('lobby page and its tabs', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana');
    await expect(page.getByTestId('board-seat-1')).toBeVisible();
    await expectNoAxeViolations(page, 'lobby: live');
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByTestId('game-row').first().click();
    await expect(page.getByTestId('move-item').first()).toBeVisible();
    await expectNoAxeViolations(page, 'lobby: history');
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByTestId('stats-table')).toBeVisible();
    await expectNoAxeViolations(page, 'lobby: results');
    await page.getByRole('tab', { name: 'Connection' }).click();
    await expect(page.getByTestId('frame-log')).toBeVisible();
    await expectNoAxeViolations(page, 'lobby: connection');
  });

  test('colored states: errors, success, warnings, ready and aborted lobbies', async ({ page }) => {
    await freshApp(page);
    await page.goto('/login');
    await page.getByLabel('Shared password').fill('wrong');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('error-alert')).toBeVisible();
    await expectNoAxeViolations(page, 'login with an error (danger alert)');

    await loginAs(page, 'Chen');
    await openLobbyWith(page, 'Chen', 'Dana');
    await expect(page.getByTestId('series-aborted')).toBeVisible();
    await expectNoAxeViolations(page, 'aborted battery (warning alert and progress bar)');
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expectNoAxeViolations(page, 'results of an aborted battery');

    await page.goto('/lobbies/new');
    await createLobby(page, 'Dana');
    await connectPrograms(page);
    await expect(page.getByRole('button', { name: /^Start/ })).toBeEnabled();
    await expectNoAxeViolations(page, 'ready lobby (success badge and Start button)');
    await startBattery(page, 12);
    await expect(page.getByTestId('series-progress')).toContainText('12 of 12 games', { timeout: 30_000 });
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByTestId('verdict')).toBeVisible();
    await expectNoAxeViolations(page, 'results of a finished battery');

    await page.goto('/token');
    await page.getByRole('button', { name: 'Replace token…' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Replace token' }).click();
    await expect(page.getByTestId('new-token')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0); // let the dialog finish fading out before measuring colors
    await expectNoAxeViolations(page, 'token page with a new token (success alert)');
    await openMockPanel(page);
    await page.getByRole('button', { name: 'Someone replaces my token elsewhere' }).click();
    await closeMockPanel(page);
    await page.getByRole('link', { name: 'Lobbies' }).click();
    await page.getByRole('link', { name: 'Account' }).click();
    await expect(page.getByTestId('token-notice')).toBeVisible();
    await expectNoAxeViolations(page, 'token page with a notice (warning alert)');
  });

  test('documentation', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    for (const slug of ['getting-started', 'rules', 'protocol', 'examples']) {
      await page.goto(`/docs/${slug}`);
      await expect(page.locator('.docs-content, [data-testid^=example-]').first()).toBeVisible();
      await expectNoAxeViolations(page, `docs/${slug}`);
    }
  });

  test('admin pages', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    for (const path of ['participants', 'rulesets', 'settings', 'audit']) {
      await page.goto(`/admin/${path}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoAxeViolations(page, `admin/${path}`);
    }
    await page.goto('/admin/rulesets');
    await page.getByRole('button', { name: 'New ruleset' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expectNoAxeViolations(page, 'admin/rulesets: new ruleset dialog');
  });

  test('mock panel', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await openMockPanel(page);
    await expectNoAxeViolations(page, 'mock panel');
  });
});

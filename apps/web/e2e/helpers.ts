import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import path from 'node:path';

export const SHARED_PASSWORD = 'battleship';

/** Starts every test from a clean, freshly seeded mock backend (it lives in the browser's storage). */
export async function freshApp(page: Page, speed: 'instant' | 'fast' | 'watch' = 'instant') {
  await page.addInitScript((s) => {
    try {
      if (!sessionStorage.getItem('bsc-e2e-initialised')) {
        localStorage.clear();
        localStorage.setItem('bsc-mock-speed', s);
        sessionStorage.setItem('bsc-e2e-initialised', '1');
      }
    } catch {
      /* ignore */
    }
  }, speed);
  await page.goto('/');
}

export async function loginAs(page: Page, name: string) {
  await page.goto('/login');
  await page.getByLabel('Shared password').fill(SHARED_PASSWORD);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Your name').selectOption({ label: name });
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page.getByTestId('current-user')).toContainText(name);
}

export async function loginAsAdmin(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill('admin');
  await page.getByLabel('Password').fill('admin');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByTestId('current-user')).toContainText('Admin');
}

export async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join('screenshots', `${name}.png`), fullPage: true });
}

export async function expectNoAxeViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map((v) => {
    const nodes = v.nodes.slice(0, 6).map((n) => {
      const detail = n.any.find((c) => c.id === 'color-contrast')?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number } | undefined;
      const colors = detail ? ` [${detail.fgColor} on ${detail.bgColor}, ${detail.contrastRatio}]` : '';
      return `${n.target.join(' ')}${colors}`;
    });
    return `${v.id} (${v.impact}): ${v.nodes.length} node(s): ${nodes.join(' | ')}`;
  });
  expect(summary, `accessibility violations on ${label}`).toEqual([]);
}

export async function openMockPanel(page: Page) {
  await page.getByTestId('mock-fab').click();
  await expect(page.getByTestId('mock-panel')).toBeVisible();
}

export async function closeMockPanel(page: Page) {
  await page.getByTestId('mock-panel').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('mock-panel')).toBeHidden();
}

/** Connects simulated programs for every participant seat of the open lobby. */
export async function connectPrograms(page: Page) {
  await openMockPanel(page);
  await page.getByRole('button', { name: 'Connect all programs' }).click();
  await closeMockPanel(page);
  await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
}

/** Presses Start in the open lobby and picks the number of games. */
export async function startBattery(page: Page, games: number) {
  await page.getByRole('button', { name: /^Start/ }).click();
  await page.getByLabel('Number of games').fill(String(games));
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
}

export async function openLobbyWith(page: Page, a: string, b: string) {
  await page.goto('/lobbies');
  const row = page.getByTestId('lobby-row').filter({ hasText: `${a} vs ${b}` }).first();
  await row.getByRole('link').click();
  await expect(page.getByTestId('lobby-id')).toBeVisible();
}

/** `godMode: false` unchecks the creator's god-mode option (restricted lobby). */
export async function createLobby(page: Page, opponent: string, ruleset?: string, godMode?: boolean) {
  await page.goto('/lobbies/new');
  await page.getByLabel('Opponent').selectOption({ label: opponent });
  if (ruleset) await page.getByLabel('Ruleset').selectOption(ruleset);
  if (godMode === false) await page.getByLabel('Show both fleets live (god mode)').uncheck();
  await page.getByRole('button', { name: 'Create lobby' }).click();
  await expect(page.getByTestId('lobby-id')).toBeVisible();
}

export async function logout(page: Page) {
  await page.getByTestId('current-user').click();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/(admin\/)?login$/);
}

/** Opens the "⋯" menu of a participant's row and picks an item. */
export async function rowAction(page: Page, name: string, item: 'Activity…' | 'Rename…' | 'Reset token…' | 'Delete…') {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Whether an item of a participant's "⋯" menu is available. Leaves the menu closed. */
export async function rowActionEnabled(page: Page, name: string, item: 'Activity…' | 'Rename…' | 'Reset token…' | 'Delete…'): Promise<boolean> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  const disabled = await page.getByRole('menuitem', { name: item }).isDisabled();
  await page.keyboard.press('Escape');
  return !disabled;
}

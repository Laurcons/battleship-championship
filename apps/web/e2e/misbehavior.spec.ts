import { expect, test } from '@playwright/test';
import { closeMockPanel, connectPrograms, createLobby, freshApp, loginAs, openLobbyWith, openMockPanel, shot, startBattery } from './helpers';

test.describe('programs that misbehave', () => {
  test('invalid moves and forfeits are highlighted in the history (seeded lobby)', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana');
    await page.getByRole('tab', { name: 'History' }).click();
    const games = page.getByTestId('game-row');
    await expect(games).toHaveCount(20);
    const total = 20;

    await page.getByLabel('Only games with problems').check();
    const problematic = await games.count();
    expect(problematic).toBeGreaterThan(0);
    expect(problematic).toBeLessThanOrEqual(total);

    await games.first().click();
    const problems = page.locator('[data-testid=move-item][data-problem=true]');
    await expect(problems.first()).toBeVisible();
    await expect(problems.first()).toContainText(/forfeited|out_of_bounds|already_fired|strike/); // newest first
    const infraction = problems.filter({ hasText: 'Received:' }).first();
    await expect(infraction).toContainText(/out_of_bounds|already_fired/);
    await shot(page, 'misbehavior-history');

    await page.getByLabel('Only problems', { exact: false }).check();
    const shown = await page.getByTestId('move-item').count();
    expect(shown).toBeGreaterThan(0);
    expect(await page.locator('[data-testid=move-item][data-problem=false]').count()).toBe(0);
  });

  test('a program that keeps sending invalid moves forfeits and the results count infractions', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await openMockPanel(page);
    await page.getByLabel('Behavior of seat 2').selectOption('invalid_moves');
    await closeMockPanel(page);
    await connectPrograms(page);
    await startBattery(page, 6);
    await expect(page.getByTestId('series-progress')).toContainText('6 of 6 games', { timeout: 30_000 });
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('game-row').filter({ hasText: 'strikes' }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Results' }).click();
    const infractions = page.getByTestId('stats-table').getByRole('row', { name: /Infractions/ });
    await expect(infractions).toContainText(/0\s*[1-9]\d*|[1-9]\d*\s*[1-9]\d*/);
    await expect(page.getByTestId('stats-table')).toContainText('Games lost by opponent forfeit');
  });

  test('repeated shots are highlighted as problems in the history', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await openMockPanel(page);
    await page.getByLabel('Behavior of seat 1').selectOption('repeat_shots');
    await closeMockPanel(page);
    await connectPrograms(page);
    // the simulated program repeats a shot with 6% chance per move: six games make "never" vanishingly unlikely
    await startBattery(page, 6);
    await expect(page.getByTestId('series-progress')).toContainText('6 of 6 games', { timeout: 30_000 });
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByLabel('Only games with problems').check();
    await page.getByTestId('game-row').first().click();
    await expect(page.locator('[data-testid=move-item][data-problem=true]').filter({ hasText: /already_fired/ }).first()).toBeVisible();
  });

  test('the Connection tab logs what the program sent, including the broken frame', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await openMockPanel(page);
    await page.getByLabel('Behavior of seat 1').selectOption('bad_shape');
    await closeMockPanel(page);
    await connectPrograms(page);
    await startBattery(page, 6); // the malformed reply happens with 6% chance per move
    await expect(page.getByTestId('series-progress')).toContainText('6 of 6 games', { timeout: 30_000 });
    await page.getByRole('tab', { name: 'Connection' }).click();
    const log = page.getByTestId('frame-log');
    await expect(log).toContainText('"type":"hello"');
    await expect(log).toContainText('"type":"welcome"');
    await expect(log).toContainText('"type":"place"');
    await expect(log).toContainText('"type":"fire"');
    await expect(log).toContainText('"x":"'); // the malformed fire frame, as received
    await page.getByLabel('Filter frames').fill('bad_shape');
    await expect(log).toContainText('Infraction "bad_shape"');
    await expect(log).not.toContainText('"type":"hello"');
    // the token is never shown in logs
    await page.getByLabel('Filter frames').fill('');
    await expect(log).not.toContainText(/bsc_[A-Za-z0-9]{8}/);
  });
});

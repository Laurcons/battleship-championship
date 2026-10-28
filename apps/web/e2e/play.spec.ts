import { expect, test } from '@playwright/test';
import { closeMockPanel, connectPrograms, createLobby, freshApp, loginAs, openLobbyWith, openMockPanel, shot, startBattery } from './helpers';

test.describe('playing', () => {
  test('connects programs, plays a battery to the end and shows the results', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await expect(page.getByRole('button', { name: /^Start/ })).toBeEnabled();

    await startBattery(page, 10);
    await expect(page.getByTestId('series-progress')).toContainText('10 of 10 games', { timeout: 30_000 });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await expect(page.getByRole('button', { name: 'Start again' })).toBeEnabled();

    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByTestId('verdict')).toContainText('10 decided games');
    await expect(page.getByTestId('stats-table')).toContainText('Wins');
    await expect(page.getByTestId('heatmap')).toHaveCount(2);
    await shot(page, 'results');

    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('game-row')).toHaveCount(10);
  });

  test('the starting player alternates and the start dialog validates the battery size', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await page.getByRole('button', { name: /^Start/ }).click();
    await page.getByLabel('Number of games').fill('0');
    await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('At least 1 game.')).toBeVisible();
    await page.getByLabel('Number of games').fill('5000');
    await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('At most 1000 games.')).toBeVisible();
    await page.getByLabel('Number of games').fill('4');
    await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
    await expect(page.getByTestId('series-progress')).toContainText('4 of 4 games', { timeout: 30_000 });

    await page.getByRole('tab', { name: 'History' }).click();
    const firsts: string[] = [];
    for (let i = 1; i <= 4; i++) {
      await page.getByTestId('game-row').nth(i - 1).click();
      await expect(page.getByRole('heading', { name: `Game ${i}` })).toBeVisible();
      firsts.push((await page.locator('.game-viewer').first().textContent())?.match(/(Alice|Bruno) moved first/)?.[1] ?? '?');
    }
    expect(firsts).toEqual(['Alice', 'Bruno', 'Alice', 'Bruno']);
  });

  test('the history scrubber shows the board before and after any move', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await openLobbyWith(page, 'Alice', 'Bruno');
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByTestId('game-row').first().click();
    const item = (index: number) => page.locator(`[data-testid=move-item][data-index="${index}"]`);
    await expect(page.getByTestId('move-item').first()).toBeVisible();
    await expect(page.getByTestId('move-item').first()).toHaveAttribute('data-index', /^\d+$/);

    // events 0 and 1 are the two placements, then shots start; pick the first shot
    await item(2).click();
    const hitsAfter = await page.locator('[data-state="hit"], [data-state="miss"], [data-state="sunk ship"]').count();
    await page.getByRole('button', { name: 'Before move' }).click();
    const hitsBefore = await page.locator('[data-state="hit"], [data-state="miss"], [data-state="sunk ship"]').count();
    expect(hitsAfter).toBe(hitsBefore + 1);
    await expect(page.locator('.cell-focus')).toHaveCount(1);

    // stepping with the keyboard moves the selection
    await page.getByRole('button', { name: 'After move' }).click();
    await page.getByLabel('Game viewer').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('scrub-position')).toContainText('Move 4 of');
    await page.keyboard.press('End');
    await expect(page.getByTestId('scrub-position')).toContainText(/Move (\d+) of \1/);
    await page.keyboard.press('Home');
    await expect(page.getByTestId('scrub-position')).toContainText('Move 1 of');
    await shot(page, 'history');
  });

  test('watches a game live, following the latest move', async ({ page }) => {
    await freshApp(page, 'watch');
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await startBattery(page, 1);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Running/);
    const position = page.getByTestId('scrub-position');
    await expect(position).toContainText(/Move \d+ of \d+/, { timeout: 15_000 });
    const first = Number((await position.textContent())?.match(/of (\d+)/)?.[1]);
    await expect.poll(async () => Number((await position.textContent())?.match(/of (\d+)/)?.[1]), { timeout: 15_000 }).toBeGreaterThan(first);
    await shot(page, 'live');
    await expect(page.getByTestId('series-progress')).toContainText('1 of 1 game', { timeout: 60_000 });
  });

  test('the page does not move while a game is being played, and the newest move is on top', async ({ page }) => {
    await freshApp(page, 'watch');
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await startBattery(page, 1);
    const position = page.getByTestId('scrub-position');
    await expect(position).toContainText(/Move \d+ of \d+/, { timeout: 15_000 });
    await page.evaluate(() => window.scrollTo(0, 150));
    const before = await page.evaluate(() => window.scrollY);
    expect(before).toBeGreaterThan(0);
    const countBefore = Number((await position.textContent())?.match(/of (\d+)/)?.[1]);
    await expect.poll(async () => Number((await position.textContent())?.match(/of (\d+)/)?.[1]), { timeout: 15_000 }).toBeGreaterThan(countBefore + 3);
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    // newest first: the top item is the latest move
    const newest = Number((await position.textContent())?.match(/of (\d+)/)?.[1]) - 1;
    const top = Number(await page.getByTestId('move-item').first().getAttribute('data-index'));
    expect(top).toBeGreaterThanOrEqual(newest);
    await page.getByRole('tab', { name: 'Connection' }).click();
    await expect(page.getByTestId('frame-log')).toContainText('"type":"welcome"');
    const stamps = await page.locator('.frame-time').allTextContents();
    expect([...stamps].sort().reverse()).toEqual(stamps); // newest first
  });

  test('the history table says which seat each number belongs to', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana');
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('games-legend')).toHaveText('S1 = Bruno · S2 = Dana');
    await expect(page.getByTestId('issues-cell').filter({ hasText: /S2: \d+/ }).first()).toBeVisible();
  });

  test('the unchecked switch still shows its knob', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await openLobbyWith(page, 'Alice', 'Bruno');
    await page.getByRole('tab', { name: 'History' }).click();
    const toggle = page.getByLabel('Only games with problems');
    await expect(toggle).not.toBeChecked();
    const style = await toggle.evaluate((el) => {
      const s = getComputedStyle(el);
      return { image: s.backgroundImage, color: s.backgroundColor };
    });
    expect(style.image).toContain('circle');
    expect(style.color).not.toBe('rgb(255, 255, 255)');
    await shot(page, 'switch-off');
  });

  test('restart voids the game and keeps the count; reset discards the results', async ({ page }) => {
    await freshApp(page, 'watch');
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await startBattery(page, 3);
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Restart current game' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restart game' }).click();
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('game-row').filter({ hasText: 'Voided' })).toHaveCount(1);
    await expect(page.getByTestId('series-progress')).toContainText('0 of 3 games');

    await page.getByRole('button', { name: 'Reset series' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Reset series' }).click();
    await expect(page.getByTestId('series-progress')).toHaveCount(0);
    await expect(page.getByTestId('history-empty')).toBeVisible();
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
  });

  test('pauses when a program drops, shows the resume window, and continues on reconnect', async ({ page }) => {
    await freshApp(page, 'watch');
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await startBattery(page, 2);
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 15_000 });

    await openMockPanel(page);
    await page.getByTestId('mock-seat-2').getByRole('button', { name: 'Drop connection' }).click();
    await closeMockPanel(page);
    await expect(page.getByTestId('lobby-status')).toContainText('Paused');
    await expect(page.getByTestId('grace-countdown')).toContainText('s left');
    await shot(page, 'paused');
    const progress = await page.getByTestId('scrub-position').textContent();
    await page.waitForTimeout(600);
    await expect(page.getByTestId('scrub-position')).toHaveText(progress as string);

    await openMockPanel(page);
    await page.getByTestId('mock-seat-2').getByRole('button', { name: 'Reconnect' }).click();
    await closeMockPanel(page);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Running/);
    await expect(page.getByTestId('series-progress')).toContainText('2 of 2 games', { timeout: 60_000 });
  });

  test('a platform restart voids the game and waits for programs to reconnect', async ({ page }) => {
    await freshApp(page, 'watch');
    await loginAs(page, 'Alice');
    await createLobby(page, 'Bruno');
    await connectPrograms(page);
    await startBattery(page, 2);
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 15_000 });
    await openMockPanel(page);
    await page.getByRole('button', { name: 'Restart the platform' }).click();
    await expect(page.getByTestId('lobby-status')).toContainText('Paused');
    await page.getByRole('button', { name: 'Connect all programs' }).click();
    await closeMockPanel(page);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Running/);
  });

  test('an aborted battery keeps its partial results (seeded lobby)', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Chen');
    await openLobbyWith(page, 'Chen', 'Dana');
    await expect(page.getByTestId('series-aborted')).toContainText('did not reconnect');
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByTestId('verdict')).toContainText('aborted');
  });

  test('an expired lobby is read-only but keeps its history', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await openLobbyWith(page, 'Alice', 'Alice');
    await expect(page.getByTestId('lobby-status')).toContainText('Expired');
    await expect(page.getByRole('button', { name: /^Start/ })).toHaveCount(0);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('game-row')).toHaveCount(1);
  });

  test('self-play lobbies and practice-bot lobbies work end to end', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption('bot:hunt-target');
    await page.getByRole('button', { name: 'Create lobby' }).click();
    await expect(page.getByTestId('lobby-id')).toBeVisible();
    await expect(page.getByTestId('seat-card-2')).toContainText('Connected');
    await openMockPanel(page);
    await page.getByRole('button', { name: 'Connect program' }).click();
    await closeMockPanel(page);
    await startBattery(page, 6);
    await expect(page.getByTestId('series-progress')).toContainText('6 of 6 games', { timeout: 30_000 });

    await createLobby(page, 'Alice (yourself: two of your programs play each other)');
    await connectPrograms(page);
    await startBattery(page, 2);
    await expect(page.getByTestId('series-progress')).toContainText('2 of 2 games', { timeout: 30_000 });
  });
});

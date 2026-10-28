import { expect, test } from '@playwright/test';
import { AdminApi, createLobby, createToken, personPage, Program, startBattery } from './helpers';

test.describe('real stack: misbehaving and disappearing programs', () => {
  test('a dropped program pauses the battery with a countdown, and resumes when it reconnects', async ({ browser }) => {
    const admin = await AdminApi.login();
    const jay = await admin.person('Jay');
    const page = await personPage(browser, jay);
    const token = await createToken(page);
    const lobbyId = await createLobby(page, 'bot:hunt-target');
    let first = await Program.connect({ token, lobby: lobbyId, delayMs: 40 });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(page, 30);
    await expect(page.getByTestId('series-progress')).toBeVisible();

    first.kill();
    await expect(page.getByTestId('lobby-status')).toHaveText(/Paused/);
    await expect(page.getByTestId('grace-countdown')).toContainText('s left');

    first = await Program.connect({ token, lobby: lobbyId, delayMs: 5 });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Running|Ready/, { timeout: 15_000 });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/, { timeout: 60_000 });
    expect(first.of('welcome')[0].resumed).toBe(true);
    await page.getByRole('tab', { name: 'Results' }).click();
    await expect(page.getByTestId('stats-table')).toBeVisible();
  });

  test('a program that does not come back ends the battery as aborted, keeping partial results', async ({ browser }) => {
    const admin = await AdminApi.login();
    const kim = await admin.person('Kim');
    const page = await personPage(browser, kim);
    const token = await createToken(page);
    const lobbyId = await createLobby(page, 'bot:random');
    const program = await Program.connect({ token, lobby: lobbyId, delayMs: 20 });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(page, 200);
    await expect(page.getByTestId('series-progress')).toContainText(/[1-9]\d* of 200/, { timeout: 20_000 });
    program.kill();
    await expect(page.getByTestId('series-aborted')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('series-aborted')).toContainText('did not reconnect');
  });

  test('invalid moves show up in the history as issues, and the program is told what was wrong', async ({ browser }) => {
    const admin = await AdminApi.login();
    const lou = await admin.person('Lou');
    const page = await personPage(browser, lou);
    const token = await createToken(page);
    const lobbyId = await createLobby(page, 'bot:random');
    let bad = 0;
    const program = await Program.connect({
      token,
      lobby: lobbyId,
      onTurn: (frame, send) => {
        if (bad++ < 2) {
          send({ type: 'fire', rid: frame.rid, x: 99, y: 0 });
          return true;
        }
        return false;
      },
    });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(page, 1);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/, { timeout: 30_000 });
    expect(program.of('turn').filter((t) => t.error?.code === 'out_of_bounds')).toHaveLength(2);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('issues-cell').first()).toContainText('2');
    await page.getByTestId('game-row').first().click();
    await expect(page.getByTestId('move-item').filter({ hasText: /out_of_bounds|out of bounds/i }).first()).toBeVisible();
  });

  test('a lobby that stops on infraction ends the battery at the first one, from a real program', async ({ browser }) => {
    const admin = await AdminApi.login();
    const nat = await admin.person('Nat');
    const page = await personPage(browser, nat);
    const token = await createToken(page);
    await page.goto('/lobbies/new');
    await page.getByLabel('Opponent').selectOption('bot:random');
    await page.getByLabel('End a battery at the first infraction').check();
    await page.getByRole('button', { name: 'Create lobby' }).click();
    const lobbyId = ((await page.getByTestId('lobby-id').textContent()) as string).trim();
    await expect(page.getByTestId('stop-on-infraction')).toBeVisible();
    let turns = 0;
    const program = await Program.connect({
      token,
      lobby: lobbyId,
      onTurn: (frame, send) => {
        if (++turns === 30) {
          send({ type: 'fire', rid: frame.rid, x: 99, y: 99 });
          return true;
        }
        return false;
      },
    });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(page, 50);
    await expect(page.getByTestId('series-aborted')).toContainText('first infraction', { timeout: 30_000 });
    await expect.poll(() => program.of('reset').filter((r) => r.reason === 'series_stopped').length).toBe(1);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('game-row').last()).toContainText(/Voided/);
  });

  test('restarting the current game and resetting the series work from the interface', async ({ browser }) => {
    const admin = await AdminApi.login();
    const mia = await admin.person('Mia');
    const page = await personPage(browser, mia);
    const token = await createToken(page);
    const lobbyId = await createLobby(page, 'bot:hunt-target');
    const program = await Program.connect({ token, lobby: lobbyId, delayMs: 30 });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(page, 100);
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 20_000 });
    await page.getByRole('button', { name: 'Restart current game' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Restart/ }).click();
    await expect.poll(() => program.of('reset').filter((r) => r.reason === 'restart_game').length).toBe(1);
    await page.getByRole('button', { name: 'Reset series' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Reset/ }).click();
    await expect.poll(() => program.of('reset').filter((r) => r.reason === 'reset_series').length).toBe(1);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await expect(page.getByTestId('series-progress')).toHaveCount(0);
  });
});

import { expect, test } from '@playwright/test';
import { AdminApi, createLobby, createToken, personPage, Program, startBattery } from './helpers';

test.describe('real stack: participants and programs', () => {
  test('two participants make tokens, connect real programs, play a battery and read the results', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [ann, ben] = [await admin.person('Ann'), await admin.person('Ben')];
    const annPage = await personPage(browser, ann);
    const benPage = await personPage(browser, ben);
    const annToken = await createToken(annPage);
    const benToken = await createToken(benPage);

    const lobbyId = await createLobby(annPage, ben);
    await expect(annPage.getByTestId('lobby-status')).toHaveText(/Waiting/);
    // Ben sees the lobby appear in his list, without anyone approving it.
    await benPage.goto('/lobbies');
    await expect(benPage.getByTestId('lobby-row').filter({ hasText: `${ann} vs ${ben}` })).toBeVisible();

    const a = await Program.connect({ token: annToken, lobby: lobbyId, seed: 1, program: { name: 'ann-bot', version: '0.1' } });
    const b = await Program.connect({ token: benToken, lobby: lobbyId, seed: 2 });
    await expect(annPage.getByTestId('lobby-status')).toHaveText(/Ready/);
    await expect(annPage.getByTestId('seat-card-1')).toContainText('ann-bot');

    await startBattery(annPage, 8);
    await expect(annPage.getByTestId('series-progress')).toBeVisible();
    await annPage.getByRole('tab', { name: 'Results' }).click();
    await expect(annPage.getByTestId('stats-table')).toBeVisible();
    await expect(annPage.getByTestId('lobby-status')).toHaveText(/Ready/, { timeout: 30_000 });
    await expect(annPage.getByTestId('verdict')).toBeVisible();

    await annPage.getByRole('tab', { name: 'History' }).click();
    await expect(annPage.getByTestId('game-row')).toHaveCount(8);
    await annPage.getByTestId('game-row').first().click();
    await expect(annPage.getByTestId('move-item').first()).toBeVisible();

    expect(a.of('game_over')).toHaveLength(8);
    expect(b.of('game_over')).toHaveLength(8);
    expect(a.of('game_over').at(-1).series.done).toBe(true);

    // The frame log (Connection tab) shows the real traffic with the token masked.
    await annPage.getByRole('tab', { name: 'Connection' }).click();
    await expect(annPage.getByTestId('frame-log').first()).toContainText('"type":"hello"');
    await expect(annPage.locator('body')).not.toContainText(annToken);
    a.kill();
    b.kill();
  });

  test('a participant can practice against a bot, and delete the lobby afterwards', async ({ browser }) => {
    const admin = await AdminApi.login();
    const cat = await admin.person('Cat');
    const page = await personPage(browser, cat);
    const token = await createToken(page);
    const lobbyId = await createLobby(page, 'bot:hunt-target');
    const program = await Program.connect({ token, lobby: lobbyId });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(page, 5);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/, { timeout: 30_000 });
    expect(program.of('game_over')).toHaveLength(5);
    await page.getByRole('tab', { name: 'History' }).click();
    await expect(page.getByTestId('game-row')).toHaveCount(5);

    await page.getByRole('button', { name: /Delete lobby/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Delete/ }).click();
    await expect(page).toHaveURL(/\/lobbies$/);
    expect(await program.waitForClose()).toBe(4000);
  });

  test('replacing the token disconnects the program, and the lobby says so', async ({ browser }) => {
    const admin = await AdminApi.login();
    const dan = await admin.person('Dan');
    const page = await personPage(browser, dan);
    const token = await createToken(page);
    const lobbyId = await createLobby(page, 'bot:random');
    const program = await Program.connect({ token, lobby: lobbyId });
    await expect(page.getByTestId('lobby-status')).toHaveText(/Ready/);

    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByRole('button', { name: /Replace token/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Replace/ }).click();
    await expect(page.getByTestId('new-token')).toBeVisible();
    expect(await program.waitForClose()).toBe(4000);
    await page.getByRole('button', { name: 'I have saved it' }).click();
    await page.goto(`/lobbies/${lobbyId}`);
    await expect(page.getByTestId('lobby-status')).toHaveText(/Waiting/);
  });
});

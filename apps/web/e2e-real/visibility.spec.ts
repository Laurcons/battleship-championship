import { expect, test, type Page } from '@playwright/test';
import { AdminApi, createLobby, createToken, loginAsAdmin, personPage, Program, startBattery } from './helpers';

const shipCells = (page: Page, seat: 1 | 2) => page.locator(`[data-testid=board-seat-${seat}] [data-state="ship"]`);

test.describe('real stack: what each viewer can see', () => {
  test('a restricted lobby hides the opponent fleet while a game is live, from the browser too', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [eli, fay] = [await admin.person('Eli'), await admin.person('Fay')];
    const eliPage = await personPage(browser, eli);
    const fayPage = await personPage(browser, fay);
    const eliToken = await createToken(eliPage);
    const fayToken = await createToken(fayPage);
    const lobbyId = await createLobby(eliPage, fay, { godMode: false });
    await expect(eliPage.getByText('Restricted view')).toBeVisible();
    const a = await Program.connect({ token: eliToken, lobby: lobbyId, seed: 1, delayMs: 60 });
    const b = await Program.connect({ token: fayToken, lobby: lobbyId, seed: 2, delayMs: 60 });
    await expect(eliPage.getByTestId('lobby-status')).toHaveText(/Ready/);
    await startBattery(eliPage, 1);

    await fayPage.goto(`/lobbies/${lobbyId}`);
    for (const page of [eliPage, fayPage]) {
      await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 20_000 });
    }
    await expect.poll(async () => Number((await eliPage.getByTestId('scrub-position').textContent())?.match(/of (\d+)/)?.[1])).toBeGreaterThan(4);

    // Eli (seat 1) sees his own fleet and never Fay's; Fay the reverse.
    expect(await shipCells(eliPage, 1).count()).toBeGreaterThan(0);
    await expect(shipCells(eliPage, 2)).toHaveCount(0);
    await expect(eliPage.getByTestId('board-seat-2')).toContainText('Ships hidden');
    expect(await shipCells(fayPage, 2).count()).toBeGreaterThan(0);
    await expect(shipCells(fayPage, 1)).toHaveCount(0);

    // The admin sees both fleets.
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto(`/lobbies/${lobbyId}`);
    await expect(adminPage.getByTestId('admin-banner')).toBeVisible();
    await expect(adminPage.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 20_000 });
    expect(await shipCells(adminPage, 1).count()).toBeGreaterThan(0);
    expect(await shipCells(adminPage, 2).count()).toBeGreaterThan(0);

    // When the game is over everything is visible to both players.
    await expect(eliPage.getByTestId('lobby-status')).toHaveText(/Ready/, { timeout: 60_000 });
    await eliPage.getByRole('tab', { name: 'History' }).click();
    await eliPage.getByTestId('game-row').first().click();
    await eliPage.locator('[data-testid=move-item][data-index="1"]').click();
    expect(await shipCells(eliPage, 1).count()).toBeGreaterThan(0);
    expect(await shipCells(eliPage, 2).count()).toBeGreaterThan(0);
    a.kill();
    b.kill();
  });

  test("a participant cannot open someone else's lobby, and the page says it is not found", async ({ browser }) => {
    const admin = await AdminApi.login();
    const [gus, hal, ivy] = [await admin.person('Gus'), await admin.person('Hal'), await admin.person('Ivy')];
    const gusPage = await personPage(browser, gus);
    const lobbyId = await createLobby(gusPage, hal);
    const ivyPage = await personPage(browser, ivy);
    await ivyPage.goto(`/lobbies/${lobbyId}`);
    await expect(ivyPage.getByTestId('lobby-not-found')).toBeVisible();
    await expect(ivyPage.locator('body')).not.toContainText(gus);
    await ivyPage.goto('/lobbies');
    await expect(ivyPage.getByTestId('lobby-row')).toHaveCount(0);
  });
});

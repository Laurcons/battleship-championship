import { expect, test, type Page } from '@playwright/test';
import { closeMockPanel, connectPrograms, createLobby, freshApp, loginAs, loginAsAdmin, openLobbyWith, openMockPanel, startBattery } from './helpers';

const shipCells = (page: Page, seat: 1 | 2) => page.locator(`[data-testid=board-seat-${seat}] [data-state="ship"]`);

async function switchUser(page: Page, name: string) {
  await openMockPanel(page);
  await page.getByLabel('Switch user').selectOption({ label: name });
  await expect(page.getByTestId('current-user')).toContainText(name);
  await closeMockPanel(page);
}

test.describe('what each viewer can see', () => {
  test('restricted lobbies hide the opponent fleet while a game is live, and reveal everything afterwards', async ({ page }) => {
    await freshApp(page, 'watch');
    await loginAs(page, 'Bruno');
    await createLobby(page, 'Dana', undefined, false);
    await expect(page.getByText('Restricted view')).toBeVisible();
    const lobbyId = (await page.getByTestId('lobby-id').textContent()) as string;
    await connectPrograms(page);
    await startBattery(page, 1);
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/, { timeout: 15_000 });
    await expect.poll(async () => Number((await page.getByTestId('scrub-position').textContent())?.match(/of (\d+)/)?.[1])).toBeGreaterThan(4);

    // Bruno owns seat 1: sees his own fleet, never Dana's
    expect(await shipCells(page, 1).count()).toBeGreaterThan(0);
    await expect(shipCells(page, 2)).toHaveCount(0);
    await expect(page.getByTestId('board-seat-2')).toContainText('Ships hidden');

    // From Dana's point of view it is the other way around
    await switchUser(page, 'Dana');
    await page.getByRole('link', { name: lobbyId }).click();
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/);
    expect(await shipCells(page, 2).count()).toBeGreaterThan(0);
    await expect(shipCells(page, 1)).toHaveCount(0);

    // The admin always sees both
    await switchUser(page, 'Admin');
    await page.getByRole('link', { name: lobbyId }).click();
    await expect(page.getByTestId('admin-banner')).toBeVisible();
    await expect(page.getByTestId('scrub-position')).toContainText(/Move \d+ of/);
    expect(await shipCells(page, 1).count()).toBeGreaterThan(0);
    expect(await shipCells(page, 2).count()).toBeGreaterThan(0);

    // Once the game is over, a restricted viewer sees everything
    await switchUser(page, 'Bruno');
    await page.getByRole('link', { name: lobbyId }).click();
    await expect(page.getByTestId('series-progress')).toContainText('1 of 1 game', { timeout: 60_000 });
    await page.getByRole('tab', { name: 'History' }).click();
    await page.getByTestId('game-row').first().click();
    await page.locator('[data-testid=move-item][data-index="1"]').click(); // after both placements
    expect(await shipCells(page, 1).count()).toBeGreaterThan(0);
    expect(await shipCells(page, 2).count()).toBeGreaterThan(0);
  });

  test('the admin sees both fleets in a restricted lobby (seeded) and has read-only controls', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/lobbies');
    await page.getByTestId('lobby-row').filter({ hasText: 'Bruno vs Dana' }).getByRole('link').click();
    await expect(page.getByTestId('admin-banner')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Restart current game' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete lobby' })).toBeVisible();
    await page.getByRole('tab', { name: 'Connection' }).click();
    await page.getByLabel('Program').selectOption({ index: 1 }); // the admin may read either program's frames
    await expect(page.getByTestId('frame-log')).toContainText('"type":"turn"');
  });

  test("a participant can only read their own program's frames", async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana');
    await page.getByRole('tab', { name: 'Connection' }).click();
    await expect(page.getByLabel('Program')).toHaveCount(0); // only one program is his
    await expect(page.getByTestId('frame-log')).toContainText('"type":"turn"');
  });
});

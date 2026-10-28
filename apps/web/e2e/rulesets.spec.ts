import { expect, test } from '@playwright/test';
import { expectNoAxeViolations, freshApp, loginAs, loginAsAdmin, logout, openLobbyWith, shot } from './helpers';

test.describe('rulesets in the lobby and in the docs', () => {
  test('a lobby has a Rules tab with every setting of its ruleset', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana'); // quick-8x8
    await page.getByRole('tab', { name: 'Rules' }).click();
    const details = page.getByTestId('ruleset-details');
    await expect(details).toContainText('8×8');
    await expect(details).toContainText('4 ships (4, 3, 3, 2), 12 cells');
    await expect(details).toContainText('Ships may not touch, not even diagonally');
    await expect(details).toContainText('Turns alternate after every shot');
    await expect(details).toContainText('Announced, with their length');
    await expect(details).toContainText('An invalid move: it counts as a strike');
    await expect(details).toContainText("Programs are shown the opponent's layout and shots");
    await expect(page.getByRole('img', { name: 'Fleet: ships of length 4, 3, 3, 2' })).toBeVisible();
    await expect(page.getByTestId('lobby-visibility')).toContainText('Restricted view');
    await expect(page.getByTestId('limits')).toContainText('Move timeout: 10 s');
    await expect(page.getByTestId('limits')).toContainText('3 strikes');
    await shot(page, 'lobby-rules');

    // what a program receives, in the documented (snake_case) format
    const wire = JSON.parse((await page.getByTestId('wire-ruleset').textContent()) as string);
    expect(wire).toEqual({
      id: 'quick-8x8', width: 8, height: 8, fleet: [4, 3, 3, 2], touching: false,
      extra_turn_on_hit: false, announce_sunk: true, repeat_shot: 'invalid', reveal_on_game_over: true,
    });
    await expect(page.getByRole('link', { name: 'list of all rulesets' })).toHaveAttribute('href', '/docs/rulesets');
    await expectNoAxeViolations(page, 'lobby: rules');
  });

  test('the Rules tab survives a reload through its address, and the settings differ per lobby', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await openLobbyWith(page, 'Alice', 'Bruno'); // classic-10x10
    await page.getByRole('tab', { name: 'Rules' }).click();
    await expect(page).toHaveURL(/tab=rules/);
    await expect(page.getByTestId('ruleset-details')).toContainText('A hit gives another turn');
    await expect(page.getByTestId('ruleset-details')).toContainText('10×10');
    await expect(page.getByTestId('lobby-visibility')).toContainText('God mode');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByTestId('ruleset-details')).toContainText('A hit gives another turn');
  });

  test('a disabled ruleset is still readable in lobbies that use it, with a note', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/rulesets');
    await page.getByLabel('quick-8x8 enabled').click();
    await expect(page.getByLabel('quick-8x8 enabled')).not.toBeChecked();
    await logout(page);
    await loginAs(page, 'Bruno');
    await openLobbyWith(page, 'Bruno', 'Dana');
    await page.getByRole('tab', { name: 'Rules' }).click();
    await expect(page.getByTestId('ruleset-disabled')).toContainText('can no longer be chosen for new lobbies');
    await expect(page.getByTestId('ruleset-details')).toContainText('8×8'); // rules unchanged
  });

  test('the docs list every ruleset, marking disabled and default ones', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.getByRole('link', { name: 'Docs' }).click();
    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Rulesets' }).click();
    await expect(page).toHaveURL(/\/docs\/rulesets$/);
    await expect(page.getByRole('heading', { name: 'What the settings mean' })).toBeVisible();
    const cards = page.getByTestId('ruleset-card');
    await expect(cards).toHaveCount(4);
    await expect(cards.filter({ hasText: 'strict-10x10' })).toContainText('disabled: not available for new lobbies');
    await expect(cards.filter({ hasText: 'strict-10x10' })).toContainText('Wastes the turn');
    await expect(cards.filter({ hasText: 'strict-10x10' })).toContainText('The opponent layout stays hidden from programs');
    await expect(cards.filter({ hasText: 'classic-10x10-touching' })).toContainText('Ships may touch');
    await expect(cards.filter({ hasText: 'default for new lobbies' })).toHaveCount(1);
    await expect(page.locator('[data-ruleset="classic-10x10"]')).toContainText('default for new lobbies');
    // the default first, disabled rulesets last
    expect(await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-ruleset')))).toEqual([
      'classic-10x10', 'classic-10x10-touching', 'quick-8x8', 'strict-10x10',
    ]);
    await expect(page.locator('[data-ruleset="quick-8x8"]')).toContainText('Turns alternate after every shot');
    await shot(page, 'docs-rulesets');
    await expectNoAxeViolations(page, 'docs/rulesets');
  });

  test('a new ruleset shows up in the docs but is not the default; changing the default reorders the list', async ({ page }) => {
    await freshApp(page);
    await loginAsAdmin(page);
    await page.goto('/admin/rulesets');
    await page.getByRole('button', { name: 'New ruleset' }).click();
    await page.getByLabel('Id', { exact: true }).fill('salvo-lite');
    await page.getByLabel('Description').fill('A made-up mode for the docs test');
    await page.getByLabel('Ships may touch').check();
    await page.getByRole('button', { name: 'Create ruleset' }).click();
    await expect(page.getByTestId('ruleset-row').filter({ hasText: 'salvo-lite' })).toBeVisible();
    await page.getByRole('button', { name: 'Make salvo-lite the default' }).click();
    await expect(page.getByTestId('ruleset-row').first()).toContainText('salvo-lite');
    await page.getByLabel('classic-10x10 enabled').click(); // no longer the default: can be disabled
    await expect(page.getByLabel('classic-10x10 enabled')).not.toBeChecked();
    await logout(page);

    await loginAs(page, 'Chen');
    await page.goto('/docs/rulesets');
    const cards = page.getByTestId('ruleset-card');
    await expect(cards).toHaveCount(5);
    const card = page.locator('[data-ruleset="salvo-lite"]');
    await expect(card).toContainText('A made-up mode for the docs test');
    await expect(card).toContainText('Ships may touch');
    await expect(card).toContainText('default for new lobbies');
    const order = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-ruleset')));
    expect(order[0]).toBe('salvo-lite');
    expect(order.slice(-2).sort()).toEqual(['classic-10x10', 'strict-10x10']); // the disabled ones are last
  });

  test('ruleset cards line up: labels do not hang outside their card', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/docs/rulesets');
    const card = page.locator('[data-ruleset="classic-10x10"]');
    const box = await card.boundingBox();
    const title = await card.locator('h3').boundingBox();
    const firstLabel = await card.locator('dt').first().boundingBox();
    const firstValue = await card.locator('dd').first().boundingBox();
    expect(firstLabel!.x).toBeGreaterThanOrEqual(box!.x); // inside the card
    expect(Math.abs(firstLabel!.x - title!.x)).toBeLessThanOrEqual(1); // aligned with the title
    expect(firstValue!.x).toBeGreaterThan(firstLabel!.x + firstLabel!.width); // value column after labels
    // and on the lobby Rules tab
    await page.goto('/lobbies');
    await page.getByTestId('lobby-row').first().getByRole('link').click();
    await page.getByRole('tab', { name: 'Rules' }).click();
    const rulesCard = page.locator('.card').filter({ has: page.getByTestId('ruleset-details') });
    const t2 = await rulesCard.locator('h2').first().boundingBox();
    const l2 = await page.getByTestId('ruleset-details').locator('dt').first().boundingBox();
    expect(Math.abs(l2!.x - t2!.x)).toBeLessThanOrEqual(1);
  });
});

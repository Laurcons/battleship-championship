import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser } from '@playwright/test';
import { AdminApi, createLobby, createToken, loginAsAdmin, personPage, Program, rowAction } from './helpers';

/** An admin looking at the Token monitor. */
async function adminPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await loginAsAdmin(page);
  return page;
}

test.describe('real stack: token activity', () => {
  test('a token used from a second address is flagged; the admin investigates, reviews it, and a new address brings it back', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [ann, bea] = [await admin.person('Ann'), await admin.person('Bea')];
    const annPage = await personPage(browser, ann);
    const beaPage = await personPage(browser, bea);
    const annToken = await createToken(annPage);
    await createToken(beaPage);
    const lobbyId = await createLobby(annPage, bea, { godMode: false });

    // One program from one address, then the same token from another address while the first is still connected.
    const first = await Program.connect({ token: annToken, lobby: lobbyId, from: '84.10.0.1', program: { name: 'ann-bot', version: '1.0' } });
    await expect.poll(() => first.of('welcome').length).toBe(1);
    const second = await Program.connect({ token: annToken, lobby: lobbyId, from: '91.20.0.2', program: { name: 'ann-bot', version: '1.1' } });
    expect(await first.waitForClose()).toBe(4000);
    await expect.poll(() => second.of('welcome').length).toBe(1);

    const page = await adminPage(browser);
    await page.goto('/admin/tokens');
    const rows = page.getByTestId('signal-row');
    const mine = rows.filter({ hasText: ann });
    await expect(mine.filter({ hasText: 'taken over' })).toContainText('High');
    await expect(mine.filter({ hasText: 'taken over' })).toContainText('84.10.0.1');
    await expect(mine.filter({ hasText: 'New address 91.20.0.2' })).toContainText('Notice');
    await expect(page.getByTestId('admin-attention')).toBeVisible();

    // The participants list points at the same thing, and the modal has the evidence.
    await page.goto('/admin/participants');
    await expect(page.getByTestId('participants-table').getByRole('row').filter({ hasText: ann }).getByTestId('last-connection')).toContainText('91.20.0.2');
    await rowAction(page, ann, 'Activity…');
    const modal = page.getByTestId('activity-modal');
    await expect(modal.getByTestId('address-table')).toContainText('84.10.0.1');
    await expect(modal.getByTestId('address-table')).toContainText('91.20.0.2');
    await expect(modal.getByTestId('connection-table')).toContainText('Taken over by 91.20.0.2');
    await expect(modal.getByTestId('connection-table')).toContainText('ann-bot 1.1');
    await expect(modal.getByTestId('connection-table')).toContainText(lobbyId);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
    await modal.getByRole('button', { name: 'Mark all reviewed' }).click();
    await expect(modal.getByTestId('unreviewed-count')).toHaveText('0 unreviewed');
    await modal.locator('.modal-footer').getByRole('button', { name: 'Close' }).click();

    // Reviewed: gone from the monitor. A new address afterwards: back again, and only that.
    await page.goto('/admin/tokens');
    await expect(rows.filter({ hasText: ann })).toHaveCount(0);
    second.kill();
    const third = await Program.connect({ token: annToken, lobby: lobbyId, from: '77.30.0.3' });
    await expect.poll(() => third.of('welcome').length).toBe(1);
    await expect(rows.filter({ hasText: ann }).filter({ hasText: 'New address 77.30.0.3' })).toBeVisible({ timeout: 15_000 });
    await expect(rows.filter({ hasText: ann }).filter({ hasText: 'taken over' })).toHaveCount(0);

    // The audit log has the story too.
    await page.goto('/admin/audit');
    await page.getByLabel('Filter audit log').fill(ann);
    await expect(page.getByTestId('audit-table')).toContainText('program_replaced');
    await expect(page.getByTestId('audit-table')).toContainText('84.10.0.1 → 91.20.0.2');
    await expect(page.getByTestId('audit-table')).toContainText('program_connected');
    third.kill();
  });

  test("a valid token on somebody else's lobby is refused like any wrong token, and the admin hears about it", async ({ browser }) => {
    const admin = await AdminApi.login();
    const [cat, dov, eli] = [await admin.person('Cat'), await admin.person('Dov'), await admin.person('Eli')];
    const dovPage = await personPage(browser, dov);
    await personPage(browser, eli).then(createToken);
    const catPage = await personPage(browser, cat);
    const catToken = await createToken(catPage);
    const lobbyId = await createLobby(dovPage, eli, { godMode: false });

    const intruder = await Program.connect({ token: catToken, lobby: lobbyId, from: '88.8.8.8' });
    const wrong = await Program.connect({ token: `bsc_${'x'.repeat(32)}`, lobby: lobbyId, from: '88.8.8.8' });
    const code = await intruder.waitForClose();
    expect(code).toBe(await wrong.waitForClose()); // the program cannot tell the difference

    const page = await adminPage(browser);
    await page.goto('/admin/tokens');
    const row = page.getByTestId('signal-row').filter({ hasText: cat }).filter({ hasText: 'not theirs' });
    await expect(row).toContainText('High');
    await expect(row).toContainText(lobbyId);
    await expect(row).toContainText('88.8.8.8');
    await row.getByRole('button', { name: `Investigate ${cat}` }).click();
    await expect(page.getByTestId('denied-table')).toContainText(lobbyId);
    // Nothing is recorded for the wrong token: it belongs to nobody.
    await page.getByTestId('activity-modal').locator('.modal-footer').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('signal-row').filter({ hasText: dov })).toHaveCount(0);
  });

  test('resetting a token from the monitor ends the problem: the participant is reviewed and their program is dropped', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [fay, gus] = [await admin.person('Fay'), await admin.person('Gus')];
    const fayPage = await personPage(browser, fay);
    await personPage(browser, gus).then(createToken);
    const fayToken = await createToken(fayPage);
    const lobbyId = await createLobby(fayPage, gus, { godMode: false });
    const a = await Program.connect({ token: fayToken, lobby: lobbyId, from: '84.1.0.1' });
    await expect.poll(() => a.of('welcome').length).toBe(1);
    const b = await Program.connect({ token: fayToken, lobby: lobbyId, from: '91.2.0.2' });
    await expect.poll(() => b.of('welcome').length).toBe(1);

    const page = await adminPage(browser);
    await page.goto('/admin/tokens');
    const mine = page.getByTestId('signal-row').filter({ hasText: fay });
    await mine.first().getByRole('button', { name: `Investigate ${fay}` }).click();
    await page.getByTestId('activity-modal').getByRole('button', { name: 'Reset token…' }).click();
    await page.getByRole('dialog').filter({ hasText: `Reset the token of ${fay}` }).getByRole('button', { name: 'Reset token' }).click();
    expect(await b.waitForClose()).toBe(4000);
    await expect(page.getByTestId('activity-modal').getByTestId('unreviewed-count')).toHaveText('0 unreviewed');
    await page.getByTestId('activity-modal').locator('.modal-footer').getByRole('button', { name: 'Close' }).click();
    await expect(mine).toHaveCount(0);
    await page.getByTestId('activity-modal').waitFor({ state: 'detached' });
  });

  test('the monitor has no accessibility violations on real data, and its two tabs load', async ({ browser }) => {
    const page = await adminPage(browser);
    await page.goto('/admin/tokens');
    await expect(page.getByTestId('stat-attention')).toBeVisible();
    let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
    await page.getByRole('tab', { name: 'All connections' }).click();
    await expect(page.getByTestId('all-connections')).toBeVisible();
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

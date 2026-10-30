import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AdminApi, createLobby, createToken, loginAsAdmin, personPage, Program, startBattery, uid } from './helpers';

test.describe('real stack: admin', () => {
  test('creates participants and rulesets, who then show up for everyone', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await loginAsAdmin(page);
    const name = `Ned${uid()}`;
    await page.goto('/admin/participants');
    await page.getByLabel('Add a participant').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('participants-table')).toContainText(name);
    await page.getByLabel('Add a participant').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByTestId('error-alert')).toContainText('already a participant');

    const admin = await AdminApi.login();
    const other = await admin.person('Oli');
    const personal = await personPage(browser, other);
    await personal.goto('/lobbies/new');
    await expect(personal.getByLabel('Opponent')).toContainText(name);
  });

  test('resetting a token from the participants page disconnects the program, and the owner creates a new token', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [sam, tia] = [await admin.person('Sam'), await admin.person('Tia')];
    const samPage = await personPage(browser, sam);
    const tiaPage = await personPage(browser, tia);
    const samToken = await createToken(samPage);
    const tiaToken = await createToken(tiaPage);
    const lobbyId = await createLobby(samPage, tia, { godMode: false });
    const a = await Program.connect({ token: samToken, lobby: lobbyId, seed: 1 });
    const b = await Program.connect({ token: tiaToken, lobby: lobbyId, seed: 2 });
    await expect(samPage.getByTestId('lobby-status')).toHaveText(/Ready/);

    const adminPage = await (await browser.newContext()).newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto('/admin/participants');
    const row = adminPage.getByTestId('participants-table').getByRole('row').filter({ hasText: sam });
    await adminPage.getByRole('button', { name: `Reset token of ${sam}` }).click();
    await adminPage.getByRole('dialog').getByRole('button', { name: 'Reset token' }).click();
    await expect(row).toContainText('Not created yet');
    await expect(adminPage.getByRole('button', { name: `Reset token of ${sam}` })).toBeDisabled();

    expect(await a.waitForClose()).toBe(4000);
    expect(b.closeCode).toBeNull(); // the opponent is not affected
    await expect(samPage.getByTestId('seat-card-1')).toContainText('Not connected');
    // The old token is refused.
    const stale = await Program.connect({ token: samToken, lobby: lobbyId });
    expect(await stale.waitForClose()).toBe(4401);

    // The owner is told, creates a new token, and the program is welcome again.
    await samPage.goto('/account');
    await expect(samPage.getByTestId('token-notice')).toContainText('An admin reset your token');
    await expect(samPage.getByTestId('no-token')).toBeVisible();
    const fresh = await createToken(samPage);
    expect(fresh).not.toBe(samToken);
    const back = await Program.connect({ token: fresh, lobby: lobbyId, seed: 3 });
    await samPage.goto(`/lobbies/${lobbyId}`);
    await expect(samPage.getByTestId('lobby-status')).toHaveText(/Ready/);
    back.kill();
    b.kill();
  });

  test('deleting a participant from the participants page deletes their lobbies, even a running battery of someone else', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [uma, vic, wes] = [await admin.person('Uma'), await admin.person('Vic'), await admin.person('Wes')];
    const umaPage = await personPage(browser, uma);
    const vicPage = await personPage(browser, vic);
    const wesPage = await personPage(browser, wes);
    const [umaToken, vicToken] = [await createToken(umaPage), await createToken(vicPage)];
    // Uma creates a lobby with Vic and runs a long battery; Vic also has a lobby with Wes that has nothing to do with Uma.
    // Without god mode, so a concurrent test that switches the god-mode policy cannot make creation fail.
    const lobbyUv = await createLobby(umaPage, vic, { godMode: false });
    const lobbyVw = await createLobby(vicPage, wes, { godMode: false });
    const a = await Program.connect({ token: umaToken, lobby: lobbyUv, seed: 1, delayMs: 20 });
    const b = await Program.connect({ token: vicToken, lobby: lobbyUv, seed: 2, delayMs: 20 });
    await expect(umaPage.getByTestId('lobby-status')).toHaveText(/Ready/);
    await umaPage.goto(`/lobbies/${lobbyUv}`);
    await startBattery(umaPage, 100);
    await expect(umaPage.getByTestId('series-progress')).toBeVisible();

    const adminPage = await (await browser.newContext()).newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto('/admin/participants');
    await adminPage.getByRole('button', { name: `Delete ${vic}` }).click();
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog.getByTestId('doomed-count')).toHaveText('2');
    await expect(dialog.getByTestId('doomed-lobbies')).toContainText(lobbyUv);
    await expect(dialog.getByTestId('doomed-lobbies')).toContainText(lobbyVw);
    await expect(dialog.getByTestId('doomed-lobbies')).toContainText(`created by ${uma}`);
    await dialog.getByRole('button', { name: 'Delete participant' }).click();
    await expect(adminPage.getByTestId('participants-table')).not.toContainText(vic);
    await expect(adminPage.getByTestId('error-alert')).toHaveCount(0);

    // The running battery is stopped and both programs are closed.
    expect(await a.waitForClose()).toBe(4000);
    expect(await b.waitForClose()).toBe(4000);
    // The other participants no longer see the lobbies, and the page says it is not found.
    await umaPage.goto(`/lobbies/${lobbyUv}`);
    await expect(umaPage.getByTestId('lobby-not-found')).toBeVisible();
    await wesPage.goto('/lobbies');
    await expect(wesPage.getByTestId('lobby-row').filter({ hasText: vic })).toHaveCount(0);
    await wesPage.goto(`/lobbies/${lobbyVw}`);
    await expect(wesPage.getByTestId('lobby-not-found')).toBeVisible();
  });

  test('the god-mode policy locks the option for new lobbies between participants', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [pat, quin] = [await admin.person('Pat'), await admin.person('Quin')];
    const page = await personPage(browser, pat);
    try {
      await admin.call('PATCH', '/api/admin/settings', { allowGodMode: false });
      await page.goto('/lobbies/new');
      await page.getByLabel('Opponent').selectOption({ label: quin });
      await expect(page.getByLabel('Show both fleets live (god mode)')).toBeDisabled();
      await expect(page.getByLabel('Show both fleets live (god mode)')).not.toBeChecked();
      await createLobby(page, quin);
      await expect(page.getByText('Restricted view')).toBeVisible();
    } finally {
      await admin.call('PATCH', '/api/admin/settings', { allowGodMode: true });
    }
  });

  test('records sensitive actions in the audit log', async ({ browser }) => {
    const admin = await AdminApi.login();
    const rae = await admin.person('Rae');
    const page = await personPage(browser, rae);
    await page.getByRole('link', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Create my token' }).click();
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAsAdmin(adminPage);
    await adminPage.goto('/admin/audit');
    await expect(adminPage.getByTestId('audit-table')).toContainText('token_created');
    await expect(adminPage.getByTestId('audit-table')).toContainText(rae);
  });

  test('has no accessibility violations on the main pages with real data', async ({ browser }) => {
    const admin = await AdminApi.login();
    const [sam, tia] = [await admin.person('Sam'), await admin.person('Tia')];
    const page = await personPage(browser, sam);
    const lobbyId = await createLobby(page, tia);
    const check = async (label: string) => {
      await expect(page.locator('.fade:not(.show)')).toHaveCount(0); // axe misreads colours while something fades in
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`), label).toEqual([]);
    };
    for (const path of ['/lobbies', '/lobbies/new', '/account', `/lobbies/${lobbyId}`, '/docs']) {
      await page.goto(path);
      await expect(page.getByRole('heading').first()).toBeVisible();
      await check(path);
    }
    await page.goto(`/lobbies/${lobbyId}`);
    for (const tab of ['History', 'Results', 'Rules', 'Connection']) {
      await page.getByRole('tab', { name: tab }).click();
      await check(`lobby ${tab}`);
    }
  });
});

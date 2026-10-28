import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { AdminApi, createLobby, loginAsAdmin, personPage, uid } from './helpers';

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

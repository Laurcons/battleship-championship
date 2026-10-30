import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { expectNoAxeViolations, freshApp, loginAs } from './helpers';

test.describe('documentation', () => {
  test('is reachable after login and covers the protocol, rules and examples', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/\/docs\/getting-started$/);
    await expect(page.getByRole('heading', { name: 'Getting started', level: 1 })).toBeVisible();

    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Rules for programs' }).click();
    await expect(page.getByText('must not persist anything between batteries')).toBeVisible();

    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Protocol' }).click();
    await expect(page.getByTestId('protocol-versions')).toContainText('/program/v1');
    await expect(page.getByRole('heading', { name: /Program Protocol v1/ })).toBeVisible();
    await expect(page.locator('.docs-content table').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /`?hello`?/ }).first()).toBeVisible();
  });

  test('is public: anyone can read it without logging in, and nothing else opens up', async ({ page }) => {
    await freshApp(page);
    await page.goto('/docs');
    await expect(page).toHaveURL(/\/docs\/getting-started$/);
    await expect(page.getByRole('heading', { name: 'Getting started', level: 1 })).toBeVisible();
    const bar = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(bar.getByRole('link', { name: 'Participant login' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Admin login' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Lobbies' })).toHaveCount(0);
    await expect(page.getByTestId('current-user')).toHaveCount(0);

    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Protocol' }).click();
    await expect(page.getByTestId('protocol-versions')).toContainText('/program/v1');

    // The rulesets page loads the list from the API; it works for visitors, marks the default, and shows no lobby counts.
    await page.getByRole('navigation', { name: 'Documentation' }).getByRole('link', { name: 'Rulesets' }).click();
    await expect(page.getByTestId('ruleset-card').first()).toBeVisible();
    await expect(page.getByTestId('rulesets-list')).toContainText('classic-10x10');
    await expect(page.getByTestId('rulesets-list')).toContainText('default for new lobbies');
    await expectNoAxeViolations(page, 'public docs/rulesets');

    // Examples can be downloaded without an account.
    await page.goto('/docs/examples');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('example-typescript').getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('bot.ts');

    // Everything else still needs a login.
    for (const path of ['/lobbies', '/account', '/admin/participants']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/(admin\/)?login$/);
    }
  });

  test('is linked from the login pages, and logging in from the docs leads to the usual navigation', async ({ page }) => {
    await freshApp(page);
    await page.goto('/login');
    await page.getByRole('link', { name: 'Read the documentation' }).click();
    await expect(page).toHaveURL(/\/docs\/getting-started$/);
    await page.goto('/admin/login');
    await expect(page.getByRole('link', { name: 'Read the documentation' })).toBeVisible();

    await page.goto('/docs/rules');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Participant login' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await loginAs(page, 'Alice');
    await page.getByRole('link', { name: 'Docs' }).click();
    await expect(page.getByTestId('current-user')).toContainText('Alice'); // the member navigation, not the visitor bar
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Participant login' })).toHaveCount(0);
  });

  test('offers the example programs for download', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/docs/examples');
    for (const [slug, filename, marker] of [
      ['typescript', 'bot.ts', "type: 'hello'"],
      ['python', 'bot.py', '"type": "hello"'],
    ] as const) {
      const example = page.getByTestId(`example-${slug}`);
      await expect(example).toContainText(marker);
      const [download] = await Promise.all([page.waitForEvent('download'), example.getByRole('button', { name: 'Download' }).click()]);
      expect(download.suggestedFilename()).toBe(filename);
      const saved = fs.readFileSync((await download.path()) as string, 'utf8');
      expect(saved).toContain(marker);
    }
  });

  test('every documented JSON example in the protocol is valid JSON', async () => {
    const md = fs.readFileSync('../../docs/protocol-v1.md', 'utf8');
    const blocks = [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1] as string);
    expect(blocks.length).toBeGreaterThan(8);
    for (const block of blocks) expect(() => JSON.parse(block.replace(/"(you|enemy)": *\[[^\]]*\]/g, '"$1": []'))).not.toThrow();
  });
});

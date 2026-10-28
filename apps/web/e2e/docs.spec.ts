import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { freshApp, loginAs } from './helpers';

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
    await expect(page.getByRole('heading', { name: 'Protocol v1 (DRAFT)' }).or(page.getByRole('heading', { name: /Program Protocol v1/ }))).toBeVisible();
    await expect(page.locator('.docs-content table').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /`?hello`?/ }).first()).toBeVisible();
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

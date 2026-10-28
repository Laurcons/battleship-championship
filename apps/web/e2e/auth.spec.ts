import { expect, test } from '@playwright/test';
import { SHARED_PASSWORD, freshApp, loginAs, loginAsAdmin, logout } from './helpers';

test.describe('authentication', () => {
  test('redirects anonymous visitors to the login page', async ({ page }) => {
    await freshApp(page);
    await page.goto('/lobbies');
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/admin/rulesets');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });

  test('shows names only after the shared password, then logs in', async ({ page }) => {
    await freshApp(page);
    await page.goto('/login');
    await expect(page.getByLabel('Your name')).toHaveCount(0);

    await page.getByLabel('Shared password').fill('wrong');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('error-alert')).toContainText('Wrong password');
    await expect(page.getByLabel('Your name')).toHaveCount(0);

    await page.getByLabel('Shared password').fill(SHARED_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
    const options = await page.getByLabel('Your name').locator('option').allTextContents();
    expect(options).toEqual(['Select your name…', 'Alice', 'Bruno', 'Chen', 'Dana']);

    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.getByText('Pick your name.')).toBeVisible();
    await page.getByLabel('Your name').selectOption({ label: 'Chen' });
    await page.getByRole('button', { name: 'Enter' }).click();
    await expect(page.getByTestId('current-user')).toContainText('Chen');
    await expect(page).toHaveURL(/\/lobbies$/);
  });

  test('keeps the session across a reload and logs out', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.reload();
    await expect(page.getByTestId('current-user')).toContainText('Alice');
    await logout(page);
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/lobbies');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('rate-limits repeated wrong passwords', async ({ page }) => {
    await freshApp(page);
    await page.goto('/login');
    for (let i = 0; i < 5; i++) {
      await page.getByLabel('Shared password').fill(`wrong${i}`);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page.getByTestId('error-alert')).toContainText('Wrong password');
    }
    await page.getByLabel('Shared password').fill(SHARED_PASSWORD);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('error-alert')).toContainText('Too many failed attempts');
  });

  test('admin login needs the right credentials', async ({ page }) => {
    await freshApp(page);
    await page.goto('/admin/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('nope');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByTestId('error-alert')).toContainText('Wrong username or password');
    await loginAsAdmin(page);
    await expect(page).toHaveURL(/\/admin\/participants$/);
  });

  test('participants cannot use admin pages', async ({ page }) => {
    await freshApp(page);
    await loginAs(page, 'Alice');
    await page.goto('/admin/settings');
    await expect(page.getByTestId('admin-only')).toBeVisible();
    await expect(page.getByLabel('Allow participants to choose god mode')).toHaveCount(0);
  });
});

import { expect, test } from '@playwright/test';

test('the shell loads, uses the self-hosted font and does not scroll', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('callouts_');

  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes('IBM Plex Mono') && f.status === 'loaded');
  });
  expect(fontLoaded).toBe(true);

  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - innerWidth,
    y: document.documentElement.scrollHeight - innerHeight,
  }));
  expect(overflow).toEqual({ x: 0, y: 0 });
});

test('an unknown address says so and offers the way back', async ({ page }) => {
  await page.goto('/#/nowhere');
  await expect(page.getByText('Nothing at')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to the start' })).toBeVisible();
});

test('every route renders something under the app shell', async ({ page }) => {
  for (const hash of ['#/', '#/map/de_mirage', '#/study/de_mirage', '#/summary/de_mirage', '#/progress', '#/settings']) {
    await page.goto(`/${hash}`);
    await expect(page.locator('.app')).toHaveCount(1);
    await expect(page.locator('.bar .brand')).toBeVisible();
  }
});

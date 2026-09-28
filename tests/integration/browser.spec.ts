import { test, expect } from '@playwright/test';

test('procedures and shard updates retain request context', async ({ page }) => {
  const requests: { url: string; method: string }[] = [],
    errors: string[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#count')).toHaveText('1');
  await page.locator('#increment').click();
  await expect(page.locator('#count')).toHaveText('2');
  await expect(page.locator('#results')).toHaveText('Result: 2');
  await expect(page.locator('#results')).toHaveAttribute('data-context', 'request context works');
  await page.locator('#double').click();
  await expect(page.locator('#count')).toHaveText('4');
  await expect(page.locator('#results')).toHaveText('Result: 4');
  expect(requests.some((r) => r.url.endsWith('/api/double') && r.method === 'POST')).toBe(true);
  expect(requests.some((r) => r.url.endsWith('/api/results') && r.method === 'POST')).toBe(true);
  expect(requests.some((r) => r.url.includes('.wasm'))).toBe(false);
  expect(errors).toEqual([]);
});

test('progressive updates replace the loading region in the DOM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/stream', { waitUntil: 'commit' });
  await expect(page.locator('#live-state')).toHaveText('Finished');
  await expect(page.locator('#live-state')).toHaveCount(1);
  expect(errors).toEqual([]);
});

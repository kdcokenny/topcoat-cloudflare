import assert from 'node:assert/strict';
import { test, expect, type Request } from '@playwright/test';

// Public demo routes only: no account resources, storage writes, or payments.
test('the home page, menu, and drink details render on the server', async ({ request }) => {
  for (const [path, text] of [
    ['/', 'Little Crema'],
    ['/menu', 'Cappuccino'],
    ['/menu/cappuccino', 'Equal parts espresso, steamed milk, and foam.'],
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect(await response.text()).toContain(text);
  }
});

test('CSS, JavaScript, fonts, and illustration are served with types and immutable caching', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:href|src)="(\/_topcoat\/assets\/[^"]+)"/g)].map((match) => match[1]),
    ),
  ];
  const types: Record<string, RegExp> = {
    css: /^text\/css/,
    js: /^(application|text)\/javascript/,
    woff2: /^font\/woff2/,
    svg: /^image\/svg\+xml/,
  };
  for (const extension of Object.keys(types)) {
    expect(
      assets.some((path) => path.endsWith(`.${extension}`)),
      extension,
    ).toBe(true);
  }
  for (const path of assets) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['cache-control']).toContain('immutable');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['content-type']).toMatch(types[path.split('.').at(-1)!]);
    expect((await response.body()).byteLength).toBeGreaterThan(0);
    const etag = response.headers().etag;
    expect(etag).toBeTruthy();
    const unchanged = await request.get(path, { headers: { 'if-none-match': etag } });
    expect(unchanged.status()).toBe(304);
    expect(await unchanged.body()).toHaveLength(0);
  }
  const fontCss = html.match(/href="(\/_topcoat\/fonts\/[^"]+\.css)"/)?.[1];
  assert.ok(fontCss);
  const fontResponse = await request.get(fontCss);
  expect(fontResponse.status()).toBe(200);
  expect(fontResponse.headers()['content-type']).toContain('text/css');
  expect(await fontResponse.text()).toContain('/_topcoat/assets/');
});

test('an unknown drink returns 404', async ({ request }) => {
  expect((await request.get('/menu/missing')).status()).toBe(404);
});

test('the menu streams its loading skeleton before the drinks', async ({ baseURL }) => {
  const response = await fetch(new URL('/menu', baseURL), {
    headers: { 'accept-encoding': 'identity' },
    signal: AbortSignal.timeout(10_000),
  });
  expect(response.status).toBe(200);
  let html = '',
    sawSkeletonBeforeDrinks = false;
  assert.ok(response.body);
  for await (const chunk of response.body) {
    html += Buffer.from(chunk).toString();
    if (html.includes('animate-pulse') && !html.includes('href="/menu/espresso"'))
      sawSkeletonBeforeDrinks = true;
  }
  expect(sawSkeletonBeforeDrinks).toBe(true);
  expect(html).toContain('href="/menu/espresso"');
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`the coffee-shop journey works at ${viewport.width}px without browser Wasm`, async ({
    page,
  }) => {
    const errors: string[] = [],
      failedRequests: string[] = [],
      requests: Request[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push(request.url()));
    page.on('request', (request) => requests.push(request));
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      for (const method of [
        'instantiate',
        'instantiateStreaming',
        'compile',
        'compileStreaming',
      ] as const) {
        WebAssembly[method] = () => {
          throw new Error('The demo must work without browser Wasm');
        };
      }
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Little Crema' })).toBeVisible();
    await expect(page.getByAltText('A cup of coffee')).toBeVisible();
    expect(
      await page
        .getByRole('heading', { name: 'Little Crema' })
        .evaluate((element) => getComputedStyle(element).fontSize),
    ).toBe('36px');
    await page.getByLabel('Your name').fill('Ada');
    await page.getByRole('button', { name: 'Remember me' }).click();
    await expect(page.getByText('Welcome back, Ada')).toBeVisible();
    const customer = (await page.context().cookies()).find((cookie) => cookie.name === 'customer');
    expect(customer).toMatchObject({ value: 'Ada', httpOnly: true, sameSite: 'Lax', path: '/' });
    await page.reload();
    await expect(page.getByText('Welcome back, Ada')).toBeVisible();
    await page.getByRole('link', { name: 'Browse the menu' }).click();
    const cards = page.locator('a[href^="/menu/"]');
    await expect(cards).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeDisabled();
    const search = page.getByPlaceholder('Search the menu...');
    await search.fill('  CAPP  ');
    await expect(cards).toHaveCount(1);
    await expect(page.locator('a[href="/menu/cappuccino"]')).toBeVisible();
    await search.fill('zzzz');
    await expect(
      page.getByText('Nothing matches. The barista suggests an espresso.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(cards).toHaveCount(6);
    await page.locator('a[href="/menu/cappuccino"]').click();
    await expect(page.getByRole('heading', { name: 'Cappuccino' })).toBeVisible();
    await page.getByRole('button', { name: '+', exact: true }).click();
    await expect(page.getByText('$10', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Order', exact: true }).click();
    await expect(page.getByText('Coming right up, Ada: 2 x Cappuccino.')).toBeVisible();
    await page.getByRole('button', { name: '-', exact: true }).click();
    await page.getByRole('button', { name: '-', exact: true }).click();
    await expect(page.getByText('$5', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('$5', { exact: true })).toBeVisible();
    await expect(page.getByText('Coming right up, Ada: 2 x Cappuccino.')).toHaveCount(0);
    await page.getByRole('link', { name: 'Little Crema', exact: true }).click();
    await page.getByRole('button', { name: 'Not Ada?' }).click();
    await expect(page.getByLabel('Your name')).toBeVisible();
    for (const feature of ['procedures', 'shards']) {
      expect(
        requests.some(
          (r) =>
            new URL(r.url()).pathname.includes(`/_topcoat/runtime/${feature}/`) &&
            r.method() === 'POST',
        ),
      ).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(requests.some((r) => new URL(r.url()).pathname.endsWith('.wasm'))).toBe(false);
    expect(errors).toEqual([]);
    expect(failedRequests).toEqual([]);
  });
}

test('server-rendered pages and customer forms work with JavaScript disabled', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    assert.ok(baseURL);
    await page.goto(baseURL);
    await expect(page.getByRole('heading', { name: 'Little Crema' })).toBeVisible();
    await page.getByLabel('Your name').fill('Ada');
    await page.getByRole('button', { name: 'Remember me' }).click();
    await expect(page.getByText('Welcome back, Ada')).toBeVisible();
    await page.goto(new URL('/menu/cappuccino', baseURL).href);
    await expect(page.getByRole('heading', { name: 'Cappuccino' })).toBeVisible();
    await expect(page.getByText('$5', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});

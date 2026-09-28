import assert from 'node:assert/strict';
import { chromium, expect, type Page, type Request } from '@playwright/test';

import { type quizApi } from './server.ts';

export async function answerQuiz(
  page: Page,
  correct: boolean,
  afterFirstQuestion?: () => Promise<void>,
) {
  const questionCount = 5;
  let shardRequests = 0;
  const countRender = (request: Request) => {
    if (new URL(request.url()).pathname.startsWith('/_topcoat/runtime/shards/')) shardRequests++;
  };
  page.on('request', countRender);
  await page.getByRole('link', { name: 'Start new quiz', exact: true }).click();
  for (let number = 1; number <= questionCount; number++) {
    await expect(
      page.getByRole('heading', { name: `Question ${number}: choose the answer` }),
    ).toBeVisible();
    const validate = page.getByRole('button', { name: 'Validate', exact: true });
    await expect(validate).toBeDisabled();
    const answer = page.getByLabel(correct ? `Correct ${number}` : `Wrong ${number} A`, {
      exact: true,
    });
    await answer.check();
    await validate.click();
    await expect(answer).toBeChecked();
    await expect(page.getByRole('radio', { disabled: true })).toHaveCount(4);
    await page
      .getByRole('button', {
        name: number === questionCount ? 'See results' : 'Next question',
        exact: true,
      })
      .click();
    if (number === 1 && afterFirstQuestion) {
      await expect(
        page.getByRole('heading', { name: 'Question 2: choose the answer' }),
      ).toBeVisible();
      await afterFirstQuestion();
    }
  }
  await expect(page.getByText('Quiz complete', { exact: true })).toBeVisible();
  await expect(page.getByText(correct ? '100%' : '0%', { exact: true })).toBeVisible();
  page.off('request', countRender);
  assert.equal(
    shardRequests,
    questionCount * 2,
    'Only validating and advancing each question render a shard',
  );
}

export async function resumeQuiz(baseURL: string, restart: () => Promise<string>) {
  const browser = await chromium.launch({
    executablePath: process.env.PROBE_CHROMIUM,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto('/');
    await answerQuiz(page, true, async () => {
      const destination = new URL(await restart());
      // Translate the local origin when forwarding to the fresh Worker on a new port.
      await page.route('**/_topcoat/runtime/shards/**', async (route) => {
        const { pathname, search } = new URL(route.request().url());
        const response = await route.fetch({
          url: new URL(pathname + search, destination).href,
          headers: {
            ...route.request().headers(),
            origin: destination.origin,
            host: destination.host,
          },
        });
        await route.fulfill({ response });
      });
    });
  } finally {
    await browser.close();
  }
}

export async function quizRequests(baseURL: string, api: Awaited<ReturnType<typeof quizApi>>) {
  const browser = await chromium.launch({
    executablePath: process.env.PROBE_CHROMIUM,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ baseURL });
    // Compression can buffer small chunks in Wrangler's local proxy.
    await page.setExtraHTTPHeaders({ 'accept-encoding': 'identity' });
    api.setDelay(1_500);
    await page.goto('/quiz', { waitUntil: 'commit' });
    await expect(page.getByLabel('Loading')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Question 1: choose the answer' }),
    ).toBeVisible();
    api.setDelay();
    await page.setExtraHTTPHeaders({});

    const requestPromise = page.waitForRequest((request) =>
      request.url().includes('/_topcoat/runtime/shards/'),
    );
    await page.getByLabel('Correct 1', { exact: true }).check();
    await page.getByRole('button', { name: 'Validate', exact: true }).click();
    const request = await requestPromise;
    const identity = request.headers()['x-topcoat-identity'];
    assert.ok(identity);
    const headers = { 'x-topcoat-identity': identity };
    const payload = request.postDataJSON() as {
      args: string[];
      signals: Record<string, boolean | { t: string; bits: number; v: string }>;
    };
    for (const questions of ['invalid-json', '[]', payload.args[0] + ' '.repeat(100_000)]) {
      const response = await page.request.post(request.url(), {
        headers,
        data: { ...payload, args: [questions] },
      });
      assert.equal(response.status(), 400, 'Malformed question data must be rejected');
    }
    for (const kind of ['usize', 'isize']) {
      const invalid = structuredClone(payload);
      for (const signal of Object.values(invalid.signals)) {
        if (typeof signal === 'object' && signal.t === kind) signal.v = '999';
      }
      const rejected = await page.request.post(request.url(), { headers, data: invalid });
      assert.equal(rejected.status(), 400, 'Out-of-range progress or selection must be rejected');
    }
    const valid = await page.request.post(request.url(), { headers, data: payload });
    assert.equal(valid.status(), 200, 'Valid shard requests still work after rejected input');
    assert.match(await valid.text(), /Question 1: choose the answer/);
    await expect(page.getByLabel('Correct 1', { exact: true })).toBeChecked();

    api.setMode('http-error');
    await page.goto('/quiz');
    await expect(page.getByText('Unable to load quiz', { exact: true })).toBeVisible();
    api.setMode('ok');
    await page.getByRole('link', { name: 'Try again', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Question 1: choose the answer' }),
    ).toBeVisible();
    return ['visible streaming fallback', 'bounded shard input', 'visible error and retry'];
  } finally {
    api.setMode('ok');
    api.setDelay();
    await browser.close();
  }
}

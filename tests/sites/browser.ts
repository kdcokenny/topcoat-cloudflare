import assert from 'node:assert/strict';
import { chromium, expect, type Page } from '@playwright/test';
import { join } from 'node:path';

import { output } from './process.ts';
import { familyJourney } from './f4y.ts';
import { answerQuiz } from './quiz.ts';

async function showcase(page: Page) {
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).not.toHaveClass('dark');
  await page.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(page.getByText('Enter a project name.', { exact: true })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Workers compatibility');
  await expect(page.locator('#project-name')).toHaveAttribute('aria-invalid', 'false');
  await page.getByLabel('Unchecked', { exact: true }).check();
  await expect(page.getByLabel('Unchecked', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Checked and disabled', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Open dialog', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Example dialog', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  await expect(page.getByText('Recent activity appears here.', { exact: true })).toBeVisible();
  await expect(
    page.getByText('A quick overview of your project.', { exact: true }),
  ).not.toBeVisible();
  await page.getByRole('button', { name: 'Open sheet', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Example sheet', exact: true });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).not.toBeVisible();
  const table = page.getByRole('table');
  await expect(table).toContainText('a1b2c3d');
  await page.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(table).toContainText('2e1d0c9');
  await expect(table).not.toContainText('a1b2c3d');
}

export async function journey(id: string, baseURL: string) {
  const browser = await chromium.launch({
    executablePath: process.env.PROBE_CHROMIUM,
    args: ['--no-sandbox'],
  });
  const checks: string[] = [];
  let cancelledShardRequests = 0;
  const layouts: { viewportWidth: number; documentWidth: number }[] = [];
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const errors: string[] = [];
      const requests: string[] = [];
      context.on('page', (page) => {
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('response', (response) => {
          if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
        });
        page.on('requestfailed', (request) => {
          const reason = request.failure()?.errorText;
          if (
            request.method() === 'POST' &&
            new URL(request.url()).pathname.startsWith('/_topcoat/runtime/shards/') &&
            reason === 'net::ERR_ABORTED'
          ) {
            // Topcoat cancels superseded renders; the journey checks the resulting UI.
            cancelledShardRequests++;
          } else errors.push(`${request.method()} ${request.url()}: ${reason}`);
        });
        page.on('request', (request) => requests.push(request.url()));
      });
      await context.addInitScript(() => {
        for (const key of [
          'compile',
          'compileStreaming',
          'instantiate',
          'instantiateStreaming',
        ] as const) {
          WebAssembly[key] = () => {
            throw new Error('Browser WebAssembly is disabled in this test');
          };
        }
      });
      const page = await context.newPage();
      try {
        await page.goto('/');
        if (id === 'quiz') {
          await answerQuiz(page, true);
          const other = await context.newPage();
          await other.goto('/');
          await answerQuiz(other, false);
          await expect(page.getByText('100%', { exact: true })).toBeVisible();
          await other.close();
          checks.push(`five-question flow, score, and independent quiz state at ${width}px`);
        } else if (id === 'showcase') {
          await showcase(page);
          assert.ok(requests.some((url) => url.includes('/_topcoat/runtime/shards/')));
          checks.push(
            `theme, form validation, checkboxes, tabs, dialog, sheet, and server pagination at ${width}px`,
          );
        } else if (id === 'f4y') {
          await familyJourney(page, `Browser family ${width}`);
          checks.push(`D1 CRUD, stale edits, active/deleted cursor pagination at ${width}px`);
        } else {
          await expect(
            page.getByRole('heading', { name: 'COLD FRONT', exact: true }),
          ).toBeVisible();
          await page.getByRole('link', { name: 'Open mission dossier', exact: true }).click();
          await expect(page).toHaveURL(/#briefing$/);
          await expect(page.locator('#briefing')).toBeInViewport();
          await expect(page.getByText('Channel not configured', { exact: true })).toBeVisible();
          checks.push(`component tree, CSS, navigation, and optional-auth fallback at ${width}px`);
        }
        await page.screenshot({ path: join(output, `${id}-${width}.png`), fullPage: true });
        const layout = {
          viewportWidth: width,
          documentWidth: await page.evaluate(() => document.documentElement.scrollWidth),
        };
        layouts.push(layout);
        if (id === 'showcase' || id === 'quiz') assert.equal(layout.documentWidth, width);
        assert.equal(
          requests.some((url) => new URL(url).pathname.endsWith('.wasm')),
          false,
        );
        assert.deepEqual(errors, []);
        await context.tracing.stop();
      } catch (error) {
        await context.tracing.stop({ path: join(output, `${id}-${width}-failure.zip`) });
        throw error;
      } finally {
        await context.close();
      }
    }
    const plain = await browser.newContext({ baseURL, javaScriptEnabled: false });
    try {
      const page = await plain.newPage();
      if (id === 'f4y') {
        await familyJourney(page, 'Family without JavaScript');
        checks.push('complete D1 form journey with JavaScript disabled');
      } else {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        checks.push('server-rendered home with JavaScript disabled');
      }
    } finally {
      await plain.close();
    }
    return { checks, layouts, cancelledShardRequests };
  } finally {
    await browser.close();
  }
}

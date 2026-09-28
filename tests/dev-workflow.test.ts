import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from '@playwright/test';

async function until(predicate: () => Promise<boolean>, description: string, timeout = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

await test(
  'dev rebuilds source and assets, retains a good build after errors, and shuts down',
  { timeout: 480_000 },
  async () => {
    const sourcePath = 'examples/starter/src/app.rs';
    const cssPath = 'examples/starter/styles.css';
    const originalSource = await readFile(sourcePath, 'utf8'),
      originalCss = await readFile(cssPath, 'utf8');
    await mkdir('artifacts', { recursive: true });
    const log = createWriteStream('artifacts/dev-workflow.log');
    let output = '';
    const child = spawn(
      'npm',
      [
        'run',
        'dev',
        '--',
        '--port',
        '18889',
        '--ip',
        '127.0.0.1',
        '--show-interactive-dev-session=false',
      ],
      {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      },
    );
    const observe = (data: Buffer) => {
      output += data;
      log.write(data);
    };
    child.stdout.on('data', observe);
    child.stderr.on('data', observe);
    const exited = new Promise((resolve) => child.once('exit', resolve));
    const html = async () => {
      try {
        return await (
          await fetch('http://127.0.0.1:18889', { signal: AbortSignal.timeout(5_000) })
        ).text();
      } catch {
        return '';
      }
    };
    let browser;
    try {
      await until(
        async () =>
          (await html()).includes(
            'Six drinks, one tiny counter, and a Topcoat feature in every pour.',
          ),
        'initial development server',
        240_000,
      );
      browser = await chromium.launch({
        executablePath: process.env.PROBE_CHROMIUM,
        args: ['--no-sandbox'],
      });
      const page = await browser.newPage();
      await page.goto('http://127.0.0.1:18889');
      await writeFile(
        sourcePath,
        originalSource.replace(
          'Six drinks, one tiny counter, and a Topcoat feature in every pour.',
          'Updated during development',
        ),
      );
      await until(
        async () => (await html()).includes('Updated during development'),
        'source rebuild',
      );
      await page.waitForFunction(
        () => document.body.textContent.includes('Updated during development'),
        null,
        { timeout: 120_000 },
      );
      const before = (await html()).match(/href="(\/_topcoat\/assets\/[^"]+\.css)"/)![1];
      await writeFile(cssPath, `${originalCss}\nbody { --rebuild-proof: 1; }\n`);
      await until(async () => {
        const match = (await html()).match(/href="(\/_topcoat\/assets\/[^"]+\.css)"/);
        return match !== null && match[1] !== before;
      }, 'content-hashed CSS rebuild');
      await page.waitForFunction(
        (previous) =>
          document
            .querySelector('link[href^="/_topcoat/assets/"][rel="stylesheet"]')
            ?.getAttribute('href') !== previous,
        before,
        { timeout: 120_000 },
      );
      const beforeRapidEdit = output.length;
      await writeFile(
        sourcePath,
        originalSource.replace(
          'Six drinks, one tiny counter, and a Topcoat feature in every pour.',
          'Superseded development edit',
        ),
      );
      await until(
        async () => output.slice(beforeRapidEdit).includes('Building topcoat-cloudflare-starter'),
        'rebuild before a second edit',
      );
      await writeFile(
        sourcePath,
        originalSource.replace(
          'Six drinks, one tiny counter, and a Topcoat feature in every pour.',
          'Latest development edit',
        ),
      );
      await until(
        async () => (await html()).includes('Latest development edit'),
        'latest edit after canceling an obsolete build',
      );
      await writeFile(sourcePath, 'this is deliberately invalid Rust');
      await until(async () => output.includes('topcoat-cloudflare:'), 'failed rebuild diagnostic');
      await until(
        async () => (await html()).includes('Latest development edit'),
        'last good build after compiler failure',
      );
      await writeFile(sourcePath, originalSource);
      await until(
        async () =>
          (await html()).includes(
            'Six drinks, one tiny counter, and a Topcoat feature in every pour.',
          ),
        'recovery after source correction',
      );
      // A terminal's Ctrl+C reaches the entire npm script process group.
      process.kill(-child.pid!, 'SIGINT');
      await until(
        async () => {
          try {
            await fetch('http://127.0.0.1:18889', { signal: AbortSignal.timeout(5_000) });
            return false;
          } catch {
            return true;
          }
        },
        'server shutdown after Ctrl+C',
        5000,
      );
      await writeFile(sourcePath, 'this is deliberately invalid Rust');
      const deployment = spawn('npm', ['run', 'deploy', '--', '--dry-run'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
      });
      let diagnostics = '';
      for (const stream of [deployment.stdout, deployment.stderr])
        stream.on('data', (data: Buffer) => {
          diagnostics += data;
        });
      const deploymentExit = await new Promise<number | null>((resolve, reject) => {
        deployment.on('error', reject);
        deployment.on('exit', resolve);
      });
      assert.notEqual(
        deploymentExit,
        0,
        'deployment must reject a compiler error even when previous output exists',
      );
      assert.match(diagnostics, /could not compile/);
    } finally {
      await browser?.close();
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {}
      await Promise.race([exited, sleep(5000)]);
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
      await writeFile(sourcePath, originalSource);
      await writeFile(cssPath, originalCss);
      log.end();
    }
  },
);

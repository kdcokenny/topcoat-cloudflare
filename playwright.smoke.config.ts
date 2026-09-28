import { defineConfig } from '@playwright/test';

const baseURL = process.env.TOPCOAT_SMOKE_URL ?? 'http://127.0.0.1:18890';

export default defineConfig({
  testDir: './tests/smoke',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'artifacts/smoke-results.json' }]],
  use: {
    baseURL,
    launchOptions: { executablePath: process.env.PROBE_CHROMIUM, args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.TOPCOAT_SMOKE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 18890 --ip 127.0.0.1 --show-interactive-dev-session=false',
        url: baseURL,
        reuseExistingServer: false,
        timeout: 600_000,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      },
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, validateConfig, type WorkerConfig } from '../src/config.ts';

const valid = (): WorkerConfig => ({
  build: { command: 'npm run build' },
  main: '.topcoat-cloudflare/dist/entry.ts',
  compatibility_date: '2026-09-27',
  compatibility_flags: ['enable_request_signal'],
  rules: [{ type: 'Text', globs: ['**/*.txt'] }],
  assets: {
    binding: 'ASSETS',
    directory: '.topcoat-cloudflare/dist/public',
    html_handling: 'none',
    not_found_handling: 'none',
    run_worker_first: ['/*', '!/_topcoat/assets/*'],
  },
});

await test('JSONC comments and trailing commas are accepted', () => {
  assert.deepEqual(parseConfig('{ // comment\n "name": "app", }', 'wrangler.jsonc'), {
    name: 'app',
  });
});

await test('TOML configuration is accepted', () => {
  const config = parseConfig('name = "app"\n[assets]\nhtml_handling = "none"', 'wrangler.toml');
  assert.equal(config.name, 'app');
  assert.equal(config.assets?.html_handling, 'none');
});

await test('malformed configuration has an actionable error', () => {
  assert.throws(() => parseConfig('{ name: ', 'wrangler.jsonc'), /wrangler.jsonc.*offset/);
});

await test('supported routing configuration is accepted', () => {
  assert.doesNotThrow(() => validateConfig(valid(), '/app', '/app/wrangler.jsonc'));
});

const invalid: [string, (config: WorkerConfig) => void, RegExp][] = [
  [
    'missing public assets binding',
    (c) => {
      delete c.assets!.binding;
    },
    /assets.binding/,
  ],
  [
    'missing private catalog module rule',
    (c) => {
      delete c.rules;
    },
    /Text module rule/,
  ],
  [
    'disabled request cancellation',
    (c) => {
      c.compatibility_flags = [];
    },
    /enable_request_signal/,
  ],
  [
    'wrong entrypoint',
    (c) => {
      c.main = 'build/index.js';
    },
    /main must point/,
  ],
  [
    'SPA fallback',
    (c) => {
      c.assets!.not_found_handling = 'single-page-application';
    },
    /Topcoat owns/,
  ],
  [
    'asset shadowing',
    (c) => {
      c.assets!.run_worker_first = false;
    },
    /run_worker_first/,
  ],
  [
    'missing build hook',
    (c) => {
      delete c.build;
    },
    /build.command/,
  ],
  [
    'environment output overrides',
    (c) => {
      c.env = { staging: { assets: {} } };
    },
    /Environment overrides/,
  ],
];
for (const [name, change, expected] of invalid) {
  await test(`rejects ${name}`, () => {
    const config = valid();
    change(config);
    assert.throws(() => validateConfig(config, '/app', '/app/wrangler.jsonc'), expected);
  });
}

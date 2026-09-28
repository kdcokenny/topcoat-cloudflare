import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init, type PackageJson } from '../src/init.ts';
import { parseConfig } from '../src/config.ts';

const release = {
  version: '0.1.0',
  workerBuildVersion: '0.8.7',
  wranglerVersion: '4.142.0',
  npmPackage: '@topcoat-cloudflare/adapter',
  compatibilityDate: '2026-09-27',
  toolchain: {
    channel: '1.98.1',
    targets: ['wasm32-unknown-unknown'],
    profile: 'minimal',
    components: [],
  },
  allowScripts: { 'workerd@1.20260926.1': true },
};

async function project(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'topcoat-init-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'Cargo.toml'), '[package]\nname = "existing_app"\nversion = "0.1.0"\n');
  return cwd;
}

await test('init is repeatable and preserves the application and its existing scripts', async (t) => {
  const cwd = await project(t);
  const cargo = await readFile(join(cwd, 'Cargo.toml'), 'utf8');
  await writeFile(
    join(cwd, 'package.json'),
    JSON.stringify({
      scripts: { dev: 'native-dev' },
      devDependencies: { '@topcoat-cloudflare/adapter': 'file:adapter.tgz' },
    }),
  );
  await init(cwd, release);
  const snapshot = await Promise.all(
    ['package.json', '.gitignore', 'wrangler.jsonc', 'rust-toolchain.toml'].map((file) =>
      readFile(join(cwd, file), 'utf8'),
    ),
  );
  await init(cwd, release);
  assert.deepEqual(
    await Promise.all(
      ['package.json', '.gitignore', 'wrangler.jsonc', 'rust-toolchain.toml'].map((file) =>
        readFile(join(cwd, file), 'utf8'),
      ),
    ),
    snapshot,
  );
  const pkg = JSON.parse(snapshot[0]) as PackageJson;
  assert.equal(pkg.scripts?.dev, 'native-dev');
  assert.equal(pkg.devDependencies?.['@topcoat-cloudflare/adapter'], 'file:adapter.tgz');
  assert.equal(await readFile(join(cwd, 'Cargo.toml'), 'utf8'), cargo);
  assert.equal(parseConfig(snapshot[2], 'wrangler.jsonc').name, 'existing-app');
});

await test('init rejects incompatible Wrangler configuration before changing any files', async (t) => {
  const cwd = await project(t);
  const original = '{ "name": "existing-worker", "main": "worker.js" }';
  await writeFile(join(cwd, 'wrangler.jsonc'), original);
  await assert.rejects(init(cwd, release), /main must point/);
  assert.deepEqual((await readdir(cwd)).sort(), ['Cargo.toml', 'wrangler.jsonc']);
  assert.equal(await readFile(join(cwd, 'wrangler.jsonc'), 'utf8'), original);
});

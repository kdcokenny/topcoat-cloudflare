import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePublic, promote, validateHeaderLimits, withBuildLock } from '../src/artifacts.ts';

async function directory(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'topcoat-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

await test('header rule and line limits fail before an incomplete deployment can be promoted', () => {
  const rule = '/asset\n  X-Test: value\n';
  assert.doesNotThrow(() => validateHeaderLimits(rule.repeat(100)));
  assert.throws(() => validateHeaderLimits(rule.repeat(101)), /101 rules.*100/);
  assert.doesNotThrow(() => validateHeaderLimits(`/${'a'.repeat(1999)}`));
  assert.throws(() => validateHeaderLimits(`/${'a'.repeat(2000)}`), /2,000-character/);
});

await test('a failed promotion restores the last complete deployment', async (t) => {
  const root = await directory(t),
    destination = join(root, 'dist');
  await mkdir(destination);
  await writeFile(join(destination, 'entry.ts'), 'previous application');
  await assert.rejects(promote(join(root, 'missing'), destination));
  assert.equal(await readFile(join(destination, 'entry.ts'), 'utf8'), 'previous application');
});

await test('a successful promotion replaces Worker and assets together', async (t) => {
  const root = await directory(t),
    destination = join(root, 'dist'),
    stage = join(root, 'next');
  await mkdir(destination);
  await mkdir(stage);
  await writeFile(join(destination, 'old.txt'), 'stale');
  await writeFile(join(stage, 'entry.ts'), 'new worker');
  await writeFile(join(stage, 'asset-manifest.txt'), 'matching catalog');
  await promote(stage, destination);
  assert.equal(await readFile(join(destination, 'asset-manifest.txt'), 'utf8'), 'matching catalog');
  await assert.rejects(readFile(join(destination, 'old.txt')), { code: 'ENOENT' });
});

await test('build lock prevents overlap and is released after a failure', async (t) => {
  const root = await directory(t);
  await assert.rejects(
    withBuildLock(root, async () => {
      await assert.rejects(
        withBuildLock(root, async () => {}),
        /Another build/,
      );
      throw new Error('build failed');
    }),
    /build failed/,
  );
  assert.equal(await withBuildLock(root, async () => 'recovered'), 'recovered');
});

await test('public files retain custom headers alongside generated asset headers', async (t) => {
  const root = await directory(t),
    source = join(root, 'source'),
    destination = join(root, 'public');
  await mkdir(source);
  await mkdir(destination);
  await writeFile(join(source, '_headers'), '/robots.txt\n  Cache-Control: no-cache\n');
  await writeFile(join(source, 'robots.txt'), 'User-agent: *');
  await writeFile(
    join(destination, '_headers'),
    '/_topcoat/assets/file.css\n  Content-Type: text/css\n',
  );
  await mergePublic(source, destination);
  const headers = await readFile(join(destination, '_headers'), 'utf8');
  assert.match(headers, /robots.txt/);
  assert.match(headers, /file.css/);
  assert.equal(await readFile(join(destination, 'robots.txt'), 'utf8'), 'User-agent: *');
});

await test('public files cannot shadow generated assets', async (t) => {
  const root = await directory(t),
    source = join(root, 'source');
  await mkdir(join(source, '_topcoat'), { recursive: true });
  await assert.rejects(mergePublic(source, join(root, 'public')), /reserved/);
});

await test('public symlinks cannot expose files outside the asset directory', async (t) => {
  const root = await directory(t),
    source = join(root, 'source'),
    destination = join(root, 'public');
  await mkdir(source);
  await mkdir(destination);
  await writeFile(join(destination, '_headers'), '');
  await writeFile(join(root, 'private.txt'), 'private fixture');
  await symlink(join(root, 'private.txt'), join(source, 'leak.txt'));
  await assert.rejects(mergePublic(source, destination), /regular files/);
});

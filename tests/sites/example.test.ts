import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { copyExample } from './example.ts';

await test('example copies preserve source edits and exclude local state from copies and hashes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'topcoat-example-'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    const source = join(root, 'example');
    await mkdir(source);
    await writeFile(join(source, '.gitignore'), '.wrangler/\nnode_modules/\n.dev.vars\n');
    await writeFile(join(source, 'app.rs'), 'original');
    execFileSync('git', ['add', 'example'], { cwd: root });
    await writeFile(join(source, 'app.rs'), 'edited');
    await writeFile(join(source, 'new.rs'), 'new source');
    await mkdir(join(source, '.wrangler'));
    await writeFile(join(source, '.wrangler', 'database'), 'demo records');
    await mkdir(join(source, 'node_modules'));
    await writeFile(join(source, 'node_modules', 'dependency'), 'installed');
    await writeFile(join(source, '.dev.vars'), 'local secret');

    const copy = join(root, 'copy');
    const before = await copyExample(source, copy);
    assert.deepEqual((await readdir(copy)).sort(), ['.gitignore', 'app.rs', 'new.rs']);
    assert.equal(await readFile(join(copy, 'app.rs'), 'utf8'), 'edited');
    await writeFile(join(copy, 'app.rs'), 'test edit');
    assert.equal(await readFile(join(source, 'app.rs'), 'utf8'), 'edited');
    await writeFile(join(source, '.wrangler', 'database'), 'more demo records');
    assert.equal(await copyExample(source, copy), before);
    await writeFile(join(source, 'app.rs'), 'another edit');
    assert.notEqual(await copyExample(source, copy), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

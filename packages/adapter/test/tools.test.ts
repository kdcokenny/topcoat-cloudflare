import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, delimiter } from 'node:path';
import { readRelease } from '../src/project.ts';

await test('build tool preparation', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'topcoat-tools-'));
  const bin = join(home, 'bin');
  await mkdir(bin);
  const previous = { ...process.env };
  process.env.CARGO_HOME = home;
  process.env.PATH = [bin, dirname(process.execPath)].join(delimiter);
  delete process.env.WORKER_BUILD_BIN;
  // process.ts resolves Cargo's bin directory when loaded; each test file runs in its own process.
  const { ensureBuildTools } = await import('../src/tools.ts');
  const release = await readRelease();
  const options = { cwd: home };
  const calls = join(home, 'calls');
  const ready = join(home, 'ready');
  const worker = join(bin, 'worker-build');

  t.after(async () => {
    process.env = previous;
    await rm(home, { recursive: true, force: true });
  });

  await writeFile(
    join(bin, 'rustup'),
    `#!/bin/sh
printf 'rustup %s\\n' "$*" >> "$CARGO_HOME/calls"
case "$1 $2" in
  '--version ') echo 'rustup test' ;;
  'toolchain list') [ ! -f "$CARGO_HOME/ready" ] || echo '${release.toolchain.channel}-test-host' ;;
  'component list') [ -f "$CARGO_HOME/missing-component" ] || printf '%s\\n' ${release.toolchain.components.join(' ')} ;;
  'target list') [ -f "$CARGO_HOME/missing-target" ] || printf '%s\\n' ${release.toolchain.targets.join(' ')} ;;
  'toolchain install') : > "$CARGO_HOME/ready" ;;
  *) exit 1 ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, 'cargo'),
    `#!/bin/sh
printf 'cargo %s\\n' "$*" >> "$CARGO_HOME/calls"
printf '#!/bin/sh\\necho ${release.workerBuildVersion}\\n' > "$CARGO_HOME/bin/worker-build"
/bin/chmod +x "$CARGO_HOME/bin/worker-build"
`,
    { mode: 0o755 },
  );

  await t.test('a cold build installs pinned tools and a warm build only checks them', async () => {
    const result = await ensureBuildTools(release, options);
    assert.deepEqual(result, { command: worker, version: release.workerBuildVersion });
    const cold = await readFile(calls, 'utf8');
    assert.ok(cold.includes(`rustup toolchain install ${release.toolchain.channel}`));
    assert.ok(cold.includes(`--target ${release.toolchain.targets[0]}`));
    assert.ok(
      cold.includes(
        `cargo +${release.toolchain.channel} install worker-build --version ${release.workerBuildVersion} --locked`,
      ),
    );
    await writeFile(calls, '');
    await ensureBuildTools(release, options);
    assert.doesNotMatch(await readFile(calls, 'utf8'), / install /);
  });

  await t.test('an installed toolchain receives missing components and targets', async () => {
    for (const missing of ['missing-component', 'missing-target']) {
      await writeFile(ready, '');
      await writeFile(join(home, missing), '');
      await writeFile(calls, '');
      try {
        await ensureBuildTools(release, options);
        assert.match(await readFile(calls, 'utf8'), /rustup toolchain install /);
      } finally {
        await rm(join(home, missing));
      }
    }
  });

  await t.test('a mismatched worker-build is replaced unless explicitly overridden', async () => {
    await writeFile(worker, '#!/bin/sh\necho 0.0.0\n', { mode: 0o755 });
    process.env.WORKER_BUILD_BIN = worker;
    await writeFile(calls, '');
    await assert.rejects(ensureBuildTools(release, options), /WORKER_BUILD_BIN must provide/);
    assert.doesNotMatch(await readFile(calls, 'utf8'), /cargo /);
    delete process.env.WORKER_BUILD_BIN;
    await ensureBuildTools(release, options);
    assert.match(await readFile(calls, 'utf8'), /cargo .* install worker-build /);
  });

  await t.test('tool preparation respects build cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      ensureBuildTools(release, { ...options, signal: controller.signal }),
      /aborted/,
    );
  });
});

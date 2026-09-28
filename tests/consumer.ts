import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

// This file is copied into the release artifact and runs in CI without actions/checkout.
const artifacts = process.argv[2]
  ? resolve(process.argv[2])
  : dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(await readFile(join(artifacts, 'artifacts.json'), 'utf8')) as {
  npm: string;
  npmPackage: string;
  runtime: string;
  version: string;
};
const fromRegistry = process.argv[3] === '--registry';
const root = await mkdtemp(join(tmpdir(), 'topcoat-consumer-'));
const app = join(root, 'app');
const runtime = join(root, 'runtime');
const port = 18891;
const baseURL = `http://127.0.0.1:${port}`;
const startupTimeout = 600_000;
let server: ChildProcess | undefined;
let exited: Promise<number | null> | undefined;

function run(command: string, args: string[], cwd = app, capture = false) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: join(root, 'target'),
        WRANGLER_SEND_METRICS: 'false',
      },
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    });
    let output = '';
    child.stdout?.on('data', (data) => {
      output += data;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} failed: ${code}`)),
    );
  });
}

try {
  if (process.env.TOPCOAT_CONSUMER_ISOLATED) {
    await assert.rejects(access(join(process.cwd(), '.git')));
    await assert.rejects(access(join(process.cwd(), 'crates')));
    console.log('Testing release artifacts without an adapter source checkout.');
  }
  await cp(join(artifacts, 'demo'), app, { recursive: true });
  if (!fromRegistry) {
    await mkdir(runtime);
    await run('tar', [
      '-xzf',
      join(artifacts, release.runtime),
      '--strip-components=1',
      '-C',
      runtime,
    ]);
    // Verify unpublished artifacts without resolving an older runtime from crates.io.
    await writeFile(
      join(app, 'Cargo.toml'),
      `\n[patch.crates-io]\ntopcoat-cloudflare = { path = "../runtime" }\n`,
      { flag: 'a' },
    );
  }
  const demoPackage = JSON.parse(await readFile(join(app, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify({ ...demoPackage, scripts: { existing: 'echo preserved' } }),
  );
  await run('npm', [
    'install',
    '--save-dev',
    fromRegistry ? `${release.npmPackage}@${release.version}` : join(artifacts, release.npm),
    '--ignore-scripts',
  ]);
  const adapter = join(app, 'node_modules', release.npmPackage, 'dist/bin/adapter.js');
  assert.ok(
    (await realpath(adapter)).startsWith(app + '/'),
    'adapter is installed, not workspace-linked',
  );
  await run(process.execPath, [adapter, 'setup']);
  const configured = JSON.parse(await readFile(join(app, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.deepEqual(configured.scripts, { existing: 'echo preserved' });
  await run('npm', ['ci']);
  await run('cargo', ['generate-lockfile']);
  const configuration = await Promise.all(
    ['package.json', 'wrangler.jsonc', 'rust-toolchain.toml'].map((file) =>
      readFile(join(app, file), 'utf8'),
    ),
  );
  await run('npx', ['--no-install', 'wrangler', 'deploy', '--dry-run']);
  assert.deepEqual(
    await Promise.all(
      ['package.json', 'wrangler.jsonc', 'rust-toolchain.toml'].map((file) =>
        readFile(join(app, file), 'utf8'),
      ),
    ),
    configuration,
    'build-time tool preparation does not reconfigure the application',
  );
  const output = join(app, '.topcoat-cloudflare/dist');
  const releaseBuild = JSON.parse(await readFile(join(output, 'build.json'), 'utf8')) as {
    profile: string;
  };
  assert.equal(releaseBuild.profile, 'release');
  assert.equal(
    await readFile(join(output, 'entry.ts'), 'utf8'),
    "export { default } from './application';\n",
  );
  const metadata = JSON.parse(
    await run('cargo', ['metadata', '--locked', '--format-version', '1'], app, true),
  ) as {
    packages: { source: string | null; manifest_path: string; name: string; version: string }[];
  };
  if (fromRegistry) {
    const runtime = metadata.packages.find((pkg) => pkg.name === 'topcoat-cloudflare');
    assert.equal(runtime?.version, release.version);
    assert.ok(runtime?.source?.startsWith('registry+'), 'runtime is installed from crates.io');
  }
  for (const dependency of metadata.packages.filter((pkg) => pkg.source === null))
    assert.ok(
      dependency.manifest_path.startsWith(root + '/'),
      `Local dependency escaped the consumer: ${dependency.name}`,
    );
  server = spawn(
    'npx',
    [
      '--no-install',
      'wrangler',
      'dev',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--show-interactive-dev-session=false',
    ],
    {
      cwd: app,
      detached: true,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: join(root, 'target'),
        WRANGLER_SEND_METRICS: 'false',
      },
      stdio: 'inherit',
    },
  );
  exited = new Promise((resolve) => server!.once('exit', resolve));
  const deadline = Date.now() + startupTimeout;
  while (true) {
    try {
      if ((await fetch(baseURL)).ok) break;
    } catch {}
    if (Date.now() > deadline || server.exitCode !== null)
      throw new Error('Packaged application did not start.');
    await sleep(250);
  }
  const devBuild = JSON.parse(await readFile(join(output, 'build.json'), 'utf8')) as {
    profile: string;
  };
  assert.equal(devBuild.profile, 'dev');
  for (const [path, content] of [
    ['/', 'Little Crema'],
    ['/menu', 'Cappuccino'],
    ['/menu/cappuccino', 'Cappuccino'],
  ]) {
    const response = await fetch(baseURL + path);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(content));
  }
  const html = await (await fetch(baseURL)).text();
  const stylesheet = html.match(/href="(\/_topcoat\/assets\/[^"]+\.css)"/)?.[1];
  assert.ok(stylesheet, 'packaged app resolves generated assets');
  assert.equal((await fetch(baseURL + stylesheet)).status, 200);
  const drink = await (await fetch(baseURL + '/menu/cappuccino')).text();
  const procedure = drink.match(/\/_topcoat\/runtime\/procedures\/[a-f0-9]+/)?.[0];
  assert.ok(procedure);
  const order = await fetch(baseURL + procedure, {
    method: 'POST',
    headers: { origin: baseURL, 'content-type': 'application/json' },
    body: JSON.stringify(['Cappuccino', 2]),
  });
  assert.equal(order.status, 200);
  assert.equal(await order.json(), 'Coming right up: 2 x Cappuccino.');
  console.log(
    `Consumer installation passed (${fromRegistry ? 'public registries' : 'release artifacts'}): setup, Wrangler release build, dry run, development build, pages, assets, and procedure.`,
  );
} finally {
  if (server) {
    try {
      process.kill(-server.pid!, 'SIGTERM');
    } catch {}
    await Promise.race([exited, sleep(5_000, undefined, { ref: false })]);
    try {
      process.kill(-server.pid!, 'SIGKILL');
    } catch {}
  }
  await rm(root, { recursive: true, force: true });
}

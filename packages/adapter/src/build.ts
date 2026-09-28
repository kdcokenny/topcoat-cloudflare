import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { errorMessage } from './errors.ts';
import { loadConfig, outputDirectory } from './config.ts';
import { mergePublic, promote, validateHeaderLimits, withBuildLock } from './artifacts.ts';
import { packageRoot, readRelease, wasmTarget } from './project.ts';
import { run, rustTool } from './process.ts';
import { ensureBuildTools } from './tools.ts';

export async function build({ cwd, signal }: { cwd: string; signal?: AbortSignal }) {
  await loadConfig(cwd);
  const dev = process.env.WRANGLER_COMMAND === 'dev';
  const root = join(cwd, '.topcoat-cloudflare');
  await withBuildLock(root, async () => {
    try {
      await compile(cwd, root, dev, signal);
    } catch (error) {
      if (!dev || signal?.aborted) throw error;
      const previous = await readFile(join(cwd, outputDirectory, 'build.json'), 'utf8').catch(
        () => undefined,
      );
      const metadata = previous ? (JSON.parse(previous) as { profile: string }) : undefined;
      if (metadata?.profile !== 'dev') throw error;
      // Wrangler waits for a successful build before resuming requests to its local Worker.
      console.error(
        `topcoat-cloudflare: ${errorMessage(error)}\nBuild failed. Serving the previous development build.`,
      );
    }
  });
}

async function compile(cwd: string, root: string, dev: boolean, signal?: AbortSignal) {
  const { command: workerBuild, version } = await ensureBuildTools(await readRelease(), {
    cwd,
    signal,
  });
  const stage = join(root, 'next');
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });
  const { metadata, pkg, target } = await projectMetadata(cwd, signal);
  console.log(`Building ${pkg.name} (${dev ? 'development' : 'release'})…`);
  await run(
    workerBuild,
    [dev ? '--dev' : '--release', '--out-dir', join(stage, 'worker'), '--', '--locked'],
    { cwd, signal },
  );
  const rawWasm = join(
    metadata.target_directory,
    wasmTarget,
    dev ? 'debug' : 'release',
    `${target.name.replaceAll('-', '_')}.wasm`,
  );
  await run(
    await rustTool('cargo'),
    [
      'run',
      '--locked',
      '--manifest-path',
      join(packageRoot, 'native/Cargo.toml'),
      '--target-dir',
      join(metadata.target_directory, 'topcoat-cloudflare-tools'),
      '--',
      rawWasm,
      stage,
      join(root, 'cache'),
    ],
    { cwd, signal },
  );
  const publicFiles = await mergePublic(join(cwd, 'public'), join(stage, 'public'));
  validateHeaderLimits(await readFile(join(stage, 'public/_headers'), 'utf8'));
  const entry = await readFile(join(packageRoot, 'templates/entry.ts'), 'utf8');
  await writeFile(
    join(stage, 'application.ts'),
    entry.replace('/* PUBLIC_FILES */ []', JSON.stringify(publicFiles)),
  );
  if (dev) {
    const entry = await readFile(join(packageRoot, 'templates/development.ts'), 'utf8');
    await writeFile(join(stage, 'entry.ts'), entry.replace("'./entry.ts'", "'./application'"));
  } else await writeFile(join(stage, 'entry.ts'), "export { default } from './application';\n");
  const sha256 = async (path: string) =>
    createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  await writeFile(
    join(stage, 'build.json'),
    JSON.stringify(
      {
        schema: 1,
        package: pkg.name,
        profile: dev ? 'dev' : 'release',
        workerBuild: version,
        wasmSha256: await sha256(join(stage, 'worker/index_bg.wasm')),
        catalogSha256: await sha256(join(stage, 'asset-manifest.txt')),
      },
      null,
      2,
    ),
  );
  signal?.throwIfAborted();
  await promote(stage, join(cwd, outputDirectory));
  console.log(`Ready: ${relative(cwd, join(cwd, outputDirectory))}`);
}

async function projectMetadata(cwd: string, signal?: AbortSignal) {
  const cargo = await rustTool('cargo');
  const metadata = JSON.parse(
    await run(
      cargo,
      [
        'metadata',
        '--locked',
        '--no-deps',
        '--format-version',
        '1',
        '--manifest-path',
        join(cwd, 'Cargo.toml'),
      ],
      { cwd, capture: true, signal },
    ),
  ) as CargoMetadata;
  const pkg = metadata.packages.find(
    (pkg) => resolve(pkg.manifest_path) === resolve(cwd, 'Cargo.toml'),
  );
  const targets = pkg?.targets.filter((target) => target.crate_types.includes('cdylib')) ?? [];
  if (!pkg || targets.length !== 1)
    throw new Error(
      'The application Cargo.toml must define one [lib] with crate-type = ["cdylib"].',
    );
  return { metadata, pkg, target: targets[0] };
}

interface CargoMetadata {
  target_directory: string;
  packages: {
    name: string;
    manifest_path: string;
    targets: { name: string; crate_types: string[] }[];
  }[];
}

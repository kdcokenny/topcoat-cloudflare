import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, rustTool } from './process.ts';
import { hasCode } from './errors.ts';
import type { Release, Toolchain } from './project.ts';

const DOWNLOAD_TIMEOUT_MS = 30_000;

interface ToolOptions {
  cwd: string;
  signal?: AbortSignal;
}

export async function ensureRustToolchain(toolchain: Toolchain, options: ToolOptions) {
  options.signal?.throwIfAborted();
  try {
    await run(await rustTool('rustup'), ['--version'], { ...options, capture: true });
  } catch (error) {
    if (!(error instanceof Error) || !hasCode(error.cause, 'ENOENT')) throw error;
    console.log('Installing rustup from https://sh.rustup.rs…');
    const temporary = await mkdtemp(join(tmpdir(), 'topcoat-rustup-'));
    try {
      const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
      const response = await fetch('https://sh.rustup.rs', {
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
      });
      if (!response.ok) throw new Error(`Rustup download failed: HTTP ${response.status}`);
      const installer = join(temporary, 'rustup-init.sh');
      await writeFile(installer, await response.text());
      await run(
        'sh',
        [
          installer,
          '-y',
          '--profile',
          'minimal',
          '--default-toolchain',
          'none',
          '--no-modify-path',
        ],
        options,
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }

  const rustup = await rustTool('rustup');
  const installed = (await run(rustup, ['toolchain', 'list'], { ...options, capture: true }))
    .split('\n')
    .some(
      (line) =>
        line.startsWith(`${toolchain.channel}-`) || line.split(' ')[0] === toolchain.channel,
    );
  if (installed) {
    const components = await run(
      rustup,
      ['component', 'list', '--installed', '--toolchain', toolchain.channel],
      { ...options, capture: true },
    );
    const targets = await run(
      rustup,
      ['target', 'list', '--installed', '--toolchain', toolchain.channel],
      { ...options, capture: true },
    );
    if (
      toolchain.components.every((component) =>
        components
          .split('\n')
          .some((line) => line === component || line.startsWith(`${component}-`)),
      ) &&
      toolchain.targets.every((target) => targets.split('\n').includes(target))
    )
      return;
  }

  console.log(`Preparing Rust ${toolchain.channel}…`);
  await run(
    rustup,
    [
      'toolchain',
      'install',
      toolchain.channel,
      '--profile',
      toolchain.profile,
      ...toolchain.components.flatMap((component) => ['--component', component]),
      ...toolchain.targets.flatMap((target) => ['--target', target]),
    ],
    options,
  );
}

export async function ensureBuildTools(
  { toolchain, workerBuildVersion }: Pick<Release, 'toolchain' | 'workerBuildVersion'>,
  options: ToolOptions,
) {
  await ensureRustToolchain(toolchain, options);
  let command = process.env.WORKER_BUILD_BIN ?? (await rustTool('worker-build'));
  let installedVersion;
  try {
    installedVersion = (await run(command, ['--version'], { ...options, capture: true })).trim();
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !hasCode(error.cause, 'ENOENT') ||
      process.env.WORKER_BUILD_BIN
    )
      throw error;
  }
  if (installedVersion !== workerBuildVersion) {
    if (process.env.WORKER_BUILD_BIN) {
      throw new Error(
        `WORKER_BUILD_BIN must provide worker-build ${workerBuildVersion}, found ${installedVersion}.`,
      );
    }
    console.log(`Installing worker-build ${workerBuildVersion} from source…`);
    if (process.platform === 'linux') {
      console.log(
        'Requires C/C++, pkg-config, and OpenSSL headers. Ubuntu/Debian: sudo apt-get install build-essential pkg-config libssl-dev',
      );
    }
    await run(
      await rustTool('cargo'),
      [
        `+${toolchain.channel}`,
        'install',
        'worker-build',
        '--version',
        workerBuildVersion,
        '--locked',
      ],
      options,
    );
    command = await rustTool('worker-build');
    installedVersion = (await run(command, ['--version'], { ...options, capture: true })).trim();
  }
  if (installedVersion !== workerBuildVersion)
    throw new Error(`Expected worker-build ${workerBuildVersion}, found ${installedVersion}.`);
  return { command, version: installedVersion };
}

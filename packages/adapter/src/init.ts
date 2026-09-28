import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { Release } from './project.ts';
import { hasCode } from './errors.ts';
import { buildCommand, watchPaths, loadConfig } from './config.ts';

export interface PackageJson {
  [key: string]: unknown;
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  allowScripts?: Record<string, boolean>;
}

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw error;
  }
}

export async function init(cwd: string, release: Release) {
  const cargo = parse(await readFile(join(cwd, 'Cargo.toml'), 'utf8')) as {
    package?: { name?: string };
  };
  if (!cargo.package?.name)
    throw new Error('Run setup in an application crate, not a Cargo workspace root.');
  const name = cargo.package.name.replaceAll('_', '-');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    throw new Error('Use a lowercase Cargo package name for the Worker.');
  const packagePath = join(cwd, 'package.json');
  const pkg: PackageJson = (await exists(packagePath))
    ? (JSON.parse(await readFile(packagePath, 'utf8')) as PackageJson)
    : { private: true };
  const existingConfig = (
    await Promise.all(
      ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].map(async (file) =>
        (await exists(join(cwd, file))) ? file : undefined,
      ),
    )
  ).find(Boolean);
  if (existingConfig) await loadConfig(cwd, existingConfig);
  const configPath = join(cwd, 'wrangler.jsonc');
  const toolchainPath = join(cwd, 'rust-toolchain.toml');
  const ignorePath = join(cwd, '.gitignore');
  const ignore = (await exists(ignorePath)) ? await readFile(ignorePath, 'utf8') : '';
  const additions = [
    'node_modules/',
    'target/',
    '.topcoat-cloudflare/',
    '.wrangler/',
    '.dev.vars*',
  ].filter((line) => !ignore.split(/\r?\n/).includes(line));
  pkg.devDependencies ??= {};
  pkg.devDependencies[release.npmPackage] ??= release.version;
  pkg.devDependencies.wrangler ??= release.wranglerVersion;
  pkg.allowScripts = { ...release.allowScripts, ...pkg.allowScripts };

  // Validate conflicts before writing. Application source and Cargo dependencies stay user-owned.
  if (!existingConfig) {
    await writeFile(
      configPath,
      JSON.stringify(
        {
          name,
          main: '.topcoat-cloudflare/dist/entry.ts',
          build: { command: buildCommand, cwd: '.', watch_dir: watchPaths },
          compatibility_date: release.compatibilityDate,
          compatibility_flags: ['enable_request_signal'],
          assets: {
            directory: '.topcoat-cloudflare/dist/public',
            binding: 'ASSETS',
            html_handling: 'none',
            not_found_handling: 'none',
            run_worker_first: ['/*', '!/_topcoat/assets/*'],
          },
          rules: [{ type: 'Text', globs: ['**/*.txt'], fallthrough: true }],
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx' },
    );
  }
  if (!(await exists(toolchainPath)))
    await writeFile(toolchainPath, stringify({ toolchain: release.toolchain }), { flag: 'wx' });
  await writeFile(packagePath, JSON.stringify(pkg, null, 2) + '\n');
  if (additions.length)
    await writeFile(
      ignorePath,
      ignore + (ignore && !ignore.endsWith('\n') ? '\n' : '') + additions.join('\n') + '\n',
    );
}

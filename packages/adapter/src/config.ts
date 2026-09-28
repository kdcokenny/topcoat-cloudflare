import { readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, relative } from 'node:path';
import { parse as jsonc, printParseErrorCode } from 'jsonc-parser';
import { hasCode } from './errors.ts';
import type { ParseError } from 'jsonc-parser';
import { parse as toml } from 'smol-toml';

export const buildCommand = 'npx --no-install topcoat-cloudflare build';
export const watchPaths = [
  'src',
  'assets',
  'public',
  'Cargo.toml',
  'Cargo.lock',
  'build.rs',
  'styles.css',
  'components.toml',
  'rust-toolchain.toml',
];

export const outputDirectory = '.topcoat-cloudflare/dist';

export function parseConfig(text: string, filename: string): WorkerConfig {
  if (extname(filename) === '.toml') return toml(text) as WorkerConfig;
  const errors: ParseError[] = [];
  const config: unknown = jsonc(text, errors, { allowTrailingComma: true });
  if (errors.length)
    throw new Error(
      `${filename}: ${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}.`,
    );
  if (!config || typeof config !== 'object' || Array.isArray(config))
    throw new Error(`${filename}: expected a configuration object.`);
  return config;
}

export async function loadConfig(cwd: string, filename?: string) {
  if (!filename) {
    for (const candidate of ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml']) {
      try {
        await stat(resolve(cwd, candidate));
        filename = candidate;
        break;
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
    }
  }
  if (!filename)
    throw new Error('No Wrangler configuration found. Run npx topcoat-cloudflare setup.');
  const path = resolve(cwd, filename);
  const config = parseConfig(await readFile(path, 'utf8'), path);
  validateConfig(config, cwd, path);
  return { path, config };
}

export function validateConfig(config: WorkerConfig, cwd: string, path: string) {
  const base = dirname(path);
  const requiredPath = (actual: unknown, expected: string, label: string) => {
    if (
      typeof actual !== 'string' ||
      resolve(base, actual) !== resolve(cwd, outputDirectory, expected)
    ) {
      throw new Error(
        `${label} must point to ${relative(base, resolve(cwd, outputDirectory, expected))}.`,
      );
    }
  };
  requiredPath(config.main, 'entry.ts', 'main');
  requiredPath(config.assets?.directory, 'public', 'assets.directory');
  if (config.assets?.binding !== 'ASSETS')
    throw new Error('Set assets.binding to "ASSETS" to serve public files.');
  if (
    !config.rules?.some(
      (rule) =>
        rule.type === 'Text' &&
        rule.globs?.some((glob) => ['**/*.txt', '**/asset-manifest.txt'].includes(glob)),
    )
  ) {
    throw new Error(
      'Add a Text module rule for **/*.txt so the private asset catalog can be imported.',
    );
  }
  if (!config.compatibility_date)
    throw new Error('Set an explicit compatibility_date in Wrangler configuration.');
  if (!config.compatibility_flags?.includes('enable_request_signal')) {
    throw new Error(
      'Add enable_request_signal to compatibility_flags so client disconnects cancel streamed renders.',
    );
  }
  if (config.assets?.html_handling !== 'none' || config.assets?.not_found_handling !== 'none') {
    throw new Error(
      'Set assets.html_handling and assets.not_found_handling to "none" so Topcoat owns application URLs.',
    );
  }
  const routes = config.assets?.run_worker_first;
  if (JSON.stringify(routes) !== JSON.stringify(['/*', '!/_topcoat/assets/*'])) {
    throw new Error('Set assets.run_worker_first to ["/*", "!/_topcoat/assets/*"].');
  }
  if (!config.build?.command)
    throw new Error(`Set build.command to ${buildCommand} so Wrangler builds the application.`);
  for (const environment of Object.values(config.env ?? {})) {
    for (const key of ['main', 'assets', 'build'] as const) {
      if (environment[key] !== undefined)
        throw new Error(
          `Environment overrides for ${key} are unsupported. Keep build paths and asset routing at the top level.`,
        );
    }
  }
}

export interface WorkerConfig {
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  rules?: { type: string; globs?: string[] }[];
  build?: { command?: string; cwd?: string; watch_dir?: string | string[] };
  assets?: {
    binding?: string;
    directory?: string;
    html_handling?: string;
    not_found_handling?: string;
    run_worker_first?: boolean | string[];
  };
  env?: Record<string, WorkerConfig>;
}

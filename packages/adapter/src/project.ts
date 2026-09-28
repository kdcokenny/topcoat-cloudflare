import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const packageRoot = dirname(
  createRequire(import.meta.url).resolve('@topcoat-cloudflare/adapter/package.json'),
);
export const wasmTarget = 'wasm32-unknown-unknown';

export async function readRelease(): Promise<Release> {
  try {
    return JSON.parse(await readFile(join(packageRoot, 'release.json'), 'utf8')) as Release;
  } catch (error) {
    throw new Error(
      'Adapter package is incomplete. Reinstall it; contributors should run npm ci.',
      { cause: error },
    );
  }
}

export interface Toolchain {
  channel: string;
  profile: string;
  components: string[];
  targets: string[];
}

export interface Release {
  version: string;
  npmPackage: string;
  allowScripts: Record<string, boolean>;
  toolchain: Toolchain;
  workerBuildVersion: string;
  wranglerVersion: string;
  compatibilityDate: string;
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

import type { Toolchain } from '../packages/adapter/src/project.ts';

interface Dependency {
  version: string;
  features?: string[];
  'default-features'?: boolean;
}
interface CargoWorkspace {
  workspace: {
    package: {
      [key: string]: string;
      version: string;
      edition: string;
      'rust-version': string;
      license: string;
      repository: string;
    };
    dependencies: Record<string, string | Dependency> & { worker: Dependency; topcoat: Dependency };
    lints: Record<string, Record<string, string>>;
  };
  profile: Record<string, Record<string, string | number | boolean>>;
}

export const repository = fileURLToPath(new URL('../', import.meta.url));
export const cargo = parse(
  readFileSync(new URL('../Cargo.toml', import.meta.url), 'utf8'),
) as unknown as CargoWorkspace;
export const workerBuildVersion = cargo.workspace.dependencies.worker.version.replace(/^=/, '');
export const { toolchain } = parse(
  readFileSync(new URL('../rust-toolchain.toml', import.meta.url), 'utf8'),
) as unknown as { toolchain: Toolchain };

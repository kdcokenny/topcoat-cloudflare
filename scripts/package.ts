import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify, type TomlTable } from 'smol-toml';
import { cargo, repository } from './project.ts';
import { run, rustTool } from '../packages/adapter/src/process.ts';
import demoPackage from '../examples/starter/package.json' with { type: 'json' };

const destination = join(repository, 'artifacts/release');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await run(process.execPath, ['scripts/prepare-adapter.ts'], { cwd: repository });
await run(
  await rustTool('cargo'),
  ['package', '-p', 'topcoat-cloudflare', '--locked', '--allow-dirty'],
  { cwd: repository },
);
const version = cargo.workspace.package.version;
const runtime = `topcoat-cloudflare-${version}.crate`;
await cp(join(repository, 'target/package', runtime), join(destination, runtime));
interface PackedPackage {
  name: string;
  filename: string;
  files: { path: string }[];
}
const [npm] = Object.values(
  JSON.parse(
    await run(
      'npm',
      [
        'pack',
        '--workspace',
        'packages/adapter',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        destination,
      ],
      { cwd: repository, capture: true },
    ),
  ) as Record<string, PackedPackage>,
);
if (npm.files.some(({ path }) => /^(test|examples|scripts)\//.test(path)))
  throw new Error('Contributor files leaked into the npm package.');
for (const required of [
  'native/Cargo.lock',
  'native/src/main.rs',
  'release.json',
  'dist/bin/adapter.js',
  'templates/entry.ts',
  'README.md',
  'LICENSE',
]) {
  if (!npm.files.some(({ path }) => path === required))
    throw new Error(`Missing package file: ${required}`);
}

// Exercise the real demo as an independent consumer with ordinary Cargo dependencies.
const demo = join(destination, 'demo');
await mkdir(demo);
for (const file of ['src', 'build.rs', 'styles.css', 'components.toml', 'LICENSE.topcoat'])
  await cp(join(repository, 'examples/starter', file), join(demo, file), { recursive: true });
const manifest = parse(
  await readFile(join(repository, 'examples/starter/Cargo.toml'), 'utf8'),
) as TomlTable & {
  package: Record<string, string | { workspace: boolean }>;
  dependencies: Record<string, string | { workspace?: boolean; version?: string }>;
  'build-dependencies': Record<string, string | { workspace?: boolean; version?: string }>;
};
for (const [name, value] of Object.entries(manifest.package))
  if (typeof value === 'object' && value.workspace)
    manifest.package[name] = cargo.workspace.package[name];
for (const section of ['dependencies', 'build-dependencies'] as const) {
  for (const [name, value] of Object.entries(manifest[section] ?? {})) {
    if (typeof value === 'object' && value.workspace) {
      const inherited = cargo.workspace.dependencies[name];
      const settings = typeof inherited === 'string' ? { version: inherited } : inherited;
      manifest[section][name] = { ...settings, ...value };
      delete (manifest[section][name] as { workspace?: boolean }).workspace;
    }
  }
}
manifest.dependencies['topcoat-cloudflare'] = { version: `=${version}` };
manifest.lints = cargo.workspace.lints;
manifest.profile = cargo.profile;
await writeFile(join(demo, 'Cargo.toml'), stringify(manifest));
const devDependencies: Record<string, string> = { ...demoPackage.devDependencies };
delete devDependencies['@topcoat-cloudflare/adapter'];
await writeFile(
  join(demo, 'package.json'),
  JSON.stringify({ private: true, devDependencies }, null, 2) + '\n',
);
await cp(join(repository, 'tests/consumer.ts'), join(destination, 'consumer.ts'));
await writeFile(
  join(destination, 'artifacts.json'),
  JSON.stringify({ npm: npm.filename, npmPackage: npm.name, runtime, version }, null, 2) + '\n',
);
console.log(`Release artifacts: ${destination}`);

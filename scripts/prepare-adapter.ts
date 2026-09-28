import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cargo, repository, toolchain, workerBuildVersion } from './project.ts';
import { run, rustTool } from '../packages/adapter/src/process.ts';
import { parseConfig } from '../packages/adapter/src/config.ts';
import { ensureRustToolchain } from '../packages/adapter/src/tools.ts';
import pkg from '../packages/adapter/package.json' with { type: 'json' };
import workspace from '../package.json' with { type: 'json' };

const adapter = join(repository, 'packages/adapter');
const version = cargo.workspace.package.version;
if (pkg.version !== version) throw new Error('The npm and Rust adapter versions must match.');
await rm(join(adapter, 'dist'), { recursive: true, force: true });
await run('npx', ['--no-install', 'tsc', '--project', 'packages/adapter/tsconfig.build.json'], {
  cwd: repository,
});
await chmod(join(adapter, 'dist/bin/adapter.js'), 0o755);
await ensureRustToolchain(toolchain, { cwd: repository });
await run(
  await rustTool('cargo'),
  ['package', '-p', 'topcoat-cloudflare-build', '--locked', '--allow-dirty', '--no-verify'],
  { cwd: repository },
);
const native = join(adapter, 'native');
await rm(native, { recursive: true, force: true });
await mkdir(native, { recursive: true });
await run('tar', [
  '-xzf',
  join(repository, `target/package/topcoat-cloudflare-build-${version}.crate`),
  '--strip-components=1',
  '-C',
  native,
]);
// An installed package may sit inside the consumer's Cargo workspace.
await writeFile(join(native, 'Cargo.toml'), '\n[workspace]\n', { flag: 'a' });
const config = parseConfig(
  await readFile(join(repository, 'examples/starter/wrangler.jsonc'), 'utf8'),
  'wrangler.jsonc',
);
await writeFile(
  join(adapter, 'release.json'),
  JSON.stringify(
    {
      version,
      npmPackage: pkg.name,
      allowScripts: workspace.allowScripts,
      toolchain,
      workerBuildVersion,
      wranglerVersion: pkg.peerDependencies.wrangler,
      compatibilityDate: config.compatibility_date,
    },
    null,
    2,
  ) + '\n',
);
await cp(join(repository, 'LICENSE'), join(adapter, 'LICENSE'));
console.log(`Prepared standalone adapter ${version}.`);

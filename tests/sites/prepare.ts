import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, stringify, type TomlTable } from 'smol-toml';

import { cargo, repository } from '../../scripts/project.ts';
import { checked, output } from './process.ts';
import { copyExample } from './example.ts';
import type { Site } from './sources.ts';

async function replace(path: string, before: string, after: string) {
  const source = await readFile(path, 'utf8');
  assert.equal(source.split(before).length, 2, `Expected one matching source fragment in ${path}`);
  await writeFile(path, source.replace(before, after));
}

async function manifest(path: string, edit: (value: TomlTable) => void) {
  const value = parse(await readFile(path, 'utf8'));
  edit(value);
  await writeFile(path, stringify(value));
}

async function migrateViews(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await migrateViews(path);
    else if (entry.name.endsWith('.rs')) {
      const source = await readFile(path, 'utf8');
      await writeFile(
        path,
        source
          .replaceAll('-> Result {', '-> Result<impl topcoat::view::View> {')
          .replaceAll('(slot.await?)', '(slot)')
          .replace(/    view! \{([\s\S]*?)\n    }\n}/g, '    Ok(view! {$1\n    })\n}')
          .replace('    view! { landing_shell() }', '    Ok(view! { landing_shell() })'),
      );
    }
  }
}

export async function checkout(site: Site) {
  const source = join(output, 'sources', site.id);
  const log = join(output, 'logs', `${site.id}-source.log`);
  if (
    !(await access(join(source, '.git')).then(
      () => true,
      () => false,
    ))
  ) {
    await mkdir(source, { recursive: true });
    await checked('git', ['init', '--quiet'], source, log);
    await checked(
      'git',
      ['fetch', '--depth=1', `https://github.com/${site.repository}.git`, site.revision],
      source,
      log,
    );
    await checked('git', ['checkout', '--detach', site.revision], source, log);
  }
  // git diff also catches accidental edits in a cached upstream checkout.
  await checked('git', ['diff', '--exit-code', site.revision], source, log);
  return source;
}

export async function prepare(site: Site) {
  const root = join(output, 'apps', site.id);
  await rm(root, { recursive: true, force: true });
  if (site.example) {
    const sourceSha256 = await copyExample(join(repository, site.example), root);
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    assert.equal(
      manifest.devDependencies['@topcoat-cloudflare/adapter'],
      cargo.workspace.package.version,
      'Update the example dependencies before benchmarking a new adapter release',
    );
    await checked('npm', ['ci'], root, join(output, 'logs', `${site.id}-build.log`));
    return { app: root, sourceSha256 };
  }
  const source = await checkout(site);
  await cp(source, root, { recursive: true, filter: (path) => !path.includes('/.git') });
  const app = join(root, site.directory);
  assert.equal(site.id, 'coldfront');
  const topcoat = {
    version: cargo.workspace.dependencies.topcoat.version,
    'default-features': false,
    features: ['router', 'view', 'asset', 'runtime', 'discover'],
  };
  await manifest(join(root, 'Cargo.toml'), (value) => {
    const workspace = value.workspace as TomlTable;
    workspace.members = [site.directory, 'crates/coldfront-ui'];
    (workspace.dependencies as TomlTable).topcoat = topcoat;
  });
  await manifest(join(app, 'Cargo.toml'), (value) => {
    (value.package as TomlTable).autobins = false;
    value.lib = { 'crate-type': ['cdylib', 'rlib'] };
    const deps = value.dependencies as TomlTable;
    delete value['dev-dependencies'];
    delete deps.tokio;
    deps.topcoat = topcoat;
    deps['topcoat-cloudflare'] = `=${cargo.workspace.package.version}`;
    deps.worker = { ...cargo.workspace.dependencies.worker };
    const wasmBindgen = cargo.workspace.dependencies['wasm-bindgen'];
    assert.ok(typeof wasmBindgen === 'string');
    deps['wasm-bindgen'] = wasmBindgen;
  });
  const path = join(app, 'src/main.rs');
  await replace(path, 'AssetBundle, RouterBuilderAssetExt', 'AssetConfig, RouterBuilderAssetExt');
  await replace(
    path,
    '#[tokio::main]\nasync fn main()',
    'pub fn router(assets: AssetConfig) -> topcoat::router::Router',
  );
  await replace(path, 'AssetBundle::load().unwrap()', 'assets');
  await replace(path, 'topcoat::start(router).await.unwrap();', 'router');
  await writeFile(
    join(app, 'src/lib.rs'),
    '#[path = "main.rs"]\nmod app;\ntopcoat_cloudflare::entrypoint!(app::router);\n',
  );
  await migrateViews(join(root, 'crates/coldfront-ui/src'));
  await migrateViews(join(app, 'src'));
  await cp(join(repository, 'rust-toolchain.toml'), join(root, 'rust-toolchain.toml'));
  const lockDirectory = join(repository, 'tests/sites/locks');
  const npmLock = await readFile(join(lockDirectory, 'package-lock.json'), 'utf8');
  const locked = JSON.parse(npmLock) as {
    name: string;
    packages: Record<string, { devDependencies: Record<string, string> }>;
  };
  const dependencies = locked.packages[''].devDependencies;
  assert.equal(dependencies['@topcoat-cloudflare/adapter'], cargo.workspace.package.version);
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify({
      name: locked.name,
      private: true,
      type: 'module',
      devDependencies: dependencies,
    }),
  );
  await writeFile(join(app, 'package-lock.json'), npmLock);
  const log = join(output, 'logs', `${site.id}-build.log`);
  await checked('npm', ['ci', '--ignore-scripts'], app, log);
  await checked('npx', ['--no-install', 'topcoat-cloudflare', 'setup'], app, log);
  await checked('npm', ['ci'], app, log);
  await cp(join(lockDirectory, `${site.id}.Cargo.lock`), join(root, 'Cargo.lock'));
  return { app };
}

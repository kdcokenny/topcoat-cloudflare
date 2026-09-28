import { cp, lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { hasCode } from './errors.ts';

// https://developers.cloudflare.com/workers/static-assets/headers/
const MAX_HEADER_RULES = 100;
const MAX_HEADER_LINE_LENGTH = 2_000;

export function validateHeaderLimits(headers: string) {
  const lines = headers.split('\n');
  if (lines.some((line) => line.length > MAX_HEADER_LINE_LENGTH))
    throw new Error(
      `The combined _headers file exceeds Cloudflare’s ${MAX_HEADER_LINE_LENGTH.toLocaleString('en-US')}-character line limit. Shorten public/_headers rules.`,
    );
  const rules = lines.filter((line) => /^(\/|https:\/\/)/.test(line.trim())).length;
  if (rules > MAX_HEADER_RULES)
    throw new Error(
      `The combined _headers file has ${rules} rules; Cloudflare allows ${MAX_HEADER_RULES}. Consolidate public/_headers rules or asset content types.`,
    );
}

export async function withBuildLock<T>(root: string, callback: () => Promise<T>) {
  await mkdir(root, { recursive: true });
  const path = join(root, 'build.lock');
  let lock;
  try {
    lock = await open(path, 'wx');
  } catch (error) {
    if (hasCode(error, 'EEXIST'))
      throw new Error(
        `Another build holds ${path}. If it was interrupted, stop that process and remove this lock.`,
      );
    throw error;
  }
  try {
    await lock.writeFile(`${process.pid}\n`);
    return await callback();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}

export async function promote(stage: string, destination: string) {
  const previous = `${destination}.previous`;
  await rm(previous, { recursive: true, force: true });
  let moved = false;
  try {
    await rename(destination, previous);
    moved = true;
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  try {
    await rename(stage, destination);
  } catch (error) {
    if (moved) await rename(previous, destination);
    throw error;
  }
  await rm(previous, { recursive: true, force: true });
}

export async function mergePublic(source: string, destination: string) {
  try {
    await stat(source);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return [];
    throw error;
  }
  try {
    await stat(join(source, '_topcoat'));
    throw new Error('public/_topcoat is reserved for generated assets.');
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  const generated = await readFile(join(destination, '_headers'), 'utf8');
  const files: string[] = [];
  await cp(source, destination, {
    recursive: true,
    dereference: false,
    filter: async (path) => {
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error(`Public assets must be regular files: ${path}`);
      const name = relative(source, path).replaceAll('\\', '/');
      if (name.split('/').some((segment) => segment.startsWith('.'))) return false;
      if (name === '_redirects')
        throw new Error(
          'Define redirects in Topcoat routes; public/_redirects is not supported with Worker-first routing.',
        );
      if (info.isFile() && name !== '_headers') files.push(`/${name}`);
      return true;
    },
  });
  let custom = '';
  try {
    custom = await readFile(join(source, '_headers'), 'utf8');
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  await writeFile(join(destination, '_headers'), `${custom}\n${generated}`);
  return files.sort();
}

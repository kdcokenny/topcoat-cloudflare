import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function copyExample(source: string, destination: string) {
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '.'],
    { cwd: source, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const target = join(destination, file);
    await mkdir(dirname(target), { recursive: true });
    await cp(join(source, file), target);
    hash
      .update(file)
      .update('\0')
      .update(await readFile(target));
  }
  return hash.digest('hex');
}

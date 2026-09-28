import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { repository } from '../../scripts/project.ts';

export const output = join(repository, 'artifacts/sites');
export const environment = {
  ...process.env,
  CARGO_TARGET_DIR: join(repository, 'target/sites'),
  CARGO_BUILD_JOBS: '2',
  WRANGLER_SEND_METRICS: 'false',
};

export async function command(
  executable: string,
  args: string[],
  cwd: string,
  logPath: string,
  timeout = 900_000,
) {
  await mkdir(dirname(logPath), { recursive: true });
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`\n$ ${executable} ${args.join(' ')}\n`);
  const started = performance.now();
  const child = spawn(executable, args, {
    cwd,
    env: environment,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
  }, timeout);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    return { code, timedOut, seconds: (performance.now() - started) / 1000 };
  } finally {
    clearTimeout(timer);
    await new Promise<void>((resolve) => log.end(resolve));
  }
}

export async function checked(executable: string, args: string[], cwd: string, log: string) {
  const result = await command(executable, args, cwd, log);
  if (result.code !== 0) throw new Error(`${executable} failed; see ${log}`);
  return result;
}

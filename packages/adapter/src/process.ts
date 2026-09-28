import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { errorMessage } from './errors.ts';

const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin');

export async function rustTool(name: string) {
  const candidate = join(cargoBin, name);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return name;
  }
}

export function run(
  command: string,
  args: string[],
  { cwd, capture = false, env = {}, signal }: RunOptions = {},
) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      signal,
      env: {
        ...process.env,
        // Build tools can be installed without changing the user's shell profile.
        PATH: [cargoBin, process.env.PATH].filter(Boolean).join(delimiter),
        ...env,
      },
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    let stdout = '',
      stderr = '';
    if (capture) {
      child.stdout!.on('data', (value) => {
        stdout += value;
      });
      child.stderr!.on('data', (value) => {
        stderr += value;
      });
    }
    child.on('error', (error) => {
      reject(new Error(`Cannot run ${command}: ${errorMessage(error)}`, { cause: error }));
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`${command} exited with code ${code}.${capture ? `\n${stderr.trim()}` : ''}`),
        );
    });
  });
}

interface RunOptions {
  cwd?: string;
  capture?: boolean;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

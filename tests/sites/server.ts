import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from 'jsonc-parser';

import { environment, output } from './process.ts';
import { readResponse } from './load.ts';

export async function quizApi() {
  const responseDelayMs = 25;
  let requests = 0;
  let mode: 'ok' | 'malformed' | 'empty' | 'http-error' | 'stalled-body' = 'ok';
  let delayMs = responseDelayMs;
  const server = createServer((request, response) => {
    if (request.url !== '/api?limit=5&difficulty=facile') {
      response.writeHead(404).end();
      return;
    }
    requests++;
    const currentMode = mode;
    response.writeHead(currentMode === 'http-error' ? 503 : 200, {
      'content-type': 'application/json',
    });
    if (currentMode === 'stalled-body') {
      response.write('{"quizzes":');
      return;
    }
    setTimeout(
      () =>
        response.end(
          currentMode === 'malformed'
            ? 'invalid-json'
            : JSON.stringify({
                quizzes: Array.from({ length: currentMode === 'empty' ? 0 : 5 }, (_, index) => ({
                  question: `Question ${index + 1}: choose the answer`,
                  answer: `Correct ${index + 1}`,
                  badAnswers: [
                    `Wrong ${index + 1} A`,
                    `Wrong ${index + 1} B`,
                    `Wrong ${index + 1} C`,
                  ],
                })),
              }),
        ),
      delayMs,
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}/api`,
    get requests() {
      return requests;
    },
    setMode(value: typeof mode) {
      mode = value;
    },
    setDelay(value = responseDelayMs) {
      delayMs = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

export async function start(app: string, id: string, variables: Record<string, string>) {
  const socket = createSocket();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const baseURL = `http://127.0.0.1:${port}`;
  const config = parse(await readFile(join(app, 'wrangler.jsonc'), 'utf8')) as Record<
    string,
    unknown
  >;
  delete config.build;
  config.vars = variables;
  await writeFile(join(app, 'benchmark.wrangler.json'), JSON.stringify(config));
  const log = createWriteStream(join(output, 'logs', `${id}-server.log`));
  const began = performance.now();
  const child = spawn(
    'npx',
    [
      '--no-install',
      'wrangler',
      'dev',
      '--config',
      'benchmark.wrangler.json',
      '--port',
      String(port),
      '--ip',
      '127.0.0.1',
      '--show-interactive-dev-session=false',
      '--log-level',
      'error',
    ],
    {
      cwd: app,
      env: environment,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  let spawnError: Error | undefined;
  child.once('error', (error) => {
    spawnError = error;
  });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (child.pid) process.kill(-child.pid, 'SIGTERM');
    } catch {}
    await Promise.race([exited, sleep(5_000, undefined, { ref: false })]);
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {}
    await exited;
    await new Promise<void>((resolve) => log.end(resolve));
  }
  try {
    const deadline = performance.now() + 30_000;
    while (performance.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`${id}: server exited; see server log`);
      try {
        const { response } = await readResponse(new URL(baseURL), {}, 1000);
        if (response.ok) return { baseURL, readyMs: performance.now() - began, close };
      } catch {}
      await sleep(100);
    }
    throw new Error(`${id}: server did not become ready`);
  } catch (error) {
    await close();
    throw error;
  }
}

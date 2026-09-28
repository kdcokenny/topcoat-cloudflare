import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { once } from 'node:events';

import { load, probe, readResponse } from './load.ts';

await test('request deadlines cover the body and stop when the response completes', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  let pending = false;
  context.mock.method(globalThis, 'fetch', (_url: URL, init: RequestInit) => {
    signal = init.signal;
    const body = pending
      ? new ReadableStream({
          start(controller) {
            signal?.addEventListener('abort', () => controller.error(signal?.reason));
          },
        })
      : 'complete';
    return Promise.resolve(new Response(body));
  });

  const deadlineMs = 100;
  const url = new URL('http://test.invalid');
  assert.equal((await readResponse(url, {}, deadlineMs)).body, 'complete');
  context.mock.timers.tick(deadlineMs);
  assert.equal(signal?.aborted, false, 'Completed responses must not receive a late abort');

  pending = true;
  const response = readResponse(url, {}, deadlineMs);
  context.mock.timers.tick(deadlineMs);
  await assert.rejects(response, { name: 'AbortError' });
});

await test('load measurements consume complete bodies and count invalid responses as failures', async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.flushHeaders();
    setTimeout(() => response.end(requests % 2 ? 'expected' : 'wrong'), 20);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const base = `http://127.0.0.1:${address.port}`;
    const first = await probe(base, { path: '/', contains: 'expected' });
    assert.ok(first.elapsed - first.firstByte >= 10, 'latency includes the delayed body');
    const sample = await load(base, [{ path: '/', contains: 'expected' }], 1, 150);
    assert.ok(sample.errors.length > 0);
    assert.ok(sample.completed > 0);
    assert.equal(sample.completed + sample.errors.length, requests - 1);
    assert.equal(sample.bytes, sample.completed * Buffer.byteLength('expected'));
    assert.ok(sample.latencyMs.p99 >= sample.latencyMs.p50);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

import { test, expect } from '@playwright/test';
import { setTimeout as sleep } from 'node:timers/promises';
import { get as httpGet, request as httpRequest } from 'node:http';
import { get as httpsGet, request as httpsRequest } from 'node:https';
import { randomUUID } from 'node:crypto';

const base = process.env.TOPCOAT_TEST_URL ?? 'http://127.0.0.1:18888';
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', body, headers: { origin: base, ...headers } });

test('SSR includes request context and usable assets', async () => {
  const response = await fetch(base);
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(html).toContain('request context works');
  const assets = [...html.matchAll(/(?:href|src)="([^"]*\/_topcoat\/assets\/[^"]+)"/g)].map(
    (match) => match[1],
  );
  expect(assets.length).toBeGreaterThanOrEqual(3);
  for (const asset of assets) {
    const response = await fetch(base + asset);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
    if (asset.includes('custom-'))
      expect(response.headers.get('content-type')).toBe('application/x-topcoat-test');
    if (asset.includes('café@2x-'))
      expect(response.headers.get('content-type')).toBe('application/x-topcoat-unicode');
  }
});

test('private build artifacts are not public and missing assets stay 404', async () => {
  for (const path of [
    '/asset-manifest.txt',
    '/build.json',
    '/_topcoat/assets/manifest.toml',
    '/_topcoat/assets/missing.css',
  ]) {
    expect((await fetch(base + path)).status).toBe(404);
  }
});

test('static public files are copied without SPA fallback', async () => {
  const response = await fetch(base + '/robots.txt');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('Disallow: /');
  expect((await fetch(base + '/robots')).status).toBe(404);
});

test('typed procedure preserves the Topcoat wire format', async () => {
  const response = await post('/api/double', '[{"t":"u32","bits":32,"v":"7"}]', {
    'content-type': 'application/json',
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ t: 'u32', bits: 32, v: '14' });
  const invalid = await post('/api/double', '[7]', { 'content-type': 'application/json' });
  expect(invalid.status).toBe(400);
});

test('HTTP page reruns retain platform bindings', async () => {
  const response = await post('/', '{"signals":{}}', {
    'content-type': 'application/json',
    'x-topcoat-runtime': 'true',
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('request context works');
});

test('cross-origin state-changing requests are rejected', async () => {
  const response = await post('/api/double', '[{"t":"u32","bits":32,"v":"7"}]', {
    'content-type': 'application/json',
    origin: 'https://unrelated.invalid',
  });
  expect(response.status).toBe(403);
});

test('request context remains isolated across overlapping requests', async () => {
  const responses = await Promise.all(
    Array.from({ length: 24 }, (_, id) =>
      fetch(`${base}/request?q=a%20b&n=${id}`, { headers: { 'x-request-id': String(id) } }).then(
        async (response) =>
          (await response.json()) as {
            id: string;
            uri: string;
            greeting: string;
            abortSignal: boolean;
          },
      ),
    ),
  );
  for (const [id, body] of responses.entries()) {
    expect(body.id).toBe(String(id));
    expect(body.uri).toContain(`q=a%20b&n=${id}`);
    expect(body.greeting).toBe('request context works');
    expect(body.abortSignal).toBe(true);
  }
});

test('binary request and response bodies survive the bridge', async () => {
  const body = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256));
  const response = await post('/echo', body, { 'content-type': 'application/octet-stream' });
  expect(response.status).toBe(200);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(body);
});

test('streaming request bodies are accepted', async () => {
  const body = new ReadableStream({
    async start(controller) {
      controller.enqueue(new TextEncoder().encode('first '));
      await sleep(20);
      controller.enqueue(new TextEncoder().encode('second'));
      controller.close();
    },
  });
  const response = await fetch(base + '/echo', {
    method: 'POST',
    duplex: 'half',
    body,
    headers: { origin: base },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe('first second');
});

test('body limits are enforced, including chunked requests', async () => {
  expect((await post('/limited', 'a'.repeat(1024))).status).toBe(200);
  expect((await post('/limited', 'a'.repeat(1025))).status).toBe(413);
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2048));
      controller.close();
    },
  });
  expect(
    (
      await fetch(base + '/limited', {
        method: 'POST',
        duplex: 'half',
        body,
        headers: { origin: base },
      })
    ).status,
  ).toBe(413);
});

test('JSON extraction reports malformed input and round-trips valid input', async () => {
  const headers = { 'content-type': 'application/json' };
  expect((await post('/json', '{bad', headers)).status).toBe(400);
  const response = await post('/json', '{"name":"café","items":[1,true]}', headers);
  expect(await response.json()).toEqual({ name: 'café', items: [1, true] });
});

test('rejected uploads do not break subsequent requests', async () => {
  for (let iteration = 0; iteration < 50; iteration++) {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(2048));
        controller.close();
      },
    });
    const rejected = await fetch(base + '/limited', {
      method: 'POST',
      duplex: 'half',
      body,
      headers: { origin: base },
    });
    expect(rejected.status, `upload ${iteration}`).toBe(413);
    await rejected.text();
    const next = await post('/json', JSON.stringify({ iteration }), {
      'content-type': 'application/json',
    });
    expect(next.status, `follow-up ${iteration}`).toBe(200);
    expect(await next.json()).toEqual({ iteration });
  }
});

test('multipart form fields and uploaded files are preserved', async () => {
  const form = new FormData();
  form.set('name', 'Ada');
  form.set('file', new Blob(['hello file'], { type: 'text/plain' }), 'hello.txt');
  const response = await post('/upload', form);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([
    { name: 'name', filename: null, bytes: 3, text: 'Ada' },
    { name: 'file', filename: 'hello.txt', bytes: 10, text: 'hello file' },
  ]);
  expect(
    (await post('/upload', 'missing boundary', { 'content-type': 'multipart/form-data' })).status,
  ).toBe(400);
});

test('aborting an unfinished upload leaves the server usable', async () => {
  const request = base.startsWith('https:') ? httpsRequest : httpRequest;
  for (let iteration = 0; iteration < 8; iteration++) {
    await new Promise<void>((resolve) => {
      const upload = request(base + '/limited', {
        method: 'POST',
        headers: { origin: base, 'content-length': '10000' },
      });
      upload.on('error', () => {});
      upload.on('close', resolve);
      upload.write(Buffer.alloc(2048));
      setTimeout(() => upload.destroy(), 25);
    });
    const next = await fetch(base + '/health');
    expect(next.status).toBe(200);
    await next.text();
  }
});

test('multiple Set-Cookie headers remain separate', async () => {
  const response = await fetch(base + '/cookies');
  expect(response.headers.getSetCookie()).toHaveLength(2);
});

test('redirect status and location survive', async () => {
  const response = await fetch(base + '/redirect', { redirect: 'manual' });
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe('/');
});

test('HEAD and null-body statuses do not violate Fetch response rules', async () => {
  const response = await fetch(base + '/head', { method: 'HEAD' });
  expect(response.status).toBe(200);
  expect(response.headers.get('x-head')).toBe('preserved');
  expect(await response.text()).toBe('');
  for (const [path, status] of [
    ['/empty', 204],
    ['/reset', 205],
    ['/not-modified', 304],
  ]) {
    const response = await fetch(base + path);
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  }
});

test('Topcoat owns not-found, method, and error responses', async () => {
  expect((await fetch(base + '/missing')).status).toBe(404);
  const wrongMethod = await fetch(base + '/echo');
  expect(wrongMethod.status).toBe(405);
  expect(wrongMethod.headers.get('allow')).toContain('POST');
  const error = await fetch(base + '/error');
  expect(error.status).toBe(500);
  expect(await error.text()).not.toContain('private diagnostic');
});

test('unsupported connected rendering fails explicitly', async () => {
  const response = await fetch(base, {
    headers: { 'sec-websocket-protocol': 'other, topcoat-runtime' },
  });
  expect(response.status).toBe(501);
  expect(await response.text()).toContain('not supported');
});

test('KV, D1, and R2 bindings execute asynchronous operations', async () => {
  const response = await fetch(base + '/bindings', { headers: { 'x-test-id': randomUUID() } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    kv: 'kv works',
    d1: { value: 'd1 works' },
    r2: 'r2 works',
  });
});

test('waitUntil completes work after the response', async () => {
  const headers = { 'x-test-id': randomUUID() };
  expect(await (await fetch(base + '/background', { headers })).json()).toBeNull();
  expect((await post('/background', '', headers)).status).toBe(200);
  await expect
    .poll(async (): Promise<unknown> => (await fetch(base + '/background', { headers })).json())
    .toBe('complete');
});

test('session token lifecycle and cookie attributes work', async () => {
  expect(await (await fetch(base + '/session')).json()).toBeNull();
  const start = await post('/session/start', '');
  expect(start.status).toBe(200);
  const body = (await start.json()) as { hash: string; current: string; expires: number };
  const cookieHeader = start.headers.getSetCookie()[0];
  expect(cookieHeader).toMatch(/^__Host-/);
  expect(cookieHeader).toMatch(/HttpOnly/i);
  expect(cookieHeader).toMatch(/Secure/i);
  expect(cookieHeader).toMatch(/SameSite=Lax/i);
  expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
  expect(body.current).toBe(body.hash);
  expect(body.expires).toBeGreaterThan(Date.now() / 1000);
  let cookie = cookieHeader.split(';')[0];
  expect(await (await fetch(base + '/session', { headers: { cookie } })).json()).toBe(body.hash);
  expect(await (await post('/session/refresh', '', { cookie })).json()).toBe(body.hash);
  const rotation = await post('/session/rotate', '', { cookie });
  const rotated = (await rotation.json()) as { old: string; new: string };
  expect(rotated.old).toBe(body.hash);
  expect(rotated.new).not.toBe(body.hash);
  cookie = rotation.headers.getSetCookie()[0].split(';')[0];
  expect(await (await fetch(base + '/session', { headers: { cookie } })).json()).toBe(rotated.new);
  const stop = await post('/session/stop', '', { cookie });
  expect(await stop.json()).toEqual({ previous: rotated.new, current: null });
  expect(stop.headers.getSetCookie()[0]).toMatch(/Max-Age=0/i);
});

test('malformed session tokens are treated as absent', async () => {
  const start = await post('/session/start', '');
  const name = start.headers.getSetCookie()[0].split('=')[0];
  expect(
    await (await fetch(base + '/session', { headers: { cookie: `${name}=malformed` } })).json(),
  ).toBeNull();
});

test('HTML reaches the client before delayed rendering completes', async () => {
  const response = await fetch(base + '/stream', { headers: { 'accept-encoding': 'identity' } });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let content = '';
  while (!content.includes('Loading')) {
    const { value, done } = await reader.read();
    if (done) break;
    content += decoder.decode(value);
  }
  expect(content).toContain('Loading');
  expect(content).not.toContain('Finished');
  const start = performance.now();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    content += decoder.decode(value);
  }
  expect(content).toContain('Finished');
  expect(performance.now() - start).toBeGreaterThan(200);
});

test('canceling a response drops the suspended render', async () => {
  test.skip(!!process.env.TOPCOAT_TEST_URL, 'The cleanup counter is local to one Wasm instance.');
  const response = await fetch(base + '/stream/open', {
    headers: { 'accept-encoding': 'identity' },
  });
  const reader = response.body!.getReader();
  await reader.read();
  expect(await (await fetch(base + '/stream/active')).json()).toBe(1);
  await reader.cancel();
  await expect
    .poll(async (): Promise<unknown> => (await fetch(base + '/stream/active')).json())
    .toBe(0);
});

test('an abrupt socket disconnect drops the suspended render', async () => {
  test.skip(!!process.env.TOPCOAT_TEST_URL, 'The cleanup counter is local to one Wasm instance.');
  await new Promise<void>((resolve, reject) => {
    const get = base.startsWith('https:') ? httpsGet : httpGet;
    const request = get(
      base + '/stream/open',
      { headers: { 'accept-encoding': 'identity' } },
      (response) => {
        response.once('data', () => {
          response.socket.destroy();
          resolve();
        });
        response.on('error', () => {});
      },
    );
    request.on('error', reject);
  });
  await expect
    .poll(async (): Promise<unknown> => (await fetch(base + '/stream/active')).json())
    .toBe(0);
});

test('a trapped request does not poison later requests', async () => {
  const response = await fetch(base + '/panic');
  expect(response.status).toBeGreaterThanOrEqual(500);
  const next = await fetch(base);
  expect(next.status).toBe(200);
  expect(await next.text()).toContain('request context works');
});

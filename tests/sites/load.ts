import assert from 'node:assert/strict';

export interface Endpoint {
  path: string;
  contains: string;
  status?: number;
  form?: Record<string, string>;
  location?: string;
}

export interface Sample {
  concurrency: number;
  seconds: number;
  completed: number;
  errors: string[];
  bytes: number;
  requestsPerSecond: number;
  completedByEndpoint: Record<string, number>;
  latencyMs: { p50: number; p95: number; p99: number; max: number };
  firstByteMs: { p50: number; p95: number; p99: number; max: number };
}

function distribution(values: number[]) {
  assert.ok(values.length, 'A benchmark must complete at least one request');
  values.sort((a, b) => a - b);
  const percentile = (fraction: number) => values[Math.ceil(values.length * fraction) - 1];
  return {
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: values.at(-1)!,
  };
}

export async function readResponse(url: URL, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const firstByte = performance.now() - started;
    const body = await response.text();
    return { response, body, firstByte, elapsed: performance.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

export async function probe(base: string, endpoint: Endpoint) {
  const { response, body, firstByte, elapsed } = await readResponse(new URL(endpoint.path, base), {
    method: endpoint.form ? 'POST' : 'GET',
    body: endpoint.form ? new URLSearchParams(endpoint.form) : undefined,
    headers: { 'accept-encoding': 'identity' },
    redirect: 'manual',
  });
  assert.equal(response.status, endpoint.status ?? 200, endpoint.path);
  if (endpoint.location) assert.equal(response.headers.get('location'), endpoint.location);
  assert.ok(body.includes(endpoint.contains), `${endpoint.path}: incorrect response body`);
  return { firstByte, elapsed, bytes: Buffer.byteLength(body) };
}

// Closed-loop load: each client finishes one complete response before issuing its next request.
export async function load(
  base: string,
  endpoints: Endpoint[],
  concurrency: number,
  durationMs: number,
): Promise<Sample> {
  assert.ok(endpoints.length && concurrency > 0 && durationMs > 0);
  const latency: number[] = [];
  const firstByte: number[] = [];
  const errors: string[] = [];
  const completedByEndpoint: Record<string, number> = {};
  let bytes = 0;
  let issued = 0;
  const started = performance.now();
  const deadline = started + durationMs;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (performance.now() < deadline) {
        const endpoint = endpoints[issued++ % endpoints.length];
        try {
          const result = await probe(base, endpoint);
          latency.push(result.elapsed);
          firstByte.push(result.firstByte);
          bytes += result.bytes;
          const key = `${endpoint.form ? 'POST' : 'GET'} ${endpoint.path}`;
          completedByEndpoint[key] = (completedByEndpoint[key] ?? 0) + 1;
        } catch (error) {
          errors.push(String(error));
        }
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  return {
    concurrency,
    seconds,
    completed: latency.length,
    errors,
    bytes,
    requestsPerSecond: latency.length / seconds,
    completedByEndpoint,
    latencyMs: distribution(latency),
    firstByteMs: distribution(firstByte),
  };
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parse } from 'smol-toml';

import { cargo, repository, toolchain } from '../../scripts/project.ts';
import { journey } from './browser.ts';
import { quizRequests, resumeQuiz } from './quiz.ts';
import { load, probe, type Endpoint, type Sample } from './load.ts';
import { familyPages, familyWrite, prepareDatabase, queryDatabase, verifyDatabase } from './f4y.ts';
import { prepare, checkout } from './prepare.ts';
import { checked, command, output } from './process.ts';
import { quizApi, start } from './server.ts';
import { sites, type Site } from './sources.ts';

const benchmark = process.argv.includes('--benchmark');
const chosen = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
for (const id of chosen)
  assert.ok(
    sites.some((site) => site.id === id),
    `Unknown site ${id}`,
  );
const selected = sites.filter((site) => !chosen.length || chosen.includes(site.id));
const results: Record<string, unknown>[] = [];
const harness = createHash('sha256');
const harnessDirectory = join(repository, 'tests/sites');
for (const path of (await readdir(harnessDirectory, { recursive: true })).sort()) {
  if (/\.(ts|rs|sql|json|lock)$/.test(path)) {
    harness
      .update(path)
      .update('\0')
      .update(await readFile(join(harnessDirectory, path)));
  }
}
const report = {
  schema: 1,
  started: new Date().toISOString(),
  finished: null as string | null,
  status: 'running',
  benchmark,
  harnessSha256: harness.digest('hex'),
  adapter: cargo.workspace.package.version,
  topcoat: cargo.workspace.dependencies.topcoat.version,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository,
    encoding: 'utf8',
  }).trim(),
  dirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim(),
  ),
  host: {
    platform: platform(),
    kernel: release(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    node: process.version,
    rust: toolchain.channel,
    cpuQuota: await readFile('/sys/fs/cgroup/cpu.max', 'utf8').then(
      (value) => value.trim(),
      () => null,
    ),
    memoryLimit: await readFile('/sys/fs/cgroup/memory.max', 'utf8').then(
      (value) => value.trim(),
      () => null,
    ),
  },
  protocol: {
    location: 'local workerd',
    compression: 'identity',
    load: 'closed loop, full response, validated body',
    warmupRequests: 20,
    repetitions: 3,
    concurrency: [1, 8, 32],
    sampleSeconds: 10,
    soakSeconds: 60,
    soakConcurrency: 32,
  },
  results,
};
await mkdir(join(output, 'logs'), { recursive: true });
const reportPrefix = selected.length === 1 ? `${selected[0].id}-` : '';
const reportFile = join(output, `${reportPrefix}${benchmark ? 'benchmark' : 'compatibility'}.json`);
let failed = false;

async function save() {
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
}
async function digest(path: string) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function upstreamProbe(site: Site) {
  const source = await checkout(site);
  const app = join(output, 'probes', site.id);
  await rm(app, { recursive: true, force: true });
  await cp(source, app, { recursive: true, filter: (path) => !path.includes('/.git') });
  let framework: { repository: string; revision: string } | undefined;
  if (['cangnu', 'mousuo'].includes(site.id)) {
    // These projects document a sibling Topcoat checkout as a prerequisite.
    const upstream = sites.find((candidate) => candidate.id === 'showcase');
    assert.ok(upstream);
    const destination = join(output, 'probes/tmp/topcoat');
    await rm(destination, { recursive: true, force: true });
    await cp(await checkout(upstream), destination, {
      recursive: true,
      filter: (path) => !path.includes('/.git'),
    });
    framework = { repository: upstream.repository, revision: upstream.revision };
  }
  const manifest = parse(await readFile(join(app, 'Cargo.toml'), 'utf8'));
  if (!manifest.workspace)
    await writeFile(join(app, 'Cargo.toml'), '\n[workspace]\nresolver = "2"\n', { flag: 'a' });
  const log = join(output, 'logs', `${site.id}-upstream.log`);
  await writeFile(log, '');
  const build = await command(
    'cargo',
    [`+${toolchain.channel}`, 'check', '--locked', '--target', 'wasm32-unknown-unknown'],
    app,
    log,
  );
  const text = await readFile(log, 'utf8');
  const expected =
    site.id === 'blocks'
      ? /the wasm\*-unknown-unknown targets are not supported by default|This wasm target is unsupported by mio/
      : /This wasm target is unsupported by mio/;
  assert.notEqual(
    build.code,
    0,
    `${site.id}: previously blocked build succeeded; reassess compatibility`,
  );
  assert.equal(build.timedOut, false, 'Timeout is not a compatibility finding');
  assert.match(text, expected, `${site.id}: unexpected failure; see ${log}`);
  return {
    status: 'blocked',
    stage: 'unmodified upstream dependency graph on wasm32',
    framework,
    diagnostic: text.match(expected)?.[0],
    log: `logs/${site.id}-upstream.log`,
    ...build,
  };
}

async function assets(baseURL: string, pages: Endpoint[]) {
  const paths = new Set<string>();
  for (const endpoint of pages) {
    const html = await (await fetch(new URL(endpoint.path, baseURL))).text();
    for (const match of html.matchAll(/(?:src|href)="(\/_topcoat\/[^"?#]+)"/g)) paths.add(match[1]);
  }
  assert.ok(paths.size > 0, 'Expected generated application assets');
  for (const path of paths) {
    const response = await fetch(new URL(path, baseURL));
    assert.equal(response.status, 200, path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
    assert.ok(response.headers.get('content-type'), path);
  }
  return paths.size;
}

async function sizes(directory: string): Promise<{ files: number; bytes: number }> {
  let files = 0,
    bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await sizes(path);
      files += child.files;
      bytes += child.bytes;
    } else {
      files++;
      bytes += (await stat(path)).size;
    }
  }
  return { files, bytes };
}

for (const site of selected) {
  const result: Record<string, unknown> = { ...site };
  results.push(result);
  try {
    console.log(
      `${site.id}: checking ${site.example ?? `${site.repository}@${site.revision.slice(0, 7)}`}`,
    );
    if (!['quiz', 'coldfront', 'showcase', 'f4y'].includes(site.id)) {
      Object.assign(result, await upstreamProbe(site));
      continue;
    }
    const { app, sourceSha256 } = await prepare(site);
    result.sourceSha256 = sourceSha256;
    const buildLog = join(output, 'logs', `${site.id}-release.log`);
    const build = await checked(
      'npx',
      ['--no-install', 'topcoat-cloudflare', 'build'],
      app,
      buildLog,
    );
    result.buildSecondsWithExistingCaches = build.seconds;
    if (site.example) {
      await checked(
        'cargo',
        [
          'clippy',
          '--lib',
          '--locked',
          '--target',
          'wasm32-unknown-unknown',
          '--',
          '-D',
          'warnings',
        ],
        app,
        join(output, 'logs', `${site.id}-clippy.log`),
      );
    }
    const distribution = join(app, '.topcoat-cloudflare/dist');
    const metadata = JSON.parse(await readFile(join(distribution, 'build.json'), 'utf8')) as {
      profile: string;
      workerBuild: string;
      wasmSha256: string;
      catalogSha256: string;
    };
    assert.equal(metadata.profile, 'release');
    result.build = metadata;
    const wasm = await readFile(join(distribution, 'worker/index_bg.wasm'));
    result.bundle = {
      wasmBytes: wasm.length,
      wasmGzipBytes: gzipSync(wasm).length,
      assets: await sizes(join(distribution, 'public')),
    };
    result.locks = {
      cargo: await digest(join(output, 'apps', site.id, 'Cargo.lock')),
      npm: await digest(join(app, 'package-lock.json')),
    };
    if (site.id === 'f4y') {
      const manifest = parse(await readFile(join(app, 'Cargo.toml'), 'utf8')) as {
        dependencies: { toasty: { git: string; rev: string } };
      };
      const toastyD1 = {
        repository: manifest.dependencies.toasty.git.replace('https://github.com/', ''),
        revision: manifest.dependencies.toasty.rev,
      };
      result.database = { engine: 'local D1', toasty: toastyD1, ...(await prepareDatabase(app)) };
    }
    const api = site.id === 'quiz' ? await quizApi() : undefined;
    try {
      const server = await start(app, site.id, api ? { QUIZ_API_URL: api.url } : {});
      try {
        result.wranglerProcessReadyMs = server.readyMs;
        const endpoints: Endpoint[] =
          site.id === 'quiz'
            ? [
                { path: '/', contains: 'Start new quiz' },
                { path: '/quiz', contains: 'Question 1: choose the answer' },
              ]
            : site.id === 'f4y'
              ? [...familyPages]
              : [
                  {
                    path: '/',
                    contains: site.id === 'showcase' ? 'Component library' : 'Your cover is blown.',
                  },
                ];
        result.workload = endpoints;
        for (const endpoint of endpoints) await probe(server.baseURL, endpoint);
        assert.equal((await fetch(new URL('/not-a-real-route', server.baseURL))).status, 404);
        result.assetsChecked = await assets(server.baseURL, endpoints);
        let persistence: Awaited<ReturnType<typeof verifyDatabase>> | undefined;
        if (site.id === 'f4y') {
          persistence = await verifyDatabase(app, server.baseURL);
          result.databaseChecks = persistence;
        }
        const beforeJourney = api?.requests ?? 0;
        result.browserChecks = await journey(site.id, server.baseURL);
        if (api) {
          assert.equal(
            api.requests - beforeJourney,
            4,
            'Each of four quizzes fetches once; shard rerenders reuse the question props',
          );
          result.apiChecks = await quizRequests(server.baseURL, api);
          for (const mode of ['malformed', 'empty', 'http-error', 'stalled-body'] as const) {
            api.setMode(mode);
            await probe(server.baseURL, { path: '/quiz', contains: 'Unable to load quiz' });
            api.setMode('ok');
            await probe(server.baseURL, endpoints[1]);
          }
          result.errorRecovery =
            'Malformed JSON, empty questions, HTTP errors, and stalled bodies render a retry link; subsequent quizzes succeed';
        }
        if (site.id === 'f4y') {
          endpoints.push(familyWrite);
        }
        for (let i = 0; i < report.protocol.warmupRequests; i++)
          await probe(server.baseURL, endpoints[i % endpoints.length]);
        const countFamilies = async () =>
          (await queryDatabase<{ count: number }>(app, 'SELECT count(*) AS count FROM families'))[0]
            .count;
        const measure = async (concurrency: number, durationMs: number) => {
          if (site.id === 'f4y') {
            await queryDatabase(
              app,
              "DELETE FROM families WHERE name = 'Load family' AND summary = 'Measured D1 write'",
            );
          }
          const beforeLoad = site.id === 'f4y' ? await countFamilies() : undefined;
          const sample = await load(server.baseURL, endpoints, concurrency, durationMs);
          if (beforeLoad !== undefined) {
            assert.equal(
              await countFamilies(),
              beforeLoad + (sample.completedByEndpoint['POST /families'] ?? 0),
              'Every acknowledged load-test insert is persisted',
            );
          }
          return sample;
        };
        const samples = [];
        if (benchmark) {
          for (let repetition = 0; repetition < report.protocol.repetitions; repetition++) {
            // Reverse alternate rounds so the highest concurrency is not always measured last.
            const levels =
              repetition % 2
                ? [...report.protocol.concurrency].reverse()
                : report.protocol.concurrency;
            for (const concurrency of levels) {
              console.log(`${site.id}: round ${repetition + 1}, concurrency ${concurrency}`);
              samples.push({
                repetition: repetition + 1,
                ...(await measure(concurrency, report.protocol.sampleSeconds * 1000)),
              });
              result.samples = samples;
              await save();
            }
          }
          result.soak = await measure(
            report.protocol.soakConcurrency,
            report.protocol.soakSeconds * 1000,
          );
        } else samples.push(await measure(8, 2000));
        result.samples = samples;
        assert.ok(
          samples.every((sample) => sample.errors.length === 0),
          'Errors under load; inspect samples',
        );
        if (result.soak)
          assert.equal(
            (result.soak as { errors: string[] }).errors.length,
            0,
            'Errors during soak',
          );
        for (const endpoint of endpoints) await probe(server.baseURL, endpoint);
        if (site.id === 'f4y') {
          const measured = result.soak ? [...samples, result.soak as Sample] : samples;
          const writes = measured.reduce(
            (count, sample) => count + (sample.completedByEndpoint['POST /families'] ?? 0),
            0,
          );
          result.persistedLoadWrites = writes;
        }
        if (persistence) {
          await server.close();
          const restarted = await start(app, 'f4y-restarted', {});
          try {
            await probe(restarted.baseURL, {
              path: `/families/${persistence.persistentId}/edit`,
              contains: persistence.persistentName,
            });
            const [persisted] = await queryDatabase<{ version: number }>(
              app,
              `SELECT version FROM families WHERE id = ${persistence.persistentId}`,
            );
            assert.equal(persisted.version, persistence.persistentVersion);
            result.restartPersistence =
              'Existing family and version survived a fresh workerd process';
          } finally {
            await restarted.close();
          }
        } else if (api) {
          let restarted: Awaited<ReturnType<typeof start>> | undefined;
          const beforeRestart = api.requests;
          try {
            await resumeQuiz(server.baseURL, async () => {
              await server.close();
              api.setMode('http-error');
              restarted = await start(app, 'quiz-restarted', { QUIZ_API_URL: api.url });
              return restarted.baseURL;
            });
            assert.equal(
              api.requests - beforeRestart,
              1,
              'Resuming a quiz never refetches questions',
            );
            result.restartPersistence =
              'An open quiz completed after a workerd restart with the upstream API unavailable';
          } finally {
            await restarted?.close();
          }
        }
        result.apiRequests = api?.requests;
      } finally {
        await server.close();
      }
    } finally {
      await api?.close();
    }
    await checked(
      'npx',
      ['--no-install', 'wrangler', 'deploy', '--dry-run', '--config', 'benchmark.wrangler.json'],
      app,
      join(output, 'logs', `${site.id}-deploy.log`),
    );
    result.status = 'passed with documented adaptations';
  } catch (error) {
    failed = true;
    result.status = 'failed';
    result.error = String(error);
    console.error(`${site.id}: ${String(error)}`);
  } finally {
    await save();
  }
}
report.finished = new Date().toISOString();
report.status = failed ? 'failed' : 'passed';
await save();
console.log(`Results: ${reportFile}`);
if (failed) process.exitCode = 1;

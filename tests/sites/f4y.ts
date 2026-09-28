import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, type Page } from '@playwright/test';

import { checked, environment, output } from './process.ts';
import { readResponse, type Endpoint } from './load.ts';

const execute = promisify(execFile);
const activeSeedRows = 1000;
const deletedSeedRows = 40;
const pageSize = 20;

export const familyPages: Endpoint[] = [
  { path: '/families', contains: 'Create family' },
  { path: '/families/deleted', contains: 'Seed family' },
  { path: `/families?after=${activeSeedRows - pageSize}`, contains: 'Seed family' },
];
export const familyWrite: Endpoint = {
  path: '/families',
  contains: '',
  status: 303,
  location: '/families',
  form: { name: 'Load family', summary: 'Measured D1 write' },
};

interface FamilyRow {
  id: number;
  name: string;
  summary: string | null;
  version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function queryDatabase<T>(app: string, sql: string): Promise<T[]> {
  const { stdout, stderr } = await execute(
    'npx',
    ['--no-install', 'wrangler', 'd1', 'execute', 'DB', '--local', '--json', '--command', sql],
    { cwd: app, env: environment, timeout: 120_000 },
  );
  await appendFile(join(output, 'logs/f4y-database.log'), `${sql}\n${stdout}\n${stderr}\n`);
  const results = JSON.parse(stdout) as { success: boolean; results: T[] }[];
  assert.ok(results.length > 0 && results.every((result) => result.success));
  return results.flatMap((result) => result.results);
}

export async function prepareDatabase(app: string) {
  const log = join(output, 'logs/f4y-database.log');
  await writeFile(log, '');
  // Applying twice proves that ordinary local setup preserves existing migrations.
  for (let attempt = 0; attempt < 2; attempt++) {
    await checked(
      'npx',
      ['--no-install', 'wrangler', 'd1', 'migrations', 'apply', 'DB', '--local'],
      app,
      log,
    );
  }
  const migrations = await queryDatabase<{ count: number }>(
    app,
    'SELECT count(*) AS count FROM d1_migrations',
  );
  assert.equal(migrations[0].count, 1);
  await queryDatabase(
    app,
    `
    WITH RECURSIVE sequence(id) AS (
      VALUES(1) UNION ALL SELECT id + 1 FROM sequence WHERE id < ${activeSeedRows + deletedSeedRows}
    )
    INSERT INTO families (name, summary, deleted_at, version, created_at, updated_at)
    SELECT printf('Seed family %04d', id), 'Seed summary',
      CASE WHEN id > ${activeSeedRows} THEN '2026-09-01T00:00:00Z' ELSE NULL END,
      1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
    FROM sequence
  `,
  );
  return { activeSeedRows, deletedSeedRows, pageSize };
}

async function post(baseURL: string, path: string, fields: Record<string, string>) {
  const { response, body } = await readResponse(new URL(path, baseURL), {
    method: 'POST',
    body: new URLSearchParams(fields),
    redirect: 'manual',
  });
  return { status: response.status, location: response.headers.get('location'), body };
}

function redirected(response: Awaited<ReturnType<typeof post>>, location: string) {
  assert.equal(response.status, 303, response.body);
  assert.equal(response.location, location);
}

export async function verifyDatabase(app: string, baseURL: string) {
  const rows = () =>
    queryDatabase<FamilyRow>(
      app,
      "SELECT * FROM families WHERE name NOT LIKE 'Seed family %' ORDER BY id",
    );
  const invalid = await post(baseURL, '/families', { name: '   ', summary: '' });
  assert.equal(invalid.status, 400);
  assert.equal((await rows()).length, 0);
  redirected(
    await post(baseURL, '/families', { name: '  Persistent family  ', summary: '  ' }),
    '/families',
  );
  let [family] = await rows();
  assert.equal(family.name, 'Persistent family');
  assert.equal(family.summary, null);
  assert.equal(family.version, 1);
  assert.equal(family.deleted_at, null);
  assert.ok(Number.isFinite(Date.parse(family.created_at)));
  const createdAt = family.created_at;
  const path = `/families/${family.id}`;
  const conflict = `${path}/edit?conflict=true`;

  const writers = ['Concurrent A', 'Concurrent B'];
  const responses = await Promise.all(
    writers.map((name) =>
      post(baseURL, path, { name, summary: 'Concurrent update', version: '1' }),
    ),
  );
  for (const response of responses) assert.equal(response.status, 303, response.body);
  assert.deepEqual(
    new Set(responses.map((response) => response.location)),
    new Set(['/families', conflict]),
  );
  [family] = await rows();
  assert.equal(
    family.name,
    writers[responses.findIndex((response) => response.location === '/families')],
  );
  assert.equal(family.version, 2);
  assert.equal(family.created_at, createdAt);
  assert.ok(Date.parse(family.updated_at) >= Date.parse(createdAt));
  redirected(await post(baseURL, `${path}/delete`, { version: '1' }), conflict);
  redirected(await post(baseURL, `${path}/delete`, { version: '2' }), '/families');
  [family] = await rows();
  assert.equal(family.version, 3);
  assert.ok(family.deleted_at);
  assert.equal((await fetch(new URL(`${path}/edit`, baseURL))).status, 404);
  assert.equal(
    (await post(baseURL, path, { name: 'Cannot edit deleted', version: '3' })).status,
    404,
  );
  const deleted = await (await fetch(new URL('/families/deleted', baseURL))).text();
  assert.ok(deleted.includes(family.name) && deleted.includes('Europe/Rome'));
  assert.ok(deleted.includes('Sep 01, 2026, 2:00 AM'), 'Seed timestamps render in Rome time');
  redirected(
    await post(baseURL, `${path}/restore`, { version: '2' }),
    '/families/deleted?conflict=true',
  );
  redirected(await post(baseURL, `${path}/restore`, { version: '3' }), '/families');
  [family] = await rows();
  assert.equal(family.version, 4);
  assert.equal(family.deleted_at, null);
  redirected(await post(baseURL, `${path}/restore`, { version: '4' }), '/families');
  assert.equal((await rows())[0].version, 4, 'Restoring an active row is idempotent');
  assert.equal(
    (await post(baseURL, `/families/${family.id + 1}/restore`, { version: '1' })).status,
    404,
  );

  return {
    checks: [
      'migration idempotence',
      'validation and normalization',
      'concurrent optimistic locking',
      'stale delete and restore',
      'soft deletion',
      'timestamps',
      'idempotent restoration',
      'missing rows',
    ],
    persistentId: family.id,
    persistentName: family.name,
    persistentVersion: family.version,
  };
}

export async function familyJourney(page: Page, name: string) {
  for (const path of ['/', '/families/deleted']) {
    await page.goto(path);
    if (path === '/') await expect(page).toHaveURL(/\/families$/);
    const table = page.getByRole('table');
    const firstPage = await table.locator('tbody tr').allTextContents();
    assert.equal(firstPage.length, pageSize);
    await page.getByRole('link', { name: 'Next', exact: true }).click();
    const secondPage = await table.locator('tbody tr').allTextContents();
    assert.equal(secondPage.length, pageSize);
    assert.ok(
      secondPage.every((row) => !firstPage.includes(row)),
      'Cursor pages must not overlap',
    );
    await page.getByRole('link', { name: 'Previous', exact: true }).click();
    assert.deepEqual(await table.locator('tbody tr').allTextContents(), firstPage);
  }

  await page.goto('/families/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Summary', { exact: true }).fill('D1 browser journey');
  await page.getByRole('button', { name: 'Create family', exact: true }).click();
  const row = () => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) });
  await expect(row()).toBeVisible();
  await row().getByRole('link', { name: 'Edit', exact: true }).click();
  const stale = await page.context().newPage();
  try {
    await stale.goto(page.url());
    await page.getByLabel('Summary', { exact: true }).fill('Saved update');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await stale.getByLabel('Summary', { exact: true }).fill('Stale update');
    await stale.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(stale.getByRole('alert')).toContainText('This family changed');
    await expect(stale.getByLabel('Summary', { exact: true })).toHaveValue('Saved update');
  } finally {
    await stale.close();
  }
  await row().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row()).toHaveCount(0);
  await page.getByRole('link', { name: 'Deleted families', exact: true }).click();
  await expect(row().locator('time')).toHaveAttribute('datetime', /Z$/);
  await row().getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(row()).toContainText('Saved update');
}

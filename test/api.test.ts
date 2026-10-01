import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { startServer, ServerHandle } from '../src/api/server.js';
import { openDatabase } from '../src/db/migrate.js';

const dir = mkdtempSync(join(process.cwd(), '.data', 'test-'));
const dbFile = join(dir, 'test.db');
let handle: ServerHandle;
let base: string;

test.before(async () => {
  handle = await startServer({ dbFile, portFile: join(dir, 'port') });
  base = `http://127.0.0.1:${handle.port}`;
});

after(async () => {
  await handle.close();
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch {
    // best-effort cleanup on Windows if WAL handles linger briefly
  }
});

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

test('health and full analysis lifecycle over HTTP', async () => {
  const health = await call('GET', '/health');
  assert.equal(health.status, 200);

  const put = await call('POST', '/polynomials', {
    coefficients: ['0', '-1', '0', '1'], alias: 'cubic',
  });
  assert.equal(put.status, 201);
  const id = put.json.polynomial.id;

  const dup = await call('POST', '/polynomials', { coefficients: ['0', '-1', '0', '1'] });
  assert.equal(dup.status, 200);
  assert.equal(dup.json.created, false);

  const an = await call('POST', `/polynomials/${id}/analyze`,
    { maxWidth: '1/1000000', requestKey: 'run-1' });
  assert.equal(an.status, 201);
  assert.equal(an.json.run.totalRealRoots, 3);
  assert.equal(an.json.run.undecidedCount, 0);

  const idem = await call('POST', `/polynomials/${id}/analyze`,
    { maxWidth: '1/1000000', requestKey: 'run-1' });
  assert.equal(idem.status, 200);
  assert.equal(idem.json.created, false);

  const intervals = await call('GET', `/polynomials/${id}/intervals?limit=2&offset=0`);
  assert.equal(intervals.json.items.length, 2);
  assert.equal(intervals.json.total, 3);

  const proof = await call('GET', `/polynomials/${id}/proof`);
  assert.match(proof.json.declaration, /All 3/);
});

test('root count and sign endpoints over HTTP', async () => {
  const { json: p } = await call('POST', '/polynomials', { coefficients: ['-2', '0', '1'] });
  const id = p.polynomial.id;
  const whole = await call('POST', `/polynomials/${id}/count-roots`, {});
  assert.equal(whole.json.count, 2);
  const bounded = await call('POST', `/polynomials/${id}/count-roots`, { left: '0', right: '10' });
  assert.equal(bounded.json.count, 1);
  const sign = await call('POST', `/polynomials/${id}/sign`, { left: '2', right: '3' });
  assert.equal(sign.json.interiorSign, 'positive');
  const crossing = await call('POST', `/polynomials/${id}/sign`, { left: '-2', right: '2' });
  assert.equal(crossing.status, 409);
  assert.equal(crossing.json.error.code, 'INTERVAL_CONTAINS_ROOT');
});

test('error codes and validation', async () => {
  const high = ['0', ...Array.from({ length: 13 }, () => '1')];
  const bad = await call('POST', '/polynomials', { coefficients: high });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, 'DEGREE_EXCEEDED');
  const missing = await call('GET', '/polynomials/nonexistent');
  assert.equal(missing.status, 404);
  const paging = await call('GET', '/polynomials?limit=9999');
  assert.equal(paging.status, 400);
  assert.equal(paging.json.error.code, 'BAD_PAGINATION');
});

test('parameter revision keeps versions and comparison works', async () => {
  const { json: p } = await call('POST', '/polynomials', { coefficients: ['-2', '0', '1'] });
  const id = p.polynomial.id;
  await call('POST', `/polynomials/${id}/analyze`, { maxWidth: '1/100', requestKey: 'a' });
  await call('POST', `/polynomials/${id}/analyze`, { maxWidth: '1/1000000', requestKey: 'b' });
  const runs = await call('GET', `/polynomials/${id}/runs`);
  assert.equal(runs.json.total, 2);
  const v1 = await call('GET', `/polynomials/${id}/runs/1`);
  const v2 = await call('GET', `/polynomials/${id}/runs/2`);
  assert.equal(v1.json.run.params.maxWidth, '1/100');
  assert.equal(v2.json.run.params.maxWidth, '1/1000000');
});

test('state persists across a restart (reopen same database file)', async () => {
  await handle.close();
  assert.ok(existsSync(dbFile));
  // Re-run migrations (must be idempotent) and reopen service.
  const db = openDatabase(dbFile);
  const row = db.prepare('SELECT canonical FROM polynomials LIMIT 1').get() as { canonical: string };
  assert.ok(row.canonical);
  const count = Number((db.prepare('SELECT COUNT(*) c FROM analysis_runs').get() as { c: number }).c);
  assert.ok(count >= 1);
  db.close();
  handle = await startServer({ dbFile, portFile: join(dir, 'port') });
  base = `http://127.0.0.1:${handle.port}`;
  const byAlias = await call('GET', '/polynomials/cubic');
  assert.equal(byAlias.status, 200);
  assert.equal(byAlias.json.polynomial.canonical, '3:0,-1,0,1');
});

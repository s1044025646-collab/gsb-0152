import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDatabase } from '../src/db/database.ts';
import { Repository } from '../src/db/repo.ts';
import { PolyService } from '../src/service.ts';
import { startApi, type ApiServer } from '../src/api/server.ts';

const dbPath = join(tmpdir(), `poly-api-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
let api: ApiServer;
let base: string;

before(async () => {
  api = await startApi(new PolyService(new Repository(openDatabase(dbPath))), 0);
  base = `http://127.0.0.1:${api.port}`;
});

after(async () => {
  await api.close();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      rmSync(dbPath + suffix, { force: true });
    } catch {
      // Windows may retain the WAL briefly; test data lives in temp and is not asserted on.
    }
  }
});

async function jsonRequest(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json()) as any;
  return { status: res.status, json };
}

test('health and loopback binding', async () => {
  const { status, json } = await jsonRequest('GET', '/health');
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
  assert.equal(api.server.address() && (api.server.address() as { address: string }).address, '127.0.0.1');
});

test('full analysis workflow through HTTP', async () => {
  const created = await jsonRequest('POST', '/polynomials', { coefficients: ['-6', '13', '-7', '-1', '1'] });
  assert.equal(created.status, 201);
  const pid = created.json.polynomial.id as string;

  const bad = await jsonRequest('POST', '/polynomials', { coefficients: ['nope'] });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_POLYNOMIAL');

  const count = await jsonRequest('GET', `/polynomials/${pid}/roots-count?a=-100&b=100`);
  assert.equal(count.status, 200);
  assert.equal(count.json.distinctRootsInside, 3);

  const analysis = await jsonRequest('POST', `/polynomials/${pid}/analyses`, { width: '1/1000' });
  assert.equal(analysis.status, 201);
  assert.equal(analysis.json.version, 1);
  assert.equal(analysis.json.outcome.totalRealRoots, 3);
  assert.equal(analysis.json.outcome.pendingCount, 0);
  const aid = analysis.json.analysisId as string;

  const roots = await jsonRequest('GET', `/analyses/${aid}/roots?limit=2&offset=0`);
  assert.equal(roots.status, 200);
  assert.equal((roots.json.items as unknown[]).length, 2);
  assert.equal(roots.json.total, 3);

  const proof = await jsonRequest('POST', `/analyses/${aid}/proof-summary`, {});
  assert.equal(proof.status, 201);
  assert.equal(proof.json.completenessClaim, true);
});

test('endpoint root counting excludes the endpoints', async () => {
  const created = await jsonRequest('POST', '/polynomials', { coefficients: ['0', '-3', '4', '-1'] });
  const pid = created.json.polynomial.id as string;
  const inside = await jsonRequest('GET', `/polynomials/${pid}/roots-count?a=0&b=3`);
  assert.equal(inside.json.distinctRootsInside, 1);
  assert.deepEqual(inside.json.endpoints, { loIsRoot: true, hiIsRoot: true });
  assert.equal(inside.json.byMultiplicity[1], 1);
});

test('idempotency key deduplicates concurrent-equivalent submissions', async () => {
  const created = await jsonRequest('POST', '/polynomials', { coefficients: ['1', '0', '1'] });
  const pid = created.json.polynomial.id as string;
  const first = await jsonRequest('POST', `/polynomials/${pid}/analyses`, { width: '1/100' }, { 'Idempotency-Key': 'abc' });
  const second = await jsonRequest('POST', `/polynomials/${pid}/analyses`, { width: '1/100' }, { 'Idempotency-Key': 'abc' });
  assert.equal(first.json.analysisId, second.json.analysisId);
  assert.equal(second.json.created, false);
});

test('unknown routes and missing resources return explicit codes', async () => {
  const notFound = await jsonRequest('GET', '/polynomials/does-not-exist');
  assert.equal(notFound.status, 404);
  assert.equal(notFound.json.code, 'POLYNOMIAL_NOT_FOUND');
  const route = await jsonRequest('GET', '/nope');
  assert.equal(route.status, 404);
  assert.equal(route.json.code, 'NOT_FOUND');
  const badPage = await jsonRequest('GET', '/polynomials?limit=9999');
  assert.equal(badPage.status, 400);
  assert.equal(badPage.json.code, 'INVALID_PAGINATION');
});

test('sign endpoints and invalid fraction handling', async () => {
  const created = await jsonRequest('POST', '/polynomials', { coefficients: ['0', '0', '1'] });
  const pid = created.json.polynomial.id as string;
  const point = await jsonRequest('GET', `/polynomials/${pid}/sign-point?x=2/3`);
  assert.equal(point.json.sign, 1);
  assert.equal(point.json.evaluated, '4/9');
  const bad = await jsonRequest('GET', `/polynomials/${pid}/sign-point?x=foo`);
  assert.equal(bad.status, 400);
  assert.equal(bad.json.code, 'INVALID_FRACTION');
  const interval = await jsonRequest('GET', `/polynomials/${pid}/sign-interval?a=1&b=2`);
  assert.equal(interval.json.sign, 1);
});


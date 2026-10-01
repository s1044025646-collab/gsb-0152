import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { openDatabase, parsePage } from '../src/db/database.ts';
import type { DatabaseSync } from 'node:sqlite';
import { Repository, type Clock } from '../src/db/repo.ts';
import { PolyService } from '../src/service.ts';
import { Frac } from '../src/algebra/frac.ts';

function tempDb(): string {
  return join(tmpdir(), `poly-test-${Math.random().toString(36).slice(2)}-${Date.now()}.db`);
}

interface Harness {
  path: string;
  service: PolyService;
  db: DatabaseSync;
  close(): void;
}

function makeService(path: string, clock?: Clock): Harness {
  const db = openDatabase(path);
  return { path, service: new PolyService(new Repository(db, clock)), db, close: () => db.close() };
}

function cleanup(path: string): void {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
      return;
    } catch (err) {
      if (attempt === 4) return;
    }
  }
}

test('polynomial creation is canonical/deduplicated and persists across reopen', () => {
  const path = tempDb();
  try {
    const h1 = makeService(path);
    const a = h1.service.createPolynomial(['2/4', '0', '1']);
    const b = h1.service.createPolynomial(['1/2', '0', '1']);
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.polynomial.id, b.polynomial.id);

    h1.close();
    const reopened = makeService(path);
    const fetched = reopened.service.getPolynomial(a.polynomial.id);
    assert.deepEqual(fetched.coefficients, ['1/2', '0', '1']);
    reopened.close();
  } finally {
    cleanup(path);
  }
});

test('parameter revisions append versions and never overwrite old results', () => {
  const path = tempDb();
  try {
    const harness = makeService(path);
    const svc = harness.service;
    const pid = svc.createPolynomial(['-2', '0', '1']).polynomial.id;
    const v1 = svc.createAnalysis(pid, { width: '1/10' });
    const v2 = svc.refine(pid, { width: '1/100000' });
    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    const roots1 = svc.listRoots(v1.analysisId as string, 50, 0);
    const w1 = String(roots1.items[0]!.width);
    const roots2 = svc.listRoots(v2.analysisId as string, 50, 0);
    const w2 = String(roots2.items[0]!.width);
    assert.ok(Frac.parse(w2).cmp(Frac.parse(w1)) < 0, 'v2 narrower while v1 intact');
    const comparison = svc.compareVersions(pid, 1, 2);
    assert.equal(comparison.sameRootCount, true);
    harness.close();
  } finally {
    cleanup(path);
  }
});

test('repeated submission with idempotency key returns the same version', () => {
  const path = tempDb();
  try {
    const harness = makeService(path);
    const svc = harness.service;
    const pid = svc.createPolynomial(['-2', '0', '1']).polynomial.id;
    const first = svc.createAnalysis(pid, { width: '1/100' }, 'key-123');
    const second = svc.createAnalysis(pid, { width: '1/100' }, 'key-123');
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.analysisId, second.analysisId);
    const third = svc.createAnalysis(pid, { width: '1/100' }, 'other-key');
    assert.equal(third.created, true);
    harness.close();
  } finally {
    cleanup(path);
  }
});

test('failed analysis rolls back and leaves no partial rows', () => {
  const path = tempDb();
  const db = openDatabase(path);
  try {
    const repo = new Repository(db);
    const svc = new PolyService(repo);
    const pid = svc.createPolynomial(['-2', '0', '1']).polynomial.id;
    assert.throws(() => svc.createAnalysis(pid, { maxIterations: -5 }));
    const analyses = (db.prepare('SELECT COUNT(*) AS c FROM analyses').get() as { c: number }).c;
    const roots = (db.prepare('SELECT COUNT(*) AS c FROM roots').get() as { c: number }).c;
    assert.equal(Number(analyses), 0);
    assert.equal(Number(roots), 0);
  } finally {
    db.close();
    cleanup(path);
  }
});

test('transaction rollback on simulated write failure preserves prior state', () => {
  const path = tempDb();
  const db = openDatabase(path);
  try {
    const repo = new Repository(db);
    const svc = new PolyService(repo);
    const pid = svc.createPolynomial(['-2', '0', '1']).polynomial.id;
    svc.createAnalysis(pid, { width: '1/10' });
    // Corrupt the roots table so the next multi-row transaction fails mid-way.
    db.exec('DROP TABLE roots');
    assert.throws(() => svc.createAnalysis(pid, { width: '1/100' }));
    const surviving = (
      db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE poly_id = ?').get(pid) as { c: number }
    ).c;
    assert.equal(Number(surviving), 1, 'only the original committed version remains');
  } finally {
    db.close();
    cleanup(path);
  }
});

test('restart after commit restores analyses, roots and proof summaries', () => {
  const path = tempDb();
  try {
    let harness = makeService(path);
    const pid = harness.service.createPolynomial(['-6', '13', '-7', '-1', '1']).polynomial.id;
    const analysis = harness.service.createAnalysis(pid, { width: '1/1000' });
    harness.service.proofSummary(analysis.analysisId as string);

    harness.close();
    harness = makeService(path); // simulated restart
    const reloaded = harness.service.getAnalysis(analysis.analysisId as string);
    assert.equal(reloaded.totalRealRoots, 3);
    assert.equal(reloaded.pendingCount, 0);
    const roots = harness.service.listRoots(analysis.analysisId as string, 50, 0);
    assert.equal(roots.total, 3);
    harness.close();
  } finally {
    cleanup(path);
  }
});

test('pagination bounds and error codes are enforced', () => {
  const path = tempDb();
  try {
    const harness = makeService(path);
    const svc = harness.service;
    svc.createPolynomial(['1', '0', '1']);
    assert.throws(() => parsePage({ limit: '0' }), /INVALID_PAGINATION/);
    assert.throws(() => parsePage({ limit: '500' }), /INVALID_PAGINATION/);
    assert.throws(() => parsePage({ limit: 'x' }), /INVALID_PAGINATION/);
    const page = svc.listPolynomials(1, 0);
    assert.equal(page.limit, 1);
    assert.throws(() => svc.getPolynomial('missing'), (err: { code?: string }) => err.code === 'POLYNOMIAL_NOT_FOUND');
    assert.throws(
      () => svc.createPolynomial(['bad']),
      (err: { code?: string }) => err.code === 'INVALID_POLYNOMIAL',
    );
    assert.throws(
      () => svc.createPolynomial(new Array(14).fill('1')),
      (err: { code?: string }) => err.code === 'INVALID_POLYNOMIAL',
    );
    assert.doesNotThrow(() => svc.createPolynomial(new Array(13).fill('1')));
    harness.close();
  } finally {
    cleanup(path);
  }
});

test('injected clock controls timestamps deterministically', () => {
  const path = tempDb();
  let counter = 0;
  const clock: Clock = {
    now: () => '2024-01-01T00:00:00.000Z',
    uuid: () => `fixed-uuid-${counter++}`,
  };
  try {
    const harness = makeService(path, clock);
    const created = harness.service.createPolynomial(['1', '0', '1']);
    assert.match(created.polynomial.id, /^fixed-uuid-/);
    assert.equal(created.polynomial.createdAt, '2024-01-01T00:00:00.000Z');
    harness.close();
  } finally {
    cleanup(path);
  }
});

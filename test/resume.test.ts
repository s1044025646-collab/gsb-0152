import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Repo } from '../src/db/repo.js';
import { Service } from '../src/service/service.js';
import { migrate } from '../src/db/migrate.js';
import { parsePoly } from '../src/core/poly.js';
import { fcmp, fracToString, parseFrac } from '../src/core/frac.js';

function svc() {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  return { db, svc: new Service(new Repo(db)) };
}

test('interruption then resume: undecided intervals later become isolated', () => {
  const { svc: service } = svc();
  const { row } = service.createPolynomial({
    coefficients: ['1/100010000', '-20001/100010000', '1'],
  });
  // Tiny budget: must leave undecided intervals and NOT claim completeness.
  const first = service.analyze(row.id, {
    maxWidth: '1/1000000000000', maxIterations: 4, maxBits: 6000, requestKey: 'phase1',
  });
  assert.ok(first.run.undecidedCount >= 1);
  const firstIntervals = first.intervals.map((iv) => ({
    left: fracToString(iv.left), right: fracToString(iv.right), status: iv.status,
  }));
  // Resume with a much larger budget under a new version.
  const second = service.analyze(row.id, {
    maxWidth: '1/1000000000000', maxIterations: 200000, maxBits: 6000, requestKey: 'phase2',
  });
  assert.equal(second.run.undecidedCount, 0);
  assert.equal(second.run.totalRealRoots, 2);
  assert.equal(second.run.version, first.run.version + 1);
  // Containment: refined intervals sit inside the original undecided brackets.
  const undecided = firstIntervals.filter((i) => i.status === 'undecided');
  assert.ok(undecided.length >= 1);
  for (const refined of second.intervals) {
    const contained = undecided.some((u) =>
      fcmp(parseFrac(fracToString(refined.left)), parseFrac(u.left)) >= 0 &&
      fcmp(parseFrac(fracToString(refined.right)), parseFrac(u.right)) <= 0);
    assert.ok(contained, `refined interval ${fracToString(refined.left)} not inside an earlier bracket`);
  }
  // First version retained and unchanged.
  const v1 = service.getRun(row.id, 1);
  assert.equal(v1.run.undecidedCount >= 1, true);
});

test('resume with identical request key is idempotent even when undecided', () => {
  const { svc: service } = svc();
  const { row } = service.createPolynomial({
    coefficients: ['1/100010000', '-20001/100010000', '1'],
  });
  const a = service.analyze(row.id, { maxWidth: '1/1000000000000', maxIterations: 4, maxBits: 6000, requestKey: 'same' });
  const b = service.analyze(row.id, { maxWidth: '1/1000000000000', maxIterations: 4, maxBits: 6000, requestKey: 'same' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(a.run.id, b.run.id);
});

test('parse helper sanity for resume test', () => {
  assert.equal(parsePoly(['1', '0', '1']).length, 3);
});

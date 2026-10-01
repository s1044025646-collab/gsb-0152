import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allFixtures, makeRng } from '../src/generator/index.js';
import { parsePoly } from '../src/core/poly.js';
import { squareFree } from '../src/core/squarefree.js';
import { isolateFactors } from '../src/core/isolation.js';
import { parseFrac, fcmp } from '../src/core/frac.js';
import { sturmCountAll, sturmSequence } from '../src/core/sturm.js';

const tight = { maxWidth: parseFrac('1/1000000000'), maxIterations: 50000, maxBits: 3000 };

test('every fixture isolates the independently known number of distinct roots', () => {
  for (const fx of allFixtures()) {
    const p = parsePoly(fx.coefficients);
    // Independent whole-line count straight from the Sturm chain.
    const chainCount = sturmCountAll(p, sturmSequence(p));
    assert.equal(chainCount, fx.expectedDistinctRealRoots, `chain count ${fx.name}`);
    const sf = squareFree(p);
    const out = isolateFactors(sf.factors, tight);
    assert.equal(out.totalRealRoots, fx.expectedDistinctRealRoots, `total ${fx.name}`);
    assert.equal(out.undecidedCount, 0, `undecided ${fx.name}`);
    // Multiplicities must match the known factor product.
    const gotMult = new Map<number, number>();
    for (const iv of out.intervals) gotMult.set(iv.multiplicity, (gotMult.get(iv.multiplicity) ?? 0) + 1);
    const wantMult = new Map<number, number>();
    for (const key of Object.keys(fx.expectedMultiplicity)) {
      const m = fx.expectedMultiplicity[key];
      wantMult.set(m, (wantMult.get(m) ?? 0) + 1);
    }
    for (const [m, n] of wantMult) assert.equal(gotMult.get(m), n, `${fx.name} multiplicity ${m}`);
    // All intervals pairwise disjoint (touching at exact-root points excluded).
    const ivs = out.intervals.filter((i) => i.status !== 'exact-root');
    for (let i = 1; i < ivs.length; i++) {
      assert.ok(fcmp(ivs[i - 1].right, ivs[i].left) <= 0, `disjoint ${fx.name}`);
    }
  }
});

test('close-roots fixture actually separates roots beyond float epsilon', () => {
  const fx = allFixtures().find((c) => c.name === 'close-roots')!;
  const p = parsePoly(fx.coefficients);
  const out = isolateFactors(squareFree(p).factors, tight);
  assert.equal(out.intervals.length, 2);
  const [a, b] = out.intervals;
  // Distinct roots: intervals are disjoint or merely touching at a boundary.
  assert.ok(fcmp(a.right, b.left) <= 0);
  // And the two enclosed midpoint approximations are clearly distinct.
  const mid = (l: typeof a.left, r: typeof a.right) =>
    (l.n * r.d + r.n * l.d) * 1_000_000_000_000n / (2n * l.d * r.d);
  assert.notEqual(mid(a.left, a.right), mid(b.left, b.right));
});

test('rng is deterministic', () => {
  const a = makeRng(123);
  const b = makeRng(123);
  for (let i = 0; i < 10; i++) assert.equal(a(), b());
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  frac, parseFrac, fadd, fmul, fdiv, fcmp, fsign, fracToString, fracToDecimal,
} from '../src/core/frac.js';
import {
  parsePoly, pmul, polyDivExact, polyGcd, derivative, peval, psignAt,
  primitiveIntegers, polyToPretty,
} from '../src/core/poly.js';
import { squareFree } from '../src/core/squarefree.js';
import { sturmSequence, sturmCountIn, sturmCountAll } from '../src/core/sturm.js';
import { isolateFactors, cauchyBound, fmt, AnalysisParams } from '../src/core/isolation.js';
import { buildProof, recomposeCheck } from '../src/core/proof.js';
import { signOnInterval } from '../src/core/sign.js';

const tight: AnalysisParams = { maxWidth: parseFrac('1/1000000000'), maxIterations: 20000, maxBits: 2000 };

test('rational arithmetic is exact and canonical', () => {
  const a = parseFrac('2/4');
  assert.equal(fracToString(a), '1/2');
  assert.equal(fracToString(fadd(parseFrac('1/3'), parseFrac('1/6'))), '1/2');
  assert.equal(fracToString(fmul(parseFrac('3/7'), parseFrac('14/9'))), '2/3');
  assert.equal(fracToString(fdiv(frac(1n), parseFrac('1/5'))), '5');
  assert.equal(fcmp(parseFrac('-1/2'), parseFrac('1/2')), -1);
  assert.throws(() => parseFrac('0.5'), /DECIMAL/);
  assert.throws(() => parseFrac('1/0'), /ZERO_DENOMINATOR/);
});

test('division and gcd are exact over Q', () => {
  // (x-1)^2 (x+2) / (x-1) = (x-1)(x+2) = x^2+x-2
  const f = parsePoly(['2', '-3', '0', '1']);
  const d = parsePoly(['-1', '1']);
  const q = polyDivExact(f, d);
  assert.deepEqual(q.map(fracToString), ['-2', '1', '1']);
  const g = polyGcd(f, derivative(f));
  assert.deepEqual(primitiveIntegers(g).map(String), ['-1', '1']);
});

test('square-free decomposition reports correct multiplicities', () => {
  // (2x-3)^3 (x+1)^2
  const f = parsePoly(['-3/2', '1']);
  const g = parsePoly(['1', '1']);
  const p = pmul(pmul(pmul(f, f), f), pmul(g, g));
  const sf = squareFree(p);
  const map = new Map(sf.factors.map((z) => [z.multiplicity, primitiveIntegers(z.factor).map(String)]));
  assert.deepEqual(map.get(2), ['1', '1']);
  assert.deepEqual(map.get(3), ['-3', '2']);
  const chk = recomposeCheck(p, sf.factors);
  assert.equal(chk.ok, true);
});

test('x^2 is one distinct root of multiplicity 2 (even root not missed)', () => {
  const p = parsePoly(['0', '0', '1']);
  const sf = squareFree(p);
  assert.equal(sf.factors.length, 1);
  assert.equal(sf.factors[0].multiplicity, 2);
  const out = isolateFactors(sf.factors, tight);
  assert.equal(out.totalRealRoots, 1);
  assert.equal(out.undecidedCount, 0);
  assert.equal(out.intervals[0].status, 'exact-root');
  assert.equal(fmt(out.intervals[0].left), '0');
});

test('no real roots case', () => {
  const p = pmul(pmul(parsePoly(['1', '0', '1']), parsePoly(['1', '0', '1'])), parsePoly(['2', '0', '1']));
  assert.equal(sturmCountAll(p, sturmSequence(p)), 0);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, tight);
  assert.equal(out.totalRealRoots, 0);
  assert.equal(out.intervals.length, 0);
});

test('zero root and endpoint roots', () => {
  // x(x-1)(x+1)
  const p = parsePoly(['0', '-1', '0', '1']);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, tight);
  assert.equal(out.totalRealRoots, 3);
  assert.equal(out.undecidedCount, 0);
  const exact = out.intervals.map((i) => fmt(i.left));
  assert.deepEqual(exact.sort((a, b) => Number(a) - Number(b)), ['-1', '0', '1']);
});

test('irrational roots isolated to required width', () => {
  const p = parsePoly(['-2', '0', '1']);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/1000000'), maxIterations: 5000, maxBits: 500 });
  assert.equal(out.totalRealRoots, 2);
  assert.equal(out.undecidedCount, 0);
  for (const iv of out.intervals) {
    assert.equal(fcmp(iv.width, parseFrac('1/1000000')) <= 0, true);
    // Endpoint values for x^2-2 bracket zero (opposite signs) on a simple root.
    const lv = peval(p, iv.left);
    const rv = peval(p, iv.right);
    assert.ok(fsign(lv) * fsign(rv) <= 0);
  }
});

test('very close rational roots are both isolated', () => {
  const a = parsePoly(['-1/10000', '1']);
  const b = parsePoly(['-1/10001', '1']);
  const p = pmul(a, b);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, tight);
  assert.equal(out.totalRealRoots, 2);
  assert.equal(out.undecidedCount, 0);
  assert.notEqual(fmt(out.intervals[0].left), fmt(out.intervals[1].left));
  // disjoint
  assert.ok(fcmp(out.intervals[0].right, out.intervals[1].left) <= 0);
});

test('scaling invariance: multiplying by a rational scalar changes nothing', () => {
  const base = parsePoly(['2', '-3', '0', '1']);
  const scaled = base.map((c) => fmul(c, parseFrac('123456789/987654321')));
  for (const p of [base, scaled]) {
    const sf = squareFree(p);
    const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/1000000'), maxIterations: 5000, maxBits: 800 });
    // (x-1)^2(x+2): two DISTINCT real roots (-2 and 1).
    assert.equal(out.totalRealRoots, 2);
    assert.equal(out.undecidedCount, 0);
    const mults = out.intervals.map((i) => i.multiplicity).sort();
    assert.deepEqual(mults, [1, 2]);
  }
});

test('sign variation count on a known Sturm chain', () => {
  // x^3 - x on [-2,2] has 3 roots; [0,2] has 1 (at 1).
  const p = parsePoly(['0', '-1', '0', '1']);
  const seq = sturmSequence(p);
  assert.equal(sturmCountIn(p, parseFrac('-2'), parseFrac('2'), seq), 3);
  assert.equal(sturmCountIn(p, parseFrac('0'), parseFrac('2'), seq), 1);
});

test('budget exhaustion keeps undecided intervals and does not claim completeness', () => {
  const a = parsePoly(['-1/10000', '1']);
  const b = parsePoly(['-1/10001', '1']);
  const p = pmul(a, b);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/1000000000000'), maxIterations: 4, maxBits: 5000 });
  assert.ok(out.undecidedCount >= 1);
  assert.ok(out.exhausted.iterations || out.exhausted.bits);
  assert.ok(out.intervals.some((i) => i.status === 'undecided'));
});

test('refinement containment: tighter intervals stay inside earlier ones', () => {
  const p = parsePoly(['-2', '0', '1']);
  const sf = squareFree(p);
  const coarse = isolateFactors(sf.factors, { maxWidth: parseFrac('1/1000'), maxIterations: 5000, maxBits: 500 });
  const fine = isolateFactors(sf.factors, { maxWidth: parseFrac('1/1000000'), maxIterations: 5000, maxBits: 500 });
  assert.equal(coarse.intervals.length, fine.intervals.length);
  for (let i = 0; i < fine.intervals.length; i++) {
    const c = coarse.intervals[i];
    const n = fine.intervals[i];
    assert.ok(fcmp(n.left, c.left) >= 0);
    assert.ok(fcmp(n.right, c.right) <= 0);
  }
});

test('sign report on a certified root-free open interval', () => {
  const p = parsePoly(['-2', '0', '1']);
  // interval well above sqrt2 -> positive
  const r = signOnInterval(p, parseFrac('2'), parseFrac('3'));
  assert.equal(r.interiorLabel, 'positive');
  assert.throws(() => signOnInterval(p, parseFrac('2'), parseFrac('1')), /BAD_INTERVAL/);
});

test('proof recomposes and declares completeness only when deserved', () => {
  const p = parsePoly(['0', '-1', '0', '1']);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, tight);
  const proof = buildProof(p, sf.factors, out.intervals, out.totalRealRoots, out.isolatedCount, out.undecidedCount);
  assert.equal(proof.recomposition.ok, true);
  assert.match(proof.declaration, /All 3/);
  assert.ok(proof.sturmChains.length >= 1);
});

test('Cauchy bound strictly encloses every root', () => {
  const p = parsePoly(['2', '-3', '0', '1']);
  const R = cauchyBound(p);
  for (const r of ['1', '-2']) {
    const x = parseFrac(r);
    assert.ok(fcmp(R, { n: x.n < 0n ? -x.n : x.n, d: x.d }) >= 0);
  }
  assert.equal(psignAt(p, parseFrac('1')), 0);
  void polyToPretty;
});

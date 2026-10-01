import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Frac } from '../src/algebra/frac.ts';
import { Poly, linearFactor, polyFromInts, parsePolyCoeffs } from '../src/algebra/poly.ts';
import {
  sturmSequence,
  countRootsReal,
  countRootsOpen,
  isolateIn,
} from '../src/algebra/sturm.ts';
import {
  analyzePolynomial,
  coefficientSignVariations,
  signOnInterval,
  DEFAULT_PARAMS,
} from '../src/algebra/isolator.ts';
import { generateCases, productOfRoots, scalePolynomial } from '../src/generator.ts';

test('Frac canonicalizes and supports exact arithmetic', () => {
  assert.equal(Frac.parse(' 4 / -10 ').toString(), '-2/5');
  assert.equal(Frac.from(6n, 4n).toString(), '3/2');
  assert.equal(Frac.parse('1/3').add(Frac.parse('2/3')).toString(), '1');
  assert.equal(Frac.parse('2/7').mul(Frac.parse('14/3')).toString(), '4/3');
  assert.throws(() => Frac.parse('1/0'));
  assert.throws(() => Frac.parse('a'));
});

test('exact polynomial division and GCD', () => {
  const f = polyFromInts(0, 0, 1).mul(polyFromInts(-1, 1));
  const g = polyFromInts(0, 1); // x
  const gcd = Poly.gcd(f, f.derivative());
  assert.equal(gcd.toString(), 'x');
  const { q, r } = f.divmod(linearFactor(Frac.ONE));
  assert.equal(r.isZero(), true);
  assert.ok(q.degree() === 2);
  void g;
});

test('square-free decomposition reports correct multiplicities', () => {
  const cases = generateCases().filter((c) => c.name !== 'irrational-conjugate-pair');
  for (const c of cases) {
    const { factors } = c.poly.squareFree();
    const found = new Map<string, number>();
    for (const { factor, multiplicity } of factors) {
      // For rational-root fixtures, verify each known root lands in exactly one
      // factor with the right multiplicity.
      for (const truth of c.realRoots) {
        if (factor.eval(truth.root).isZero()) {
          assert.equal(
            found.get(truth.root.toString()),
            undefined,
            `${c.name}: root ${truth.root} appeared in two factors`,
          );
          found.set(truth.root.toString(), multiplicity);
          assert.equal(multiplicity, truth.multiplicity, `${c.name}: multiplicity ${truth.root}`);
        }
      }
    }
    for (const truth of c.realRoots) {
      assert.ok(found.has(truth.root.toString()), `${c.name}: missing root ${truth.root}`);
    }
  }
});

test('independent factor-product cross-check of counts and multiplicities', () => {
  for (const c of generateCases().filter((x) => x.name !== 'irrational-conjugate-pair')) {
    const outcome = analyzePolynomial(c.poly, { ...DEFAULT_PARAMS, width: '1/100000000' });
    assert.equal(
      outcome.totalRealRoots,
      c.realRoots.length,
      `${c.name}: total real root count`,
    );
    assert.equal(outcome.pendingCount, 0, `${c.name}: should fully isolate`);
    assert.equal(outcome.isolatedCount, c.realRoots.length, `${c.name}: isolated count`);
    // Each rational truth root must be represented exactly, disjointly.
    const sorted = [...c.realRoots].sort((a, b) => a.root.cmp(b.root));
    for (let i = 0; i < sorted.length; i++) {
      const record = outcome.isolatedRoots[i]!;
      const truth = sorted[i]!;
      assert.equal(record.multiplicity, truth.multiplicity, `${c.name} mult at index ${i}`);
      if (record.kind === 'exact') {
        assert.equal(Frac.parse(record.exact!).cmp(truth.root), 0);
      } else {
        const lo = Frac.parse(record.lo);
        const hi = Frac.parse(record.hi);
        assert.equal(lo.cmp(truth.root) < 0 && truth.root.cmp(hi) < 0, true, `${c.name} containment`);
      }
    }
    // Disjointness of all reported intervals.
    for (let i = 1; i < outcome.isolatedRoots.length; i++) {
      const prev = outcome.isolatedRoots[i - 1]!;
      const cur = outcome.isolatedRoots[i]!;
      assert.ok(Frac.parse(prev.hi).cmp(Frac.parse(cur.lo)) <= 0, `${c.name}: disjoint`);
    }
  }
});

test('isolation is invariant under non-zero rational scaling', () => {
  const c = generateCases().find((x) => x.name === 'large-numerator-denominator')!;
  const scaled = scalePolynomial(c.poly, Frac.parse('-123456789/987654321'));
  const a = analyzePolynomial(c.poly, { ...DEFAULT_PARAMS, width: '1/100000' });
  const b = analyzePolynomial(scaled, { ...DEFAULT_PARAMS, width: '1/100000' });
  assert.equal(a.totalRealRoots, b.totalRealRoots);
  assert.equal(a.isolatedCount, b.isolatedCount);
  assert.deepEqual(
    a.isolatedRoots.map((r) => [r.exact, r.lo, r.hi, r.multiplicity]),
    b.isolatedRoots.map((r) => [r.exact, r.lo, r.hi, r.multiplicity]),
  );
});

test('Sturm counts exclude endpoints and handle open intervals', () => {
  // x(x-1)(x-2)
  const p = productOfRoots([
    { root: Frac.ZERO, multiplicity: 1 },
    { root: Frac.ONE, multiplicity: 1 },
    { root: Frac.from(2n), multiplicity: 1 },
  ]);
  const seq = sturmSequence(p);
  assert.equal(countRootsReal(seq), 3);
  assert.equal(countRootsOpen(p, seq, Frac.ZERO, Frac.from(2n)), 1); // only x=1 inside
  assert.equal(countRootsOpen(p, seq, Frac.ZERO, Frac.ONE), 0);
  assert.equal(countRootsOpen(p, seq, Frac.from(-5n), Frac.from(5n)), 3);
});

test('no-real-root and constant/zero semantics', () => {
  assert.equal(countRootsReal(sturmSequence(polyFromInts(1, 0, 1))), 0);
  const constant = analyzePolynomial(polyFromInts(7), DEFAULT_PARAMS);
  assert.equal(constant.isConstant, true);
  assert.equal(constant.totalRealRoots, 0);
  const zero = analyzePolynomial(Poly.ZERO, DEFAULT_PARAMS);
  assert.equal(zero.isZeroPolynomial, true);
  assert.equal(zero.totalRealRoots, null);
});

test('even-multiplicity roots are not missed (no sign-sampling reliance)', () => {
  const p = linearFactor(Frac.from(5n)).mul(linearFactor(Frac.from(5n))); // (x-5)^2
  const outcome = analyzePolynomial(p, { ...DEFAULT_PARAMS, width: '1/1000' });
  assert.equal(outcome.totalRealRoots, 1);
  assert.equal(outcome.isolatedRoots[0]!.multiplicity, 2);
});

test('sign queries are exact and conservative across roots', () => {
  const p = polyFromInts(0, 0, 1); // x^2
  assert.equal(signOnInterval(p, Frac.ONE, Frac.from(2n)).sign, 1);
  assert.equal(signOnInterval(p, Frac.from(-2n), Frac.from(-1n)).sign, 1);
  const cross = signOnInterval(p, Frac.from(-1n), Frac.ONE);
  assert.equal(cross.sign, 'unknown');
  assert.equal(cross.rootsInside, 1);
  assert.deepEqual(cross.endpointRoots, []);
  const touching = signOnInterval(p, Frac.ZERO, Frac.ONE);
  assert.equal(touching.sign, 'unknown');
  assert.deepEqual(touching.endpointRoots, ['lo']);
});

test('Descartes sign variation counting', () => {
  assert.equal(coefficientSignVariations(polyFromInts(-6, 13, -7, -1, 1)), 3);
  assert.equal(coefficientSignVariations(polyFromInts(1, 0, 1)), 0);
});

test('refinement preserves containment and shrinks width', () => {
  const p = polyFromInts(-2, 0, 1); // x^2 - 2, irrational roots
  const coarse = analyzePolynomial(p, { ...DEFAULT_PARAMS, width: '1/10' });
  const fine = analyzePolynomial(p, { ...DEFAULT_PARAMS, width: '1/100000' });
  assert.equal(coarse.isolatedCount, 2);
  assert.equal(fine.isolatedCount, 2);
  for (let i = 0; i < 2; i++) {
    const c = coarse.isolatedRoots[i]!;
    const f = fine.isolatedRoots[i]!;
    assert.ok(Frac.parse(c.lo).cmp(Frac.parse(f.lo)) <= 0, 'fine lo inside coarse');
    assert.ok(Frac.parse(f.hi).cmp(Frac.parse(c.hi)) <= 0, 'fine hi inside coarse');
    assert.ok(Frac.parse(f.width).cmp(Frac.parse(c.width)) < 0, 'fine is narrower');
  }
});

test('budget exhaustion keeps unresolved regions and does not claim completeness', () => {
  const c = generateCases().find((x) => x.name === 'close-roots')!;
  const outcome = isolateIn(
    sturmSequence(c.poly),
    Frac.from(-1n),
    Frac.ONE,
    Frac.parse('1/1000000000000'),
    { maxIterations: 5, maxBits: 1_000_000 },
  );
  assert.equal(outcome.budgetExhausted, true);
  assert.ok(outcome.unresolved.length > 0);
});

test('parser enforces degree limit and rejects bad input', () => {
  assert.throws(() => parsePolyCoeffs(new Array(14).fill('1'), 12));
  assert.throws(() => parsePolyCoeffs(['1', 'x']));
  assert.throws(() => parsePolyCoeffs('1,2'));
  assert.doesNotThrow(() => parsePolyCoeffs(['0', '0', '0'], 12));
});

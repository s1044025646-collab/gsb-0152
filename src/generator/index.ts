import { Frac, frac, fracToString, parseFrac } from '../core/frac.js';
import { Poly, pmul, polyToCoeffStrings } from '../core/poly.js';
import { pathToFileURL } from 'node:url';

// Deterministic seeded PRNG (mulberry32) so generated examples are repeatable
// and no ambient randomness is used in tests.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LinearFactor {
  root: Frac;
  multiplicity: number;
}

// Build (a*x - b) whose root is b/a.
function linear(root: Frac): Poly {
  return [{ n: -root.n, d: root.d }, { n: 1n, d: 1n }];
}

export interface GeneratedCase {
  name: string;
  description: string;
  coefficients: string[];
  factors: { root: string; multiplicity: number }[];
  expectedDistinctRealRoots: number;
  expectedMultiplicity: Record<string, number>;
}

function fromFactors(factors: LinearFactor[]): {
  coefficients: string[]; factors: LinearFactor[];
} {
  let p: Poly = [{ n: 1n, d: 1n }];
  for (const { root, multiplicity } of factors) {
    const l = linear(root);
    for (let k = 0; k < multiplicity; k++) p = pmul(p, l);
  }
  return { coefficients: polyToCoeffStrings(p), factors };
}

export function noRealRootCase(): GeneratedCase {
  // (x^2+1)^2 (x^2+2): degree 6, zero real roots, even multiplicities would
  // defeat naive sign sampling (no sign change anywhere).
  const q1: Poly = [frac(1n), frac(0n), frac(1n)];
  const q2: Poly = [frac(2n), frac(0n), frac(1n)];
  let p = pmul(pmul(q1, q1), q2);
  return {
    name: 'no-real-roots',
    description: '(x^2+1)^2(x^2+2): no real roots; sign never changes, catches even-root samplers.',
    coefficients: polyToCoeffStrings(p),
    factors: [],
    expectedDistinctRealRoots: 0,
    expectedMultiplicity: {},
  };
}

export function repeatedRootCase(): GeneratedCase {
  const factors: LinearFactor[] = [
    { root: parseFrac('1/2'), multiplicity: 3 },
    { root: parseFrac('-3'), multiplicity: 2 },
    { root: parseFrac('7/4'), multiplicity: 1 },
  ];
  const built = fromFactors(factors);
  return {
    name: 'repeated-roots',
    description: '(2x-1)^3(x+3)^2(4x-7): roots 1/2 (mult 3), -3 (mult 2), 7/4 (mult 1).',
    coefficients: built.coefficients,
    factors: factors.map((f) => ({ root: fracToString(f.root), multiplicity: f.multiplicity })),
    expectedDistinctRealRoots: 3,
    expectedMultiplicity: { '1/2': 3, '-3': 2, '7/4': 1 },
  };
}

export function closeRootsCase(gapExp = 6): GeneratedCase {
  // Roots at 1/10^k and 1/10^k + 1/10^(k+gapExp): very close, rational.
  const k = 3;
  const r1 = parseFrac(`1/${'1' + '0'.repeat(k)}`);
  const delta = parseFrac(`1/${'1' + '0'.repeat(k + gapExp)}`);
  const r2 = { n: r1.n * delta.d + delta.n * r1.d, d: r1.d * delta.d } as Frac;
  const factors: LinearFactor[] = [
    { root: r1, multiplicity: 1 },
    { root: r2, multiplicity: 1 },
  ];
  const built = fromFactors(factors);
  return {
    name: 'close-roots',
    description: `Two roots separated by ${fracToString(delta)}; demands exact bisection beyond float precision.`,
    coefficients: built.coefficients,
    factors: factors.map((f) => ({ root: fracToString(f.root), multiplicity: f.multiplicity })),
    expectedDistinctRealRoots: 2,
    expectedMultiplicity: { [fracToString(r1)]: 1, [fracToString(r2)]: 1 },
  };
}

export function zeroRootCase(): GeneratedCase {
  // x^4 (x-1)^2: explicit zero root of multiplicity 4.
  const factors: LinearFactor[] = [
    { root: parseFrac('0'), multiplicity: 4 },
    { root: parseFrac('1'), multiplicity: 2 },
  ];
  const built = fromFactors(factors);
  return {
    name: 'zero-root',
    description: 'x^4(x-1)^2: root at exactly 0 with multiplicity 4.',
    coefficients: built.coefficients,
    factors: built.factors.map((f) => ({ root: fracToString(f.root), multiplicity: f.multiplicity })),
    expectedDistinctRealRoots: 2,
    expectedMultiplicity: { '0': 4, '1': 2 },
  };
}

export function bigNumDenCase(): GeneratedCase {
  // Roots with large numerator/denominator to exercise BigInt budgets.
  const r1 = parseFrac('1234567890123456789/987654321098765432');
  const r2 = parseFrac('-987654321098765433/135792468024681357');
  const factors: LinearFactor[] = [
    { root: r1, multiplicity: 1 },
    { root: r2, multiplicity: 2 },
  ];
  const built = fromFactors(factors);
  return {
    name: 'big-numerator-denominator',
    description: 'Linear factors with very large integer numerators and denominators.',
    coefficients: built.coefficients,
    factors: built.factors.map((f) => ({ root: fracToString(f.root), multiplicity: f.multiplicity })),
    expectedDistinctRealRoots: 2,
    expectedMultiplicity: { [fracToString(r1)]: 1, [fracToString(r2)]: 2 },
  };
}

export function endpointRootCase(): GeneratedCase {
  // Roots placed exactly at common query endpoints -2, 0 and 3/2.
  const factors: LinearFactor[] = [
    { root: parseFrac('-2'), multiplicity: 1 },
    { root: parseFrac('0'), multiplicity: 1 },
    { root: parseFrac('3/2'), multiplicity: 2 },
  ];
  const built = fromFactors(factors);
  return {
    name: 'endpoint-roots',
    description: '(x+2)x(2x-3)^2: roots land exactly on rational query endpoints.',
    coefficients: built.coefficients,
    factors: built.factors.map((f) => ({ root: fracToString(f.root), multiplicity: f.multiplicity })),
    expectedDistinctRealRoots: 3,
    expectedMultiplicity: { '-2': 1, '0': 1, '3/2': 2 },
  };
}

export function randomSquareFreeCase(seed: number, degree: number): GeneratedCase {
  if (degree > 12) throw new Error('GEN_DEGREE_TOO_HIGH');
  const rng = makeRng(seed);
  const roots = new Set<string>();
  const factors: LinearFactor[] = [];
  while (factors.length < degree) {
    const num = BigInt(Math.floor(rng() * 21) - 10);
    const den = BigInt(1 + Math.floor(rng() * 5));
    const r = frac(num, den);
    const key = fracToString(r);
    if (roots.has(key)) continue;
    roots.add(key);
    factors.push({ root: r, multiplicity: 1 });
  }
  const built = fromFactors(factors);
  return {
    name: `random-squarefree-seed${seed}-deg${degree}`,
    description: `Deterministic square-free product of ${degree} distinct rational linear factors (seed ${seed}).`,
    coefficients: built.coefficients,
    factors: built.factors.map((f) => ({ root: fracToString(f.root), multiplicity: f.multiplicity })),
    expectedDistinctRealRoots: degree,
    expectedMultiplicity: Object.fromEntries(
      factors.map((f) => [fracToString(f.root), f.multiplicity]),
    ),
  };
}

export function allFixtures(): GeneratedCase[] {
  return [
    noRealRootCase(),
    repeatedRootCase(),
    closeRootsCase(),
    zeroRootCase(),
    bigNumDenCase(),
    endpointRootCase(),
    randomSquareFreeCase(42, 5),
    randomSquareFreeCase(7, 12),
  ];
}

// CLI entry: emit fixtures as JSON to stdout (skipped when imported).
const isMain = (() => {
  return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
})();
if (isMain) {
  process.stdout.write(JSON.stringify(allFixtures(), null, 2));
  process.stdout.write('\n');
}

import { Frac, fone, fmul, feq, fracToString } from './frac.js';
import { Poly, pmul, polyDivExact, primitiveIntegers, peval, polyToPretty } from './poly.js';
import { SqfFactor } from './squarefree.js';
import { sturmSequence } from './sturm.js';
import { RootInterval, fmt } from './isolation.js';

// Recompose the original polynomial (up to a non-zero rational scalar) from
// the square-free factors and verify divisibility exactly. The scalar is
// recovered by comparing leading coefficients.
export function recomposeCheck(
  original: Poly, factors: SqfFactor[],
): { ok: boolean; scalar: string; detail: string } {
  let product: Poly = [fone()];
  for (const { factor, multiplicity } of factors) {
    let power: Poly = [fone()];
    for (let i = 0; i < multiplicity; i++) power = pmul(power, factor);
    product = pmul(product, power);
  }
  if (product.length === 0 && original.length === 0) {
    return { ok: true, scalar: '1', detail: 'Zero polynomial confirmed.' };
  }
  if (product.length !== original.length) {
    return { ok: false, scalar: '?', detail: 'Degree mismatch between original and factor product.' };
  }
  const scalar = (() => {
    const lcO = original[original.length - 1];
    const lcP = product[product.length - 1];
    return { n: lcO.n * lcP.d, d: lcO.d * lcP.n };
  })();
  const scaled = product.map((c) => fmul(c, { n: scalar.n, d: scalar.d }));
  for (let i = 0; i < original.length; i++) {
    if (!feq(scaled[i], original[i])) {
      return { ok: false, scalar: fracToString({ n: scalar.n, d: scalar.d }), detail: `Coefficient mismatch at degree ${i}.` };
    }
  }
  // Independent exact divisibility: product divides original.
  polyDivExact(original, product);
  return {
    ok: true,
    scalar: fracToString({ n: scalar.n, d: scalar.d }),
    detail: `Original = (${fracToString({ n: scalar.n, d: scalar.d })}) * product of factors; exact coefficient and divisibility checks pass.`,
  };
}

export interface ProofRecord {
  polynomialPretty: string;
  squareFree: { multiplicity: number; primitiveIntCoeffs: string[] }[];
  recomposition: { ok: boolean; scalar: string; detail: string };
  sturmChains: { factorPretty: string; chainLength: number; chainPretty: string[] }[];
  intervals: {
    multiplicity: number;
    status: string;
    left: string;
    right: string;
    justification: string;
  }[];
  totalRealRoots: number;
  isolatedRoots: number;
  undecidedRoots: number;
  declaration: string;
}

export function buildProof(
  original: Poly, factors: SqfFactor[], intervals: RootInterval[],
  totalRealRoots: number, isolatedRoots: number, undecidedRoots: number,
): ProofRecord {
  const recomposition = recomposeCheck(original, factors);
  const chains = factors.map(({ factor }) => {
    const seq = sturmSequence(factor);
    return {
      factorPretty: polyToPretty(factor),
      chainLength: seq.length,
      chainPretty: seq.map(polyToPretty),
    };
  });
  return {
    polynomialPretty: polyToPretty(original),
    squareFree: factors.map(({ factor, multiplicity }) => ({
      multiplicity,
      primitiveIntCoeffs: primitiveIntegers(factor).map((x) => `${x}`),
    })),
    recomposition,
    sturmChains: chains,
    intervals: intervals.map((iv) => ({
      multiplicity: iv.multiplicity,
      status: iv.status,
      left: fmt(iv.left),
      right: fmt(iv.right),
      justification: iv.reason,
    })),
    totalRealRoots,
    isolatedRoots,
    undecidedRoots,
    declaration: undecidedRoots === 0
      ? `All ${totalRealRoots} distinct real root(s) are isolated by exact rational intervals; every interval is justified by a Sturm sign-variation count or an exact evaluation.`
      : `${undecidedRoots} of ${totalRealRoots} distinct real root(s) remain UNDECIDED because a budget was exhausted; the root set is NOT claimed complete at target width.`,
  };
}

// Evaluate a polynomial exactly (used by the sign/evidence endpoints).
export function exactValue(p: Poly, x: Frac): string {
  return fracToString(peval(p, x));
}

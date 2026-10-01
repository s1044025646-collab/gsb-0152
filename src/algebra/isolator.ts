import { Frac } from './frac.ts';
import { Poly } from './poly.ts';
import {
  sturmSequence,
  countRootsReal,
  countRootsOpen,
  isolateIn,
  signAt,
  type IsolationBudget,
} from './sturm.ts';
import { extractRationalRoots } from './rational.ts';

export interface AnalysisParams {
  /** Rational fraction strings for the requested refinement width, e.g. "1/1000". */
  width: string;
  maxIterations: number;
  maxBits: number;
  /** Working bound for whole-axis isolation; roots outside stay unresolved. */
  bound: string;
}

export const DEFAULT_PARAMS: AnalysisParams = {
  width: '1/1000000',
  maxIterations: 5000,
  maxBits: 200000,
  bound: '1000000',
};

export interface RootRecord {
  id: string;
  kind: 'exact' | 'interval';
  multiplicity: number;
  lo: string;
  hi: string;
  exact: string | null;
  approx: string;
  width: string;
  /** Exact reason this interval is known to contain exactly one distinct root. */
  evidence: string;
  status: 'isolated' | 'unresolved';
}

export interface AnalysisOutcome {
  isZeroPolynomial: boolean;
  isConstant: boolean;
  degree: number;
  totalRealRoots: number | null;
  isolatedRoots: RootRecord[];
  unresolvedRegions: { lo: string; hi: string; multiplicity: number; reason: string }[];
  isolatedCount: number;
  pendingCount: number;
  iterations: number;
  budgetExhausted: boolean;
}

/**
 * Full analysis of a polynomial via its square-free decomposition.
 * Each square-free factor is isolated independently; the factor index gives the
 * multiplicity of every root it contains. This detects even-multiplicity roots
 * exactly because they survive in their own square-free factor — no sampling or
 * floating-point iteration is involved.
 */
export function analyzePolynomial(poly: Poly, params: AnalysisParams): AnalysisOutcome {
  if (poly.isZero()) {
    return {
      isZeroPolynomial: true,
      isConstant: true,
      degree: -1,
      totalRealRoots: null,
      isolatedRoots: [],
      unresolvedRegions: [],
      isolatedCount: 0,
      pendingCount: 0,
      iterations: 0,
      budgetExhausted: false,
    };
  }
  if (poly.isConstant()) {
    return {
      isZeroPolynomial: false,
      isConstant: true,
      degree: 0,
      totalRealRoots: 0,
      isolatedRoots: [],
      unresolvedRegions: [],
      isolatedCount: 0,
      pendingCount: 0,
      iterations: 0,
      budgetExhausted: false,
    };
  }

  const width = Frac.parse(params.width);
  if (width.sign() <= 0) throw new Error('INVALID_WIDTH');
  const bound = Frac.parse(params.bound);
  if (bound.sign() <= 0) throw new Error('INVALID_BOUND');
  const budget: IsolationBudget = {
    maxIterations: Math.trunc(params.maxIterations),
    maxBits: Math.trunc(params.maxBits),
  };
  if (budget.maxIterations <= 0 || budget.maxBits <= 0) throw new Error('INVALID_BUDGET');

  const { factors } = poly.squareFree();
  const isolatedRoots: RootRecord[] = [];
  const unresolvedRegions: AnalysisOutcome['unresolvedRegions'] = [];
  let totalRealRoots = 0;
  let isolatedCount = 0;
  let pendingCount = 0;
  let iterations = 0;
  let budgetExhausted = false;

  for (const { factor, multiplicity } of factors) {
    // Pull rational roots out exactly (rational-root theorem) before bisection.
    const { rationalRoots, remainder } = extractRationalRoots(factor);
    const remSeq = remainder.isConstant() ? null : sturmSequence(remainder);
    const remainderRealRoots = remSeq ? countRootsReal(remSeq) : 0;
    const factorRealRoots = rationalRoots.length + remainderRealRoots;
    totalRealRoots += factorRealRoots;
    let result = remSeq
      ? isolateIn(remSeq, bound.neg(), bound, width, budget)
      : { roots: [] as import('./sturm.ts').IsolatedRoot[], unresolved: [] as { lo: Frac; hi: Frac; reason: string }[], iterations: 0, budgetExhausted: false };
    for (const rr of rationalRoots) {
      result.roots.push({ kind: 'exact', exact: rr, lo: rr, hi: rr });
    }
    result.roots.sort((x, y) => x.lo.cmp(y.lo));
    iterations += result.iterations;
    budgetExhausted = budgetExhausted || result.budgetExhausted;

    for (const root of result.roots) {
      const id = `r${isolatedRoots.length + 1}`;
      if (root.kind === 'exact') {
        isolatedRoots.push({
          id,
          kind: 'exact',
          multiplicity,
          lo: root.exact!.toString(),
          hi: root.exact!.toString(),
          exact: root.exact!.toString(),
          approx: root.exact!.toDecimal(8),
          width: '0',
          evidence: `p(${root.exact!.toString()}) = 0 exactly by rational evaluation; square-free factor multiplicity ${multiplicity}`,
          status: 'isolated',
        });
      } else {
        const span = root.hi.sub(root.lo).abs();
        const signLo = signAt(factor, root.lo, 'right');
        const signHi = signAt(factor, root.hi, 'left');
        isolatedRoots.push({
          id,
          kind: 'interval',
          multiplicity,
          lo: root.lo.toString(),
          hi: root.hi.toString(),
          exact: null,
          approx: root.lo.add(root.hi).div(Frac.from(2n)).toDecimal(8),
          width: span.toString(),
          evidence:
            `Sturm variation count V(${root.lo.toString()}+) - V(${root.hi.toString()}-) = 1 ` +
            `for square-free factor of multiplicity ${multiplicity}; neither endpoint is a root; ` +
            `signs ${signLo} to ${signHi}; width ${span.toString()} <= ${width.toString()}`,
          status: 'isolated',
        });
      }
      isolatedCount += 1;
    }

    for (const u of result.unresolved) {
      const count = remSeq ? countRootsOpen(remainder, remSeq, u.lo, u.hi) : 0;
      pendingCount += count;
      unresolvedRegions.push({
        lo: u.lo.toString(),
        hi: u.hi.toString(),
        multiplicity,
        reason: u.reason,
      });
    }
    // Roots outside the working bound are also pending (cannot claim completeness).
    const accounted =
      result.roots.length +
      result.unresolved.reduce(
        (acc, u) => acc + (remSeq ? countRootsOpen(remainder, remSeq, u.lo, u.hi) : 0),
        0,
      );
    const outside = factorRealRoots - accounted;
    if (outside > 0) {
      pendingCount += outside;
      unresolvedRegions.push({
        lo: `(-inf, ${bound.neg().toString()}) U (${bound.toString()}, +inf)`,
        hi: '',
        multiplicity,
        reason: 'OUTSIDE_WORKING_BOUND',
      });
    }
  }

  isolatedRoots.sort((a, b) => Frac.parse(a.lo).cmp(Frac.parse(b.lo)));
  return {
    isZeroPolynomial: false,
    isConstant: false,
    degree: poly.degree(),
    totalRealRoots,
    isolatedRoots,
    unresolvedRegions,
    isolatedCount,
    pendingCount,
    iterations,
    budgetExhausted,
  };
}

export type SignResult = -1 | 0 | 1;

/** Exact sign of p at a rational point by direct evaluation. */
export function signAtPoint(poly: Poly, x: Frac): SignResult {
  return poly.eval(x).sign();
}

/**
 * Exact sign of p on an open interval (a, b). This is decisive only when p has
 * no root inside. `unknown` is returned (rather than a guessed sign) whenever
 * the interval contains a root or endpoints are roots, using exact Sturm
 * counting on each square-free factor.
 */
export function signOnInterval(
  poly: Poly,
  a: Frac,
  b: Frac,
): { sign: SignResult | 'unknown'; rootsInside: number; endpointRoots: ('lo' | 'hi')[] } {
  if (a.cmp(b) >= 0) throw new Error('INVALID_INTERVAL');
  if (poly.isZero()) {
    return { sign: 0, rootsInside: 0, endpointRoots: ['lo', 'hi'] };
  }
  const endpointRoots: ('lo' | 'hi')[] = [];
  if (poly.eval(a).isZero()) endpointRoots.push('lo');
  if (poly.eval(b).isZero()) endpointRoots.push('hi');

  if (poly.isConstant()) {
    return { sign: poly.leading().sign(), rootsInside: 0, endpointRoots: [] };
  }

  const { factors } = poly.squareFree();
  let rootsInside = 0;
  for (const { factor } of factors) {
    rootsInside += countRootsOpen(factor, sturmSequence(factor), a, b);
  }
  if (rootsInside > 0 || endpointRoots.length > 0) {
    return { sign: 'unknown', rootsInside, endpointRoots };
  }
  // No root anywhere in [a,b]; sign is constant, read it exactly at any point.
  const mid = a.add(b).div(Frac.from(2n));
  return { sign: poly.eval(mid).sign(), rootsInside: 0, endpointRoots: [] };
}

/** Descartes' rule helper: sign variations in the coefficient sequence. */
export function coefficientSignVariations(poly: Poly): number {
  let count = 0;
  let prev: -1 | 1 | null = null;
  for (const c of poly.coeff) {
    const s = c.sign();
    if (s === 0) continue;
    if (prev !== null && prev !== s) count += 1;
    prev = s;
  }
  return count;
}

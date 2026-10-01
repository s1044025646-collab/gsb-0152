import { Frac } from './frac.ts';
import { Poly } from './poly.ts';

export type Side = 'left' | 'right';

/**
 * Canonical Sturm sequence for a square-free polynomial p:
 *   s0 = p (monic), s1 = p', and s_{i+1} = -(s_{i-1} mod s_i),
 * terminating at a non-zero constant. Negation follows the classical
 * convention so that the sign-variation difference gives the root count.
 */
export function sturmSequence(p: Poly): Poly[] {
  if (p.isZero()) throw new Error('STURM_ZERO_POLY');
  const monic = p.scale(p.leading().inv());
  const seq: Poly[] = [monic, monic.derivative()];
  for (;;) {
    const prev = seq[seq.length - 2]!;
    const cur = seq[seq.length - 1]!;
    if (cur.isZero()) {
      // p was not square-free; caller guarantees square-free input.
      throw new Error('STURM_NOT_SQUAREFREE');
    }
    const { r } = prev.divmod(cur);
    const next = r.negate();
    seq.push(next);
    if (next.isConstant()) return seq;
  }
}

/**
 * One-sided sign of p at a rational boundary point a.
 * If p(a) != 0 the sign is simply sign(p(a)).
 * If p(a) == 0 we return the sign of the first non-zero derivative at a on the
 * requested side: for side 'right' the raw Taylor sign, for side 'left' it is
 * multiplied by (-1)^k. This gives the sign arbitrarily close to a from that
 * side without any floating point.
 */
export function signAt(p: Poly, a: Frac, side: Side): -1 | 0 | 1 {
  let value = p.eval(a);
  if (!value.isZero()) return value.sign();
  let d = p;
  let k = 0;
  for (;;) {
    d = d.derivative();
    k += 1;
    if (d.isZero()) return 0;
    value = d.eval(a);
    if (!value.isZero()) {
      let s = value.sign();
      if (side === 'left' && k % 2 === 1) s = (s === 1 ? -1 : 1);
      return s;
    }
  }
}

function variations(seq: Poly[], a: Frac, side: Side): number {
  let count = 0;
  let prev: -1 | 1 | null = null;
  for (const s of seq) {
    const sg = signAt(s, a, side);
    if (sg === 0) continue;
    if (prev !== null && prev !== sg) count += 1;
    prev = sg;
  }
  return count;
}

/**
 * Number of distinct roots of the square-free p in (a, b).
 * Uses Sturm's theorem: V(a+) - V(b-) where signs are taken on the interior
 * side of each endpoint, so roots exactly at endpoints are excluded.
 */
export function countRootsOpen(p: Poly, seq: Poly[], a: Frac, b: Frac): number {
  if (a.cmp(b) >= 0) return 0;
  return variations(seq, a, 'right') - variations(seq, b, 'left');
}

/** Distinct real roots of square-free p on the whole real axis. */
export function countRootsReal(seq: Poly[]): number {
  // As x -> +inf every term has the sign of its leading coefficient.
  // As x -> -inf the sign is flipped for odd-degree terms.
  let vp = 0;
  let vn = 0;
  let prevp: -1 | 1 | null = null;
  let prevn: -1 | 1 | null = null;
  seq.forEach((s, idx) => {
    const lead = s.leading();
    const sp = lead.sign() as -1 | 1;
    const sn: -1 | 1 = s.degree() % 2 === 1 ? (sp === 1 ? -1 : 1) : sp;
    if (prevp !== null && prevp !== sp) vp += 1;
    if (prevn !== null && prevn !== sn) vn += 1;
    prevp = sp;
    prevn = sn;
    void idx;
  });
  return vn - vp;
}

export interface IsolationBudget {
  maxIterations: number;
  /** Maximum absolute bit length allowed in numerator/denominator of endpoints. */
  maxBits: number;
}

export interface IsolatedRoot {
  kind: 'exact' | 'interval';
  /** For exact endpoints, the rational root; null for an open interval. */
  exact: Frac | null;
  lo: Frac;
  hi: Frac;
}

export interface IsolationResult {
  roots: IsolatedRoot[];
  unresolved: { lo: Frac; hi: Frac; reason: string }[];
  iterations: number;
  budgetExhausted: boolean;
}

function bits(f: Frac): number {
  const n = f.n < 0n ? -f.n : f.n;
  return Math.max(n.toString(2).length, f.d.toString(2).length);
}

/**
 * Isolate every root of a square-free polynomial inside (lo, hi) using exact
 * bisection with Sturm counting. Root-at-endpoint and root-at-midpoint cases
 * are detected by exact evaluation and reported as exact rational roots.
 * Returns disjoint outputs; any region left when the budget runs out is
 * reported in `unresolved` rather than silently dropped.
 */
export function isolateIn(
  seq: Poly[],
  lo: Frac,
  hi: Frac,
  width: Frac,
  budget: IsolationBudget,
): IsolationResult {
  const p = seq[0]!;
  const roots: IsolatedRoot[] = [];
  const unresolved: IsolationResult['unresolved'] = [];
  const stack: { lo: Frac; hi: Frac }[] = [];
  const total = countRootsOpen(p, seq, lo, hi);
  if (total > 0) stack.push({ lo, hi });

  // Exact roots at the two outer endpoints.
  if (p.eval(lo).isZero()) roots.push({ kind: 'exact', exact: lo, lo, hi: lo });
  if (p.eval(hi).isZero()) roots.push({ kind: 'exact', exact: hi, lo: hi, hi: hi });

  let iterations = 0;
  let budgetExhausted = false;

  while (stack.length > 0) {
    const { lo: a, hi: b } = stack.pop()!;
    const count = countRootsOpen(p, seq, a, b);
    if (count === 0) continue;
    if (iterations >= budget.maxIterations || bits(a) > budget.maxBits || bits(b) > budget.maxBits) {
      unresolved.push({ lo: a, hi: b, reason: 'BUDGET_EXHAUSTED' });
      budgetExhausted = true;
      continue;
    }
    iterations += 1;
    const mid = a.add(b).div(Frac.from(2n));

    if (p.eval(mid).isZero()) {
      roots.push({ kind: 'exact', exact: mid, lo: mid, hi: mid });
      const leftCount = countRootsOpen(p, seq, a, mid);
      const rightCount = countRootsOpen(p, seq, mid, b);
      if (leftCount > 0) stack.push({ lo: a, hi: mid });
      if (rightCount > 0) stack.push({ lo: mid, hi: b });
      continue;
    }

    if (count === 1) {
      const span = b.sub(a).abs();
      if (span.cmp(width) <= 0) {
        roots.push({ kind: 'interval', exact: null, lo: a, hi: b });
      } else {
        // Narrow toward the unique root while preserving containment.
        stack.push({ lo: a, hi: mid });
        stack.push({ lo: mid, hi: b });
      }
      continue;
    }
    stack.push({ lo: a, hi: mid });
    stack.push({ lo: mid, hi: b });
  }

  roots.sort((r1, r2) => r1.lo.cmp(r2.lo));
  return { roots, unresolved, iterations, budgetExhausted };
}

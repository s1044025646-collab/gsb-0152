import {
  Frac, frac, fzero, fone, fcmp, fadd, fsub, fdiv, fabs, fmid,
  fracBitLength,
} from './frac.js';
import { Poly, leading, psignAt } from './poly.js';
import { sturmSequence, sturmCountIn } from './sturm.js';
import { SqfFactor } from './squarefree.js';

export interface AnalysisParams {
  maxWidth: Frac;
  maxIterations: number;
  maxBits: number;
}

export type IntervalStatus = 'isolated' | 'exact-root' | 'undecided';

export interface RootInterval {
  id: string;
  left: Frac;
  right: Frac;
  multiplicity: number;
  factorMultiplicity: number;
  status: IntervalStatus;
  width: Frac;
  display: string;
  reason: string;
}

export interface IsolationOutcome {
  totalRealRoots: number;
  isolatedCount: number;
  undecidedCount: number;
  intervals: RootInterval[];
  exhausted: { iterations: boolean; bits: boolean };
  iterationsUsed: number;
  notes: string[];
}

export interface Budget {
  it: number;
  maxIt: number;
  maxBits: number;
  bitFail: boolean;
}

// Cauchy bound: every real root lies in (-R, R),
// R = ceil(1 + max_i |a_i/a_n|).
export function cauchyBound(p: Poly): Frac {
  if (p.length === 0) throw new Error('CAUCHY_ZERO_POLY');
  const lc = fabs(leading(p));
  let max = fzero();
  for (let i = 0; i < p.length - 1; i++) {
    const v = fdiv(fabs(p[i]), lc);
    if (fcmp(v, max) > 0) max = v;
  }
  const r = fadd(max, fone());
  // r >= 0; ceil to a non-negative integer.
  const num = r.n < 0n ? -r.n : r.n;
  const q = num / r.d;
  const rem = num % r.d;
  return frac(rem > 0n ? q + 1n : q);
}

export function widthOf(a: Frac, b: Frac): Frac {
  return fsub(b, a);
}

let counter = 0;
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter.toString(36)}-${(Date.now() % 1_000_000).toString(36)}`;
}
export function resetIdCounterForTest(): void {
  counter = 0;
}

export function fmt(x: Frac): string {
  return x.d === 1n ? `${x.n}` : `${x.n}/${x.d}`;
}

export function decimalOf(x: Frac, digits = 10): string {
  let num = x.n < 0n ? -x.n : x.n;
  const whole = num / x.d;
  let rem = num % x.d;
  let out = '';
  for (let i = 0; i < digits && rem !== 0n; i++) {
    rem *= 10n;
    out += (rem / x.d).toString();
    rem %= x.d;
  }
  const body = out ? `${whole}.${out}` : `${whole}`;
  return x.n < 0n && x.n !== 0n ? `-${body}` : body;
}

function displayMid(a: Frac, b: Frac): string {
  const m = fmid(a, b);
  return `${fmt(m)} (~${decimalOf(m)})`;
}

function makeInterval(
  a: Frac, b: Frac, mult: number, status: IntervalStatus, reason: string, display?: string,
): RootInterval {
  let lo = a;
  let hi = b;
  if (fcmp(lo, hi) > 0) [lo, hi] = [hi, lo];
  return {
    id: newId('iv'), left: lo, right: hi, multiplicity: mult, factorMultiplicity: mult,
    status, width: widthOf(lo, hi), display: display ?? displayMid(lo, hi), reason,
  };
}

interface FactorState {
  factor: Poly;
  multiplicity: number;
  seq: Poly[];
  isolated: RootInterval[];
  // Work items hold the number of roots STRICTLY in the open interval (a,b).
  // Roots discovered at a, b or the midpoint are emitted as exact-root
  // intervals and never double-counted. Endpoints of a fresh item are never
  // roots (they come from non-root bisection points or stripped Cauchy ends).
  // count = roots strictly in (a,b). skipLeft/skipRight mark endpoints that
  // are already-emitted roots and must not be emitted again.
  work: { a: Frac; b: Frac; count: number; skipLeft?: boolean; skipRight?: boolean }[];
}

function bitsOk(x: Frac, budget: Budget): boolean {
  return fracBitLength(x) <= budget.maxBits;
}

// Refine a single root known to lie in the open interval (a,b). The endpoints
// may themselves be already-emitted roots (skipLeft/skipRight); the root being
// isolated is strictly interior. Bisects using exact open-half Sturm counts.
function refineSingle(
  st: FactorState, a: Frac, b: Frac, target: Frac, budget: Budget,
  skipLeft = false, skipRight = false,
): RootInterval | null {
  // Maintain an open bracket (lo,hi) that contains the unique root, with lo/hi
  // chosen to be non-root evaluation points (the emitted endpoint roots are
  // shrunk away on the first move).
  let lo = a;
  let hi = b;
  // If a boundary is an emitted root, move it inward once.
  if (skipLeft || psignAt(st.factor, lo) === 0) {
    const m0 = fmid(lo, hi);
    if (budget.it >= budget.maxIt || !bitsOk(m0, budget)) {
      if (!bitsOk(m0, budget)) budget.bitFail = true;
      return null;
    }
    budget.it++;
    if (psignAt(st.factor, m0) === 0) {
      return makeInterval(m0, m0, st.multiplicity, 'exact-root',
        `Exact evaluation p(${fmt(m0)})=0; endpoint root declared`, fmt(m0));
    }
    // Unique root is in (lo,hi). After introducing non-root m0, count roots
    // in (m0,hi): V(m0)-V(hi) minus indicator(hi root).
    let right = sturmCountIn(st.factor, m0, hi, st.seq);
    if (psignAt(st.factor, hi) === 0) right -= 1;
    if (right === 1) lo = m0;
    else hi = m0;
  }
  if (skipRight || psignAt(st.factor, hi) === 0) {
    const m0 = fmid(lo, hi);
    if (budget.it >= budget.maxIt || !bitsOk(m0, budget)) {
      if (!bitsOk(m0, budget)) budget.bitFail = true;
      return null;
    }
    budget.it++;
    if (psignAt(st.factor, m0) === 0) {
      return makeInterval(m0, m0, st.multiplicity, 'exact-root',
        `Exact evaluation p(${fmt(m0)})=0; endpoint root declared`, fmt(m0));
    }
    let left = sturmCountIn(st.factor, lo, m0, st.seq);
    if (psignAt(st.factor, lo) === 0) left -= 1;
    if (left === 1) hi = m0;
    else lo = m0;
  }
  // Now both lo and hi are non-root and the unique root is in (lo,hi).
  for (;;) {
    if (fcmp(widthOf(lo, hi), target) <= 0) {
      return makeInterval(lo, hi, st.multiplicity, 'isolated',
        `Sturm sign-variation count: one root in (${fmt(lo)},${fmt(hi)}); width ${fmt(widthOf(lo, hi))} <= requested ${fmt(target)}`);
    }
    const m = fmid(lo, hi);
    if (budget.it >= budget.maxIt || !bitsOk(m, budget)) {
      if (!bitsOk(m, budget)) budget.bitFail = true;
      return null;
    }
    budget.it++;
    if (psignAt(st.factor, m) === 0) {
      return makeInterval(m, m, st.multiplicity, 'exact-root',
        `Exact evaluation p(${fmt(m)})=0; degenerate interval declares an exact endpoint root`, fmt(m));
    }
    const lc = sturmCountIn(st.factor, lo, m, st.seq);
    if (lc === 1) hi = m;
    else lo = m;
  }
}

function sturmTotal(factor: Poly, seq: Poly[]): number {
  const R = cauchyBound(factor);
  return sturmCountIn(factor, fsub(fzero(), R), R, seq);
}

export function isolateFactors(
  factors: SqfFactor[], params: AnalysisParams,
): IsolationOutcome {
  const notes: string[] = [];
  const budget: Budget = { it: 0, maxIt: params.maxIterations, maxBits: params.maxBits, bitFail: false };
  const states: FactorState[] = factors.map(({ factor, multiplicity }) => ({
    factor, multiplicity, seq: sturmSequence(factor), isolated: [], work: [],
  }));

  let totalRealRoots = 0;
  for (const st of states) {
    const total = sturmTotal(st.factor, st.seq);
    totalRealRoots += total;
    if (total === 0) continue;
    const R = cauchyBound(st.factor);
    const negR = fsub(fzero(), R);
    // Detect roots exactly at either Cauchy-bound endpoint, then isolate the
    // open interior.
    if (psignAt(st.factor, negR) === 0) {
      st.isolated.push(makeInterval(negR, negR, st.multiplicity, 'exact-root',
        `Exact evaluation p(${fmt(negR)})=0 at Cauchy bound; endpoint root declared`, fmt(negR)));
    }
    const rIsRoot = psignAt(st.factor, R) === 0;
    if (rIsRoot) {
      st.isolated.push(makeInterval(R, R, st.multiplicity, 'exact-root',
        `Exact evaluation p(${fmt(R)})=0 at Cauchy bound; endpoint root declared`, fmt(R)));
    }
    // Interior roots in the open interval (negR, R).
    let n = sturmCountIn(st.factor, negR, R, st.seq);
    if (psignAt(st.factor, negR) === 0) n -= 1;
    if (rIsRoot) n -= 1;
    if (n > 0) st.work.push({ a: negR, b: R, count: n });
  }

  for (const st of states) {
    while (st.work.length) {
      const item = st.work.pop()!;
      if (item.count === 0) continue;
      if (item.count === 1) {
        const iv = refineSingle(st, item.a, item.b, params.maxWidth, budget,
          item.skipLeft === true, item.skipRight === true);
        if (iv) {
          st.isolated.push(iv);
          continue;
        }
        st.isolated.push(makeInterval(item.a, item.b, st.multiplicity, 'undecided',
          budget.bitFail
            ? `Bit-length budget ${params.maxBits} reached before width <= ${fmt(params.maxWidth)}`
            : `Iteration budget ${params.maxIterations} reached before width <= ${fmt(params.maxWidth)}`));
        continue;
      }
      const m = fmid(item.a, item.b);
      if (budget.it >= budget.maxIt || !bitsOk(m, budget)) {
        if (!bitsOk(m, budget)) budget.bitFail = true;
        st.isolated.push(makeInterval(item.a, item.b, st.multiplicity, 'undecided',
          budget.bitFail
            ? `Bit-length budget ${params.maxBits} reached with ${item.count} roots still grouped`
            : `Iteration budget ${params.maxIterations} reached with ${item.count} roots still grouped`));
        continue;
      }
      budget.it++;
      if (psignAt(st.factor, m) === 0) {
        st.isolated.push(makeInterval(m, m, st.multiplicity, 'exact-root',
          `Exact evaluation p(${fmt(m)})=0 during bisection; endpoint root declared`, fmt(m)));
        // Sturm V(u)-V(v) counts roots in (u, v] (a root at u is excluded,
        // a root at v included). Therefore:
        //   left open (a,m) = V(a)-V(m) - 1{m root}
        //   right open (m,b) = V(m)-V(b) (m already excluded)
        const lc = sturmCountIn(st.factor, item.a, m, st.seq) - 1;
        const rc = sturmCountIn(st.factor, m, item.b, st.seq);
        if (lc > 0) st.work.push({ a: item.a, b: m, count: lc, skipRight: true });
        if (rc > 0) st.work.push({ a: m, b: item.b, count: rc, skipLeft: true });
      } else {
        const lc = sturmCountIn(st.factor, item.a, m, st.seq);
        const rc = item.count - lc;
        if (lc > 0) st.work.push({ a: item.a, b: m, count: lc });
        if (rc > 0) st.work.push({ a: m, b: item.b, count: rc });
      }
    }
  }

  let intervals = states.flatMap((s) => s.isolated);
  intervals = separateAcrossFactors(intervals, states, params, budget, notes);
  intervals.sort((u, v) => fcmp(u.left, v.left));

  const isolatedCount = intervals.filter((i) => i.status !== 'undecided').length;
  const undecidedCount = totalRealRoots - isolatedCount;
  return {
    totalRealRoots,
    isolatedCount,
    undecidedCount: Math.max(0, undecidedCount),
    intervals,
    exhausted: {
      iterations: budget.it >= budget.maxIt && undecidedCount > 0,
      bits: budget.bitFail && undecidedCount > 0,
    },
    iterationsUsed: budget.it,
    notes,
  };
}

// Roots of distinct square-free factors are distinct (factor gcd is 1), so the
// global interval list must be pairwise disjoint. Overlapping decided intervals
// are refined further; persistent overlap under budget becomes undecided.
function separateAcrossFactors(
  intervals: RootInterval[], states: FactorState[], params: AnalysisParams,
  budget: Budget, notes: string[],
): RootInterval[] {
  const stateByMult = new Map<number, FactorState>();
  for (const s of states) stateByMult.set(s.multiplicity, s);
  let changed = true;
  let guard = intervals.length * intervals.length * params.maxIterations + 8;
  while (changed && guard-- > 0) {
    changed = false;
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const A = intervals[i];
        const B = intervals[j];
        if (A.factorMultiplicity === B.factorMultiplicity) continue;
        const overlap = fcmp(A.right, B.left) > 0 && fcmp(B.right, A.left) > 0;
        if (!overlap) continue;
        changed = true;
        notes.push('Cross-factor overlap detected; refining to keep global intervals disjoint.');
        for (const iv of [A, B]) {
          if (iv.status === 'exact-root') continue;
          const st = stateByMult.get(iv.factorMultiplicity)!;
          const tighter = fdiv(params.maxWidth, frac(4n));
          const rep = refineSingle(st, iv.left, iv.right, tighter, budget);
          if (rep) {
            Object.assign(iv, rep);
          } else {
            iv.status = 'undecided';
            iv.reason = 'Budget reached while separating close roots of distinct factors';
          }
        }
      }
    }
  }
  return intervals;
}

// Further refine an existing interval list (continuation after a revision),
// preserving containment: replacement endpoints never escape the old interval.
export function refineIntervals(
  factors: SqfFactor[], previous: RootInterval[], params: AnalysisParams,
): IsolationOutcome {
  const outcome = isolateFactors(factors, params);
  for (const fresh of outcome.intervals) {
    const old = previous.find((p) =>
      p.multiplicity === fresh.multiplicity &&
      fcmp(p.left, fresh.left) <= 0 && fcmp(fresh.right, p.right) <= 0);
    if (old) fresh.id = old.id;
  }
  return outcome;
}

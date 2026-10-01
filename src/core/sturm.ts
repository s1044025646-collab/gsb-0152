import { Poly, derivative, polyDivMod, psignAt, psignAtInfinity, isZeroPoly } from './poly.js';
import { Frac } from './frac.js';

// Canonical Sturm sequence for a square-free polynomial s:
//   s0 = s, s1 = s', s_{i+1} = -rem(s_{i-1}, s_i)
// Rests are kept over Q (no sign normalization) which is required for the
// sign-variation argument to be valid.
export function sturmSequence(s: Poly): Poly[] {
  if (isZeroPoly(s)) throw new Error('STURM_ZERO_POLY');
  const seq: Poly[] = [s, derivative(s)];
  if (isZeroPoly(seq[1])) {
    // Degree-zero square-free polynomial: sequence is just [s].
    return [s];
  }
  for (;;) {
    const { r } = polyDivMod(seq[seq.length - 2], seq[seq.length - 1]);
    const next = r.map((c) => ({ n: -c.n, d: c.d }));
    if (isZeroPoly(next)) break;
    seq.push(next);
  }
  return seq;
}

function variations(signs: (-1 | 0 | 1)[]): number {
  const s = signs.filter((x) => x !== 0);
  let v = 0;
  for (let i = 1; i < s.length; i++) if (s[i] !== s[i - 1]) v++;
  return v;
}

// Number of distinct real roots of a square-free polynomial in the finite
// interval [a, b] (endpoints included; square-free => roots are simple so
// endpoint roots count exactly once).
export function sturmCountIn(s: Poly, a: Frac, b: Frac, seq?: Poly[]): number {
  const q = seq ?? sturmSequence(s);
  const va = variations(q.map((p) => psignAt(p, a)));
  const vb = variations(q.map((p) => psignAt(p, b)));
  return va - vb;
}

// Distinct real roots on the whole real line.
export function sturmCountAll(s: Poly, seq?: Poly[]): number {
  const q = seq ?? sturmSequence(s);
  const vNeg = variations(q.map((p) => psignAtInfinity(p, -1)));
  const vPos = variations(q.map((p) => psignAtInfinity(p, 1)));
  return vNeg - vPos;
}

// Extended endpoint marker for unbounded intervals.
export type ExtBound = Frac | { inf: -1 | 1 };

// Root count on an extended interval [a,b] where either endpoint may be
// +/-infinity.
export function sturmCountExtended(s: Poly, a: ExtBound, b: ExtBound, seq?: Poly[]): number {
  const q = seq ?? sturmSequence(s);
  const signsAt = (p: Poly, x: ExtBound): (-1 | 0 | 1) => {
    if (x !== null && typeof x === 'object' && 'inf' in x) return psignAtInfinity(p, x.inf);
    return psignAt(p, x as Frac);
  };
  const va = variations(q.map((p) => signsAt(p, a)));
  const vb = variations(q.map((p) => signsAt(p, b)));
  return va - vb;
}

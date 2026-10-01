import {
  Frac, fzero, fone, frac, parseFrac, fracToString, fadd, fsub, fmul, fdiv,
  fneg, fcmp, fsign, isZero,
} from './frac.js';

// Dense ascending representation: coeff[i] is the coefficient of x^i.
// Trailing zero coefficients are removed. The zero polynomial is [].
export type Poly = Frac[];

export const MAX_DEGREE = 12;

export function pzero(): Poly {
  return [];
}

export function trim(c: Poly): Poly {
  const r = c.slice();
  while (r.length && isZero(r[r.length - 1])) r.pop();
  return r;
}

export function degree(p: Poly): number {
  return p.length - 1;
}

export function isZeroPoly(p: Poly): boolean {
  return p.length === 0;
}

export function isConst(p: Poly): boolean {
  return p.length <= 1;
}

export function leading(p: Poly): Frac {
  return p.length === 0 ? fzero() : p[p.length - 1];
}

// Parse a coefficient list. Accepts an array of integer/fraction strings
// (index = degree) or an object mapping degree -> coefficient string.
export function parsePoly(input: unknown): Poly {
  let map: Map<number, string>;
  if (Array.isArray(input)) {
    map = new Map();
    input.forEach((v, i) => {
      if (v !== null && v !== undefined && String(v).trim() !== '') map.set(i, String(v));
    });
  } else if (input && typeof input === 'object') {
    map = new Map();
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!/^\d+$/.test(k)) throw new Error('POLY_BAD_DEGREE_KEY');
      if (v !== null && v !== undefined && String(v).trim() !== '') map.set(Number(k), String(v));
    }
  } else {
    throw new Error('POLY_PARSE_BAD_SHAPE');
  }
  let maxDeg = -1;
  const coeffs: Frac[] = [];
  for (const [deg, raw] of map) {
    if (deg < 0 || deg > MAX_DEGREE) throw new Error('POLY_DEGREE_OUT_OF_RANGE');
    const c = parseFrac(raw);
    coeffs[deg] = c;
    if (!isZero(c)) maxDeg = Math.max(maxDeg, deg);
  }
  if (maxDeg < 0) return [];
  const out: Frac[] = [];
  for (let i = 0; i <= maxDeg; i++) out.push(coeffs[i] ?? fzero());
  return trim(out);
}

export function polyToCoeffStrings(p: Poly): string[] {
  return p.map(fracToString);
}

export function polyTerms(p: Poly): { degree: number; coeff: string }[] {
  const terms: { degree: number; coeff: string }[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    if (!isZero(p[i])) terms.push({ degree: i, coeff: fracToString(p[i]) });
  }
  return terms;
}

export function polyToPretty(p: Poly): string {
  if (p.length === 0) return '0';
  const parts: string[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const c = p[i];
    if (isZero(c)) continue;
    let term: string;
    if (i === 0) term = fracToString(c);
    else if (i === 1) term = `${fracToString(c)}*x`;
    else term = `${fracToString(c)}*x^${i}`;
    parts.push(term);
  }
  return parts.join(' + ').replace(/\+ -/g, '- ');
}

export function padd(a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  const out: Frac[] = [];
  for (let i = 0; i < n; i++) out.push(fadd(a[i] ?? fzero(), b[i] ?? fzero()));
  return trim(out);
}

export function psub(a: Poly, b: Poly): Poly {
  const n = Math.max(a.length, b.length);
  const out: Frac[] = [];
  for (let i = 0; i < n; i++) out.push(fsub(a[i] ?? fzero(), b[i] ?? fzero()));
  return trim(out);
}

export function pmul(a: Poly, b: Poly): Poly {
  if (!a.length || !b.length) return [];
  const out: Frac[] = new Array(a.length + b.length - 1).fill(0).map(() => fzero());
  for (let i = 0; i < a.length; i++) {
    if (isZero(a[i])) continue;
    for (let j = 0; j < b.length; j++) out[i + j] = fadd(out[i + j], fmul(a[i], b[j]));
  }
  return trim(out);
}

export function pscale(a: Poly, s: Frac): Poly {
  if (isZero(s) || a.length === 0) return [];
  return trim(a.map((c) => fmul(c, s)));
}

export function derivative(p: Poly): Poly {
  if (p.length <= 1) return [];
  const out: Frac[] = [];
  for (let i = 1; i < p.length; i++) out.push(fmul(p[i], frac(BigInt(i))));
  return trim(out);
}

// Divide dividend by divisor over Q. Returns quotient and remainder with
// deg(remainder) < deg(divisor). Throws on division by zero.
export function polyDivMod(dividend: Poly, divisor: Poly): { q: Poly; r: Poly } {
  if (divisor.length === 0) throw new Error('POLY_DIVIDE_BY_ZERO');
  let r = dividend.slice();
  const q: Frac[] = new Array(Math.max(0, r.length - divisor.length + 1)).fill(0).map(() => fzero());
  const dDeg = degree(divisor);
  const dLead = leading(divisor);
  while (r.length && degree(r) >= dDeg) {
    const shift = degree(r) - dDeg;
    const factor = fdiv(leading(r), dLead);
    q[shift] = fadd(q[shift], factor);
    for (let i = 0; i < divisor.length; i++) {
      const idx = i + shift;
      r[idx] = fsub(r[idx], fmul(factor, divisor[i]));
    }
    r = trim(r);
  }
  return { q: trim(q), r: trim(r) };
}

export function polyDivExact(a: Poly, b: Poly): Poly {
  const { q, r } = polyDivMod(a, b);
  if (r.length !== 0) throw new Error('POLY_NOT_EXACT_DIVISIBLE');
  return q;
}

// Convert rational-coefficient polynomial to a primitive integer polynomial:
// multiply through by the LCM of denominators, then divide all entries by
// their integer content. Sign is normalized so the leading term is positive.
export function primitiveIntegers(p: Poly): bigint[] {
  if (p.length === 0) return [];
  const gcd2 = (a: bigint, b: bigint): bigint => {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) {
      [a, b] = [b, a % b];
    }
    return a;
  };
  // LCM of denominators.
  let lcm = 1n;
  for (const c of p) {
    const g = gcd2(lcm, c.d);
    lcm = (lcm * c.d) / (g === 0n ? 1n : g);
  }
  let ints = p.map((c) => c.n * (lcm / c.d));
  // Integer content = gcd of all coefficients (zeros ignored).
  let g = 0n;
  for (const v of ints) g = gcd2(g, v);
  if (g === 0n) g = 1n;
  ints = ints.map((v) => v / g);
  while (ints.length && ints[ints.length - 1] === 0n) ints.pop();
  if (ints.length && ints[ints.length - 1] < 0n) ints = ints.map((v) => -v);
  return ints;
}

function fromIntegers(xs: bigint[]): Poly {
  return trim(xs.map((x) => frac(x)));
}

// Make a polynomial monic by dividing by its leading coefficient.
export function monic(p: Poly): Poly {
  if (p.length === 0) return [];
  const lc = p[p.length - 1];
  return trim(p.map((c) => fdiv(c, lc)));
}

// gcd over Q[x]; result is a primitive integer polynomial, monic in sign
// (positive leading coefficient). gcd(p, 0) follows the usual convention.
export function polyGcd(a: Poly, b: Poly): Poly {
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) return fromIntegers(primitiveIntegers(b));
  if (b.length === 0) return fromIntegers(primitiveIntegers(a));
  // Euclidean algorithm over Q; intermediate rests keep exact scalar factors.
  let A = a;
  let B = b;
  while (B.length) {
    const { r } = polyDivMod(A, B);
    A = B;
    B = r;
  }
  return monic(A);
}

// Exact evaluation.
export function peval(p: Poly, x: Frac): Frac {
  // Horner from highest degree.
  let acc = fzero();
  for (let i = p.length - 1; i >= 0; i--) acc = fadd(fmul(acc, x), p[i]);
  return acc;
}

export function psignAt(p: Poly, x: Frac): -1 | 0 | 1 {
  return fsign(peval(p, x));
}

// Sign of a polynomial at +/-infinity equals sign of leading coefficient.
export function psignAtInfinity(p: Poly, side: -1 | 1): -1 | 0 | 1 {
  if (p.length === 0) return 0;
  const leadSign = fsign(leading(p));
  if (side === 1) return leadSign;
  return degree(p) % 2 === 0 ? leadSign : ((-leadSign) as -1 | 1);
}

export { fcmp };

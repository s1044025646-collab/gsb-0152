// Exact rational arithmetic over BigInt. A fraction is an immutable pair
// (numerator, denominator) kept in canonical form: denominator > 0 and
// gcd(|n|, d) === 1n. Zero is 0/1.

export interface Frac {
  readonly n: bigint;
  readonly d: bigint;
}

const ZERO: Frac = { n: 0n, d: 1n };
const ONE: Frac = { n: 1n, d: 1n };

export function frac(n: bigint | number | string, d: bigint | number | string = 1n): Frac {
  const bn = BigInt(n);
  let bd = BigInt(d);
  if (bd === 0n) throw new Error('FRAC_DENOMINATOR_ZERO');
  if (bd < 0n) return mk(-bn, -bd);
  return mk(bn, bd);
}

function mk(n: bigint, d: bigint): Frac {
  if (n === 0n) return ZERO;
  const g = gcdAbs(n, d);
  return { n: n / g, d: d / g };
}

function gcdAbs(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) {
    [a, b] = [b, a % b];
  }
  return a === 0n ? 1n : a;
}

export function isZero(a: Frac): boolean {
  return a.n === 0n;
}

export function fzero(): Frac {
  return ZERO;
}
export function fone(): Frac {
  return ONE;
}

export function fneg(a: Frac): Frac {
  return a.n === 0n ? a : { n: -a.n, d: a.d };
}

export function finv(a: Frac): Frac {
  if (a.n === 0n) throw new Error('FRAC_INVERSE_ZERO');
  if (a.n < 0n) return { n: -a.d, d: -a.n };
  return { n: a.d, d: a.n };
}

export function fadd(a: Frac, b: Frac): Frac {
  return mk(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function fsub(a: Frac, b: Frac): Frac {
  return mk(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function fmul(a: Frac, b: Frac): Frac {
  if (a.n === 0n || b.n === 0n) return ZERO;
  return mk(a.n * b.n, a.d * b.d);
}

export function fdiv(a: Frac, b: Frac): Frac {
  if (b.n === 0n) throw new Error('FRAC_DIVIDE_ZERO');
  return fmul(a, finv(b));
}

export function fcmp(a: Frac, b: Frac): -1 | 0 | 1 {
  const lhs = a.n * b.d;
  const rhs = b.n * a.d;
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}

export function feq(a: Frac, b: Frac): boolean {
  return fcmp(a, b) === 0;
}

export function fsign(a: Frac): -1 | 0 | 1 {
  return a.n < 0n ? -1 : a.n > 0n ? 1 : 0;
}

export function fabs(a: Frac): Frac {
  return a.n < 0n ? { n: -a.n, d: a.d } : a;
}

// Average of two fractions; used by exact bisection.
export function fmid(a: Frac, b: Frac): Frac {
  return fdiv(fadd(a, b), { n: 2n, d: 1n });
}

export function fint(n: bigint | number): Frac {
  return frac(n);
}

// Parse integer or fraction strings such as "2", "-3/4", " 5 / 8 ".
// Decimal strings are intentionally rejected: callers must provide exact
// integer or fraction expressions.
export function parseFrac(s: string): Frac {
  if (typeof s !== 'string') throw new Error('FRAC_PARSE_NOT_STRING');
  const t = s.trim();
  if (t === '') throw new Error('FRAC_PARSE_EMPTY');
  if (/[.eE]/.test(t)) throw new Error('FRAC_PARSE_DECIMAL_NOT_ALLOWED');
  const parts = t.split('/');
  if (parts.length > 2) throw new Error('FRAC_PARSE_BAD_FORMAT');
  if (!/^[+-]?\d+$/.test(parts[0].trim())) throw new Error('FRAC_PARSE_BAD_NUMERATOR');
  const n = BigInt(parts[0].trim());
  if (parts.length === 1) return mk(n, 1n);
  if (!/^[+-]?\d+$/.test(parts[1].trim())) throw new Error('FRAC_PARSE_BAD_DENOMINATOR');
  const d = BigInt(parts[1].trim());
  if (d === 0n) throw new Error('FRAC_PARSE_ZERO_DENOMINATOR');
  return mk(n, d < 0n ? -d : d);
}

export function fracToString(a: Frac): string {
  return a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`;
}

// Display-only decimal approximation. Never used as evidence.
export function fracToDecimal(a: Frac, digits = 12): string {
  const neg = a.n < 0n;
  let num = a.n < 0n ? -a.n : a.n;
  const whole = num / a.d;
  let rem = num % a.d;
  let fracPart = '';
  let k = 0;
  while (rem !== 0n && k < digits) {
    rem *= 10n;
    fracPart += (rem / a.d).toString();
    rem %= a.d;
    k++;
  }
  const body = fracPart === '' ? `${whole}` : `${whole}.${fracPart}`;
  return neg && a.n !== 0n ? `-${body}` : body;
}

// Bit length of the larger of |numerator| and denominator; used to enforce
// the exact-coefficient budget guard.
export function fracBitLength(a: Frac): number {
  const nn = a.n < 0n ? -a.n : a.n;
  const bits = (x: bigint) => (x === 0n ? 0 : x.toString(2).length);
  return Math.max(bits(nn), bits(a.d));
}

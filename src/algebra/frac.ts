/**
 * Exact arbitrary-precision rational numbers backed by BigInt.
 * Every Frac is stored in canonical form:
 *   - denominator is a positive BigInt
 *   - numerator and denominator are coprime
 * Zero is 0n/1n.
 */
export class Frac {
  readonly n: bigint;
  readonly d: bigint;

  private constructor(n: bigint, d: bigint) {
    this.n = n;
    this.d = d;
  }

  static ZERO = Frac.from(0n);
  static ONE = Frac.from(1n);

  static from(n: bigint | number, d: bigint | number = 1n): Frac {
    let bn = BigInt(n);
    let bd = BigInt(d);
    if (bd === 0n) throw new Error('FRAC_DIV_ZERO');
    if (bd < 0n) {
      bn = -bn;
      bd = -bd;
    }
    if (bn === 0n) return new Frac(0n, 1n);
    const g = bigIntGcd(bn < 0n ? -bn : bn, bd);
    return new Frac(bn / g, bd / g);
  }

  /** Parse integer strings and fraction strings such as "3", "-2/7", " +4 / -10 ". */
  static parse(input: string): Frac {
    if (typeof input !== 'string') throw new FracParseError(input);
    const text = input.trim();
    if (text === '') throw new FracParseError(input);
    if (!/^[+-]?[0-9]+(\s*\/\s*[+-]?[0-9]+)?$/.test(text)) {
      throw new FracParseError(input);
    }
    const parts = text.split('/');
    if (parts.length === 1) return Frac.from(BigInt(parts[0]!.trim()));
    return Frac.from(BigInt(parts[0]!.trim()), BigInt(parts[1]!.trim()));
  }

  isZero(): boolean {
    return this.n === 0n;
  }

  isOne(): boolean {
    return this.n === 1n && this.d === 1n;
  }

  neg(): Frac {
    return new Frac(-this.n, this.d);
  }

  abs(): Frac {
    return this.n < 0n ? new Frac(-this.n, this.d) : this;
  }

  add(o: Frac): Frac {
    return Frac.from(this.n * o.d + o.n * this.d, this.d * o.d);
  }

  sub(o: Frac): Frac {
    return Frac.from(this.n * o.d - o.n * this.d, this.d * o.d);
  }

  mul(o: Frac): Frac {
    return Frac.from(this.n * o.n, this.d * o.d);
  }

  div(o: Frac): Frac {
    if (o.n === 0n) throw new Error('FRAC_DIV_ZERO');
    return Frac.from(this.n * o.d, this.d * o.n);
  }

  /** 1/x */
  inv(): Frac {
    if (this.n === 0n) throw new Error('FRAC_DIV_ZERO');
    return Frac.from(this.d, this.n);
  }

  cmp(o: Frac): -1 | 0 | 1 {
    const lhs = this.n * o.d;
    const rhs = o.n * this.d;
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  sign(): -1 | 0 | 1 {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }

  floorBig(): bigint {
    const q = this.n / this.d;
    const r = this.n % this.d;
    return r !== 0n && this.n < 0n ? q - 1n : q;
  }

  /** Decimal approximation for display only. Never used as evidence. */
  toDecimal(digits = 6): string {
    const neg = this.n < 0n;
    const an = neg ? -this.n : this.n;
    const scale = 10n ** BigInt(digits);
    let q = (an * scale) / this.d;
    const rem = (an * scale) % this.d;
    if (rem * 2n >= this.d) q += 1n; // round half up
    const intPart = q / scale;
    const fracPart = (q % scale).toString().padStart(digits, '0');
    const trimmed = digits === 0 ? '' : '.' + fracPart.replace(/0+$/, '');
    return (neg && (intPart !== 0n || q !== 0n) ? '-' : '') + intPart.toString() + trimmed;
  }

  toString(): string {
    return this.d === 1n ? this.n.toString() : `${this.n}/${this.d}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

export class FracParseError extends Error {
  code = 'INVALID_FRACTION' as const;
  readonly raw: unknown;
  constructor(raw: unknown) {
    super(`Not a canonical integer/fraction string: ${String(raw)}`);
    this.name = 'FracParseError';
    this.raw = raw;
  }
}

export function bigIntGcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

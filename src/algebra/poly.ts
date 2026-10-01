import { Frac, bigIntGcd } from './frac.ts';

/**
 * Univariate polynomial over exact rationals.
 * Coefficients are stored low-degree-first: coeff[i] is the coefficient of x^i.
 * Trailing zero coefficients are always removed.
 * The zero polynomial is represented by an empty coefficient array.
 */
export class Poly {
  readonly coeff: readonly Frac[];

  constructor(coeff: readonly Frac[]) {
    let end = coeff.length;
    while (end > 0 && coeff[end - 1]!.isZero()) end -= 1;
    this.coeff = coeff.slice(0, end);
  }

  static ZERO = new Poly([]);
  static ONE = new Poly([Frac.ONE]);

  isZero(): boolean {
    return this.coeff.length === 0;
  }

  isConstant(): boolean {
    return this.coeff.length <= 1;
  }

  degree(): number {
    return this.coeff.length - 1;
  }

  leading(): Frac {
    return this.coeff.length === 0 ? Frac.ZERO : this.coeff[this.coeff.length - 1]!;
  }

  at(i: number): Frac {
    const c = this.coeff[i];
    return c ?? Frac.ZERO;
  }

  /** Multiply by a scalar; preserves canonical zero. */
  scale(s: Frac): Poly {
    if (s.isZero() || this.isZero()) return Poly.ZERO;
    return new Poly(this.coeff.map((c) => c.mul(s)));
  }

  add(o: Poly): Poly {
    const n = Math.max(this.coeff.length, o.coeff.length);
    const out: Frac[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.at(i).add(o.at(i));
    return new Poly(out);
  }

  sub(o: Poly): Poly {
    const n = Math.max(this.coeff.length, o.coeff.length);
    const out: Frac[] = new Array(n);
    for (let i = 0; i < n; i++) out[i] = this.at(i).sub(o.at(i));
    return new Poly(out);
  }

  mul(o: Poly): Poly {
    if (this.isZero() || o.isZero()) return Poly.ZERO;
    const out: Frac[] = new Array(this.coeff.length + o.coeff.length - 1).fill(Frac.ZERO);
    for (let i = 0; i < this.coeff.length; i++) {
      for (let j = 0; j < o.coeff.length; j++) {
        out[i + j] = out[i + j]!.add(this.coeff[i]!.mul(o.coeff[j]!));
      }
    }
    return new Poly(out);
  }

  /** Shift exponents by k: multiply by x^k. */
  shift(k: number): Poly {
    if (this.isZero() || k <= 0) return k === 0 ? this : Poly.ZERO;
    const out: Frac[] = new Array(this.coeff.length + k).fill(Frac.ZERO);
    for (let i = 0; i < this.coeff.length; i++) out[i + k] = this.coeff[i]!;
    return new Poly(out);
  }

  negate(): Poly {
    return this.scale(Frac.from(-1n));
  }

  derivative(): Poly {
    if (this.coeff.length <= 1) return Poly.ZERO;
    const out: Frac[] = new Array(this.coeff.length - 1);
    for (let i = 1; i < this.coeff.length; i++) {
      out[i - 1] = this.coeff[i]!.mul(Frac.from(BigInt(i)));
    }
    return new Poly(out);
  }

  /** Exact evaluation at a rational point using Horner's rule. */
  eval(x: Frac): Frac {
    let acc = Frac.ZERO;
    for (let i = this.coeff.length - 1; i >= 0; i--) {
      acc = acc.mul(x).add(this.coeff[i]!);
    }
    return acc;
  }

  /**
   * Exact polynomial division. Returns quotient and remainder; throws if the
   * divisor is the zero polynomial. Works exactly over Q.
   */
  divmod(divisor: Poly): { q: Poly; r: Poly } {
    if (divisor.isZero()) throw new Error('POLY_DIV_ZERO');
    let r = new Poly(this.coeff);
    const dDeg = divisor.degree();
    const dLead = divisor.leading();
    const qCoeff: Frac[] = new Array(Math.max(0, this.degree() - dDeg + 1)).fill(Frac.ZERO);
    while (!r.isZero() && r.degree() >= dDeg) {
      const shiftK = r.degree() - dDeg;
      const factor = r.leading().div(dLead);
      qCoeff[shiftK] = factor;
      r = r.sub(divisor.shift(shiftK).scale(factor));
    }
    return { q: new Poly(qCoeff), r };
  }

  divides(o: Poly): boolean {
    return o.divmod(this).r.isZero();
  }

  /** Monic GCD over Q using the Euclidean algorithm. gcd(0,0) === 0. */
  static gcd(a: Poly, b: Poly): Poly {
    let x = a;
    let y = b;
    while (!y.isZero()) {
      const { r } = x.divmod(y);
      x = y;
      y = r;
    }
    if (x.isZero()) return Poly.ZERO;
    return x.scale(x.leading().inv());
  }

  /**
   * Square-free decomposition over the rationals (Yun projection) followed by
   * an exact multiplicity check. Yun groups distinct roots into pairwise
   * coprime square-free factors; rather than trusting iteration order for the
   * multiplicity label, each factor's multiplicity is determined exactly by
   * counting how many times it divides the monic input polynomial. The product
   * of factor^multiplicity therefore equals the input up to its leading term.
   */
  squareFree(): { content: Frac; factors: { factor: Poly; multiplicity: number }[] } {
    if (this.isZero()) throw new Error('SQUAREFREE_ZERO_POLY');
    const content = this.leading();
    const monic = this.scale(content.inv());
    if (monic.degree() === 0) return { content, factors: [] };

    const deriv = monic.derivative();
    const c = Poly.gcd(monic, deriv);
    const { q: w } = monic.divmod(c);
    const fPrimeOverC = deriv.divmod(c).q;
    const y = fPrimeOverC.sub(w.derivative());

    const factors: { factor: Poly; multiplicity: number }[] = [];
    const grouped: Poly[] = [];
    let wcur = w;
    let ycur = y;
    while (!wcur.isConstant()) {
      if (ycur.isZero() || ycur.isConstant()) {
        grouped.push(wcur);
        break;
      }
      const z = Poly.gcd(wcur, ycur);
      const { q: factor } = wcur.divmod(z);
      if (factor.degree() > 0) grouped.push(factor);
      if (z.isConstant()) break;
      wcur = z;
      ycur = ycur.sub(z.derivative()).divmod(z).q;
    }
    // Determine multiplicity exactly: largest m such that factor^m divides monic.
    for (const factor of grouped) {
      let multiplicity = 0;
      let leftover: Poly = monic;
      for (;;) {
        const { q, r } = leftover.divmod(factor);
        if (!r.isZero()) break;
        multiplicity += 1;
        leftover = q;
      }
      factors.push({ factor, multiplicity });
    }
    factors.sort((a, b) => a.multiplicity - b.multiplicity);
    return { content, factors };
  }

  toString(): string {
    if (this.isZero()) return '0';
    const terms: string[] = [];
    for (let i = this.coeff.length - 1; i >= 0; i--) {
      const c = this.coeff[i]!;
      if (c.isZero()) continue;
      let term: string;
      if (i === 0) term = c.toString();
      else if (i === 1) term = (c.isOne() ? 'x' : c.neg().isOne() ? '-x' : `${c.toString()}*x`);
      else term = (c.isOne() ? `x^${i}` : c.neg().isOne() ? `-x^${i}` : `${c.toString()}*x^${i}`);
      terms.push(term);
    }
    return terms
      .join('+')
      .replace(/\+-/g, '-')
      .replace(/^(-?)1\*/, '$1');
  }
}

/**
 * Parse a polynomial expressed as a coefficient array of fraction strings,
 * low-degree-first, e.g. ["0", "1", "-2/3"] means x - (2/3)x^2.
 * Throws PolyValidationError with code INVALID_POLYNOMIAL.
 */
export function parsePolyCoeffs(raw: unknown, maxDegree = 12): Poly {
  if (!Array.isArray(raw)) throw new PolyValidationError('coefficients must be an array');
  if (raw.length === 0) throw new PolyValidationError('coefficients must not be empty');
  if (raw.length - 1 > maxDegree) {
    throw new PolyValidationError(`degree must be <= ${maxDegree}`);
  }
  const coeffs: Frac[] = [];
  for (const token of raw) {
    if (typeof token !== 'string') {
      throw new PolyValidationError(`coefficient must be a string, got ${typeof token}`);
    }
    try {
      coeffs.push(Frac.parse(token));
    } catch {
      throw new PolyValidationError(`invalid coefficient "${token}"`);
    }
  }
  const poly = new Poly(coeffs);
  if (!poly.isZero() && poly.degree() > maxDegree) {
    throw new PolyValidationError(`degree must be <= ${maxDegree}`);
  }
  return poly;
}

export class PolyValidationError extends Error {
  code = 'INVALID_POLYNOMIAL' as const;
  constructor(message: string) {
    super(message);
    this.name = 'PolyValidationError';
  }
}

/** Build a polynomial from integer coefficient strings (helper for fixtures). */
export function polyFromInts(...ints: (number | bigint | string)[]): Poly {
  return new Poly(ints.map((v) => Frac.from(BigInt(v))));
}

/** x - r */
export function linearFactor(r: Frac): Poly {
  return new Poly([r.neg(), Frac.ONE]);
}

export { bigIntGcd };

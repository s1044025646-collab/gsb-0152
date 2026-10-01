import { Frac, bigIntGcd } from './frac.ts';
import { Poly } from './poly.ts';

function isqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('isqrt negative');
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/**
 * Prime factorization by trial division up to sqrt(n). Inputs here are
 * individual coefficients of degree <= 12 polynomials; for adversarial large
 * primes the loop stops quickly at the residual prime. Returns prime powers.
 */
function primeFactors(n: bigint): Map<bigint, number> {
  const a = n < 0n ? -n : n;
  const factors = new Map<bigint, number>();
  let rest = a;
  const small = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (const p of small) {
    while (rest % p === 0n) {
      factors.set(p, (factors.get(p) ?? 0) + 1);
      rest /= p;
    }
  }
  let p = 41n;
  while (p * p <= rest && p < 1_000_000n) {
    if (rest % p === 0n) {
      factors.set(p, (factors.get(p) ?? 0) + 1);
      rest /= p;
    } else {
      p += 2n;
    }
  }
  if (rest > 1n) factors.set(rest, (factors.get(rest) ?? 0) + 1);
  return factors;
}

function divisors(n: bigint): bigint[] {
  const a = n < 0n ? -n : n;
  if (a === 0n) return [1n];
  let out = [1n];
  for (const [prime, exp] of primeFactors(a)) {
    const base: bigint[] = [];
    let pk = 1n;
    for (let e = 0; e <= exp; e++) {
      base.push(pk);
      pk *= prime;
    }
    const next: bigint[] = [];
    for (const d of out) for (const b of base) next.push(d * b);
    out = next;
  }
  return out;
}

void isqrt;

/**
 * Extract every rational root of a square-free polynomial exactly using the
 * rational-root theorem: candidates are p/q with p dividing the constant term
 * and q dividing the leading coefficient. Each confirmed root is removed by
 * exact division. Irrational roots remain in the returned remainder, which is
 * still square-free. A unit fraction of large coefficients is used implicitly
 * because evaluation works directly over Q.
 */
export function extractRationalRoots(poly: Poly): {
  rationalRoots: Frac[];
  remainder: Poly;
} {
  if (poly.isConstant() || poly.isZero()) return { rationalRoots: [], remainder: poly };
  const roots: Frac[] = [];
  let current = poly;

  // Peel off the zero root first.
  while (current.at(0).isZero() && !current.isConstant()) {
    roots.push(Frac.ZERO);
    current = shiftDown(current);
  }
  if (current.isConstant()) return { rationalRoots: roots, remainder: current };

  // Convert to a primitive integer polynomial: multiply every coefficient by
  // the LCM of denominators, then divide by the content GCD. The rational-root
    // theorem applies to integer polynomials with numerator p | a0, q | an.
  let lcm = 1n;
  for (const c of current.coeff) lcm = (lcm * c.d) / bigIntGcd(lcm, c.d);
  const intCoeff = current.coeff.map((c) => (c.n * lcm) / c.d);
  let content = 0n;
  for (const ic of intCoeff) content = bigIntGcd(content, ic);
  const primitive = intCoeff.map((ic) => ic / (content === 0n ? 1n : content));

  const a0 = primitive[0]!;
  const an = primitive[primitive.length - 1]!;
  const ps = divisors(a0);
  const qs = divisors(an);
  const seen = new Set<string>();
  for (const qn of qs) {
    for (const pn of ps) {
      for (const sign of [1n, -1n]) {
        const candidate = Frac.from(pn * sign, qn);
        const key = candidate.toString();
        if (seen.has(key)) continue;
        seen.add(key);
        if (current.eval(candidate).isZero()) {
          roots.push(candidate);
          current = current.divmod(linear(candidate)).q;
          if (current.isConstant()) return { rationalRoots: roots, remainder: current };
        }
      }
    }
  }

  return { rationalRoots: roots, remainder: current };
}

function linear(r: Frac): Poly {
  return new Poly([r.neg(), Frac.ONE]);
}

function shiftDown(p: Poly): Poly {
  return new Poly(p.coeff.slice(1));
}

export { bigIntGcd };

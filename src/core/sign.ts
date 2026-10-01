import { Frac, fcmp } from './frac.js';
import { Poly, psignAt } from './poly.js';

// Sign of a polynomial on an open interval that is certified (by the caller)
// to contain no root. Then sign is constant and equals the sign at any exact
// interior rational probe. Endpoint signs are reported separately so that an
// endpoint root is visible without making the open interval "zero".
export interface SignReport {
  interiorSign: -1 | 0 | 1;
  leftSign: -1 | 0 | 1;
  rightSign: -1 | 0 | 1;
  probe: Frac;
  interiorLabel: 'positive' | 'negative' | 'zero';
  basis: string;
}

export function signOnInterval(p: Poly, a: Frac, b: Frac): SignReport {
  if (fcmp(a, b) >= 0) throw new Error('SIGN_BAD_INTERVAL');
  // Probe at the exact midpoint (never approximate).
  const probe: Frac = { n: a.n * b.d + b.n * a.d, d: 2n * a.d * b.d };
  const reduced = reduceFrac(probe);
  const interior = psignAt(p, reduced);
  return {
    interiorSign: interior,
    leftSign: psignAt(p, a),
    rightSign: psignAt(p, b),
    probe: reduced,
    interiorLabel: interior === 1 ? 'positive' : interior === -1 ? 'negative' : 'zero',
    basis: `Exact evaluation at midpoint ${rt(reduced)}; sign constant because interval contains no root (certified by Sturm isolation).`,
  };
}

function reduceFrac(x: Frac): Frac {
  const g = (u: bigint, v: bigint): bigint => {
    u = u < 0n ? -u : u;
    v = v < 0n ? -v : v;
    while (v) {
      [u, v] = [v, u % v];
    }
    return u === 0n ? 1n : u;
  };
  const h = g(x.n, x.d);
  return { n: x.n / h, d: x.d / h };
}

function rt(x: Frac): string {
  return x.d === 1n ? `${x.n}` : `${x.n}/${x.d}`;
}

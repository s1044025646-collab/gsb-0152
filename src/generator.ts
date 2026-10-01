import { Frac } from './algebra/frac.ts';
import { Poly, linearFactor } from './algebra/poly.ts';

export interface GeneratedCase {
  name: string;
  poly: Poly;
  /** Ground truth: each distinct real root with its multiplicity. */
  realRoots: { root: Frac; multiplicity: number }[];
  description: string;
}

/** Multiply linear factors (x - r)^mult for a list of roots. */
export function productOfRoots(roots: { root: Frac; multiplicity: number }[]): Poly {
  let poly = Poly.ONE;
  for (const { root, multiplicity } of roots) {
    for (let i = 0; i < multiplicity; i++) poly = poly.mul(linearFactor(root));
  }
  return poly;
}

/**
 * Deterministic algebra fixtures. Every case is constructed independently as a
 * product of known linear factors, so root counts and multiplicities are known
 * without relying on the solver under test.
 */
export function generateCases(): GeneratedCase[] {
  return [
    {
      name: 'no-real-roots',
      poly: new Poly([Frac.ONE, Frac.ZERO, Frac.ONE]),
      realRoots: [],
      description: 'x^2 + 1 has no real root',
    },
    {
      name: 'repeated-even-and-simple',
      poly: productOfRoots([
        { root: Frac.ONE, multiplicity: 2 },
        { root: Frac.from(2n), multiplicity: 1 },
        { root: Frac.from(-3n), multiplicity: 1 },
      ]),
      realRoots: [
        { root: Frac.from(-3n), multiplicity: 1 },
        { root: Frac.ONE, multiplicity: 2 },
        { root: Frac.from(2n), multiplicity: 1 },
      ],
      description: '(x-1)^2 (x-2) (x+3)',
    },
    {
      name: 'close-roots',
      poly: productOfRoots([
        { root: Frac.parse('1/1000'), multiplicity: 1 },
        { root: Frac.parse('1/1001'), multiplicity: 1 },
      ]),
      realRoots: [
        { root: Frac.parse('1/1001'), multiplicity: 1 },
        { root: Frac.parse('1/1000'), multiplicity: 1 },
      ],
      description: 'two rational roots 1/1000 and 1/1001 (~1e-6 apart)',
    },
    {
      name: 'zero-root-multiplicity',
      poly: productOfRoots([
        { root: Frac.ZERO, multiplicity: 3 },
        { root: Frac.ONE, multiplicity: 1 },
      ]),
      realRoots: [
        { root: Frac.ZERO, multiplicity: 3 },
        { root: Frac.ONE, multiplicity: 1 },
      ],
      description: 'x^3 (x-1)',
    },
    {
      name: 'large-numerator-denominator',
      poly: productOfRoots([
        { root: Frac.parse('1234567890123456789/987654321098765432'), multiplicity: 2 },
        { root: Frac.parse('-999999999999999989/777777777777777753'), multiplicity: 1 },
      ]),
      realRoots: [
        { root: Frac.parse('-999999999999999989/777777777777777753'), multiplicity: 1 },
        { root: Frac.parse('1234567890123456789/987654321098765432'), multiplicity: 2 },
      ],
      description: 'roots with very large numerators/denominators',
    },
    {
      name: 'endpoint-roots',
      poly: productOfRoots([
        { root: Frac.ZERO, multiplicity: 1 },
        { root: Frac.ONE, multiplicity: 1 },
        { root: Frac.from(2n), multiplicity: 1 },
      ]),
      realRoots: [
        { root: Frac.ZERO, multiplicity: 1 },
        { root: Frac.ONE, multiplicity: 1 },
        { root: Frac.from(2n), multiplicity: 1 },
      ],
      description: 'x(x-1)(x-2) with roots at common interval endpoints 0,1,2',
    },
    {
      name: 'irrational-conjugate-pair',
      poly: new Poly([Frac.from(-2n), Frac.ZERO, Frac.ONE]),
      realRoots: [
        { root: Frac.parse('-1414213562/1000000000'), multiplicity: 1 },
        { root: Frac.parse('1414213562/1000000000'), multiplicity: 1 },
      ],
      description: 'x^2-2 has two irrational roots (ground truth expressed as decimals here only)',
    },
  ];
}

/**
 * Apply a non-zero rational scaling to every coefficient. Root isolation must
 * be invariant under such scaling.
 */
export function scalePolynomial(poly: Poly, factor: Frac): Poly {
  return poly.scale(factor);
}

export function coeffsAsStrings(poly: Poly): string[] {
  return poly.coeff.map((c) => c.toString());
}

import { parsePoly, primitiveIntegers, polyGcd, pmul } from '../src/core/poly.js';
import { squareFree } from '../src/core/squarefree.js';
import { sturmSequence, sturmCountAll } from '../src/core/sturm.js';
import { isolateFactors, cauchyBound, fmt } from '../src/core/isolation.js';
import { parseFrac } from '../src/core/frac.js';

function check(label: string, got: unknown, want: unknown) {
  const norm = (x: unknown): string => JSON.stringify(x, (_k, v) =>
    typeof v === 'bigint' ? `${v}n` : v);
  const ok = norm(got) === norm(want);
  console.log(ok ? 'PASS' : 'FAIL', label, ok ? '' : `got=${norm(got)} want=${norm(want)}`);
}

// (x-1)^2 (x+2) = x^3 - 3x + 2
{
  const p = parsePoly(['2', '-3', '0', '1']);
  const sf = squareFree(p);
  console.log('sqf', sf.factors.map((f) => [f.multiplicity, primitiveIntegers(f.factor)]));
}

// x^2
{
  const p = parsePoly(['0', '0', '1']);
  const sf = squareFree(p);
  check('x^2 factors', sf.factors.map((f) => [f.multiplicity, primitiveIntegers(f.factor)]), [[2, [0n, 1n]]]);
}

// x(x-1)(x+1) = x^3 - x, 3 real roots, one at 0
{
  const p = parsePoly(['0', '-1', '0', '1']);
  const n = sturmCountAll(p, sturmSequence(p));
  check('x^3-x roots', n, 3);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/1000'), maxIterations: 200, maxBits: 200 });
  console.log('x^3-x total', out.totalRealRoots, 'undecided', out.undecidedCount);
  for (const iv of out.intervals) console.log(' ', iv.status, iv.multiplicity, fmt(iv.left), fmt(iv.right));
  check('x^3-x total', out.totalRealRoots, 3);
  check('x^3-x undecided', out.undecidedCount, 0);
}

// x^2+1 no real roots
{
  const p = parsePoly(['1', '0', '1']);
  check('x^2+1 roots', sturmCountAll(p, sturmSequence(p)), 0);
}

// gcd of x^2-1 and (x-1)
{
  const a = parsePoly(['-1', '0', '1']);
  const b = parsePoly(['-1', '1']);
  check('gcd', primitiveIntegers(polyGcd(a, b)), [-1n, 1n]);
}

// repeated (2x-3)^3 (x+1)^2, roots 3/2 mult3, -1 mult2
{
  const f = parsePoly(['-3/2', '1']);
  const g = parsePoly(['1', '1']);
  const p = pmul(pmul(pmul(f, f), f), pmul(g, g));
  const sf = squareFree(p);
  console.log('R sqf', sf.factors.map((z) => [z.multiplicity, primitiveIntegers(z.factor)]));
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/10000'), maxIterations: 400, maxBits: 200 });
  check('R total', out.totalRealRoots, 2);
  check('R undecided', out.undecidedCount, 0);
  for (const iv of out.intervals) console.log(' ', iv.status, iv.multiplicity, fmt(iv.left), fmt(iv.right), iv.reason.slice(0, 40));
  console.log('cauchy', fmt(cauchyBound(p)));
}

// x^2-2, two irrational roots +/-sqrt(2), narrow target
{
  const p = parsePoly(['-2', '0', '1']);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/100000'), maxIterations: 400, maxBits: 300 });
  check('x^2-2 total', out.totalRealRoots, 2);
  check('x^2-2 undecided', out.undecidedCount, 0);
  for (const iv of out.intervals) console.log(' ', iv.status, fmt(iv.left), fmt(iv.right), iv.display);
}

// close roots: (x-1/1000)(x-1/1001)
{
  const a = parsePoly(['-1/1000', '1']);
  const b = parsePoly(['-1/1001', '1']);
  const p = pmul(a, b);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/10000000'), maxIterations: 2000, maxBits: 300 });
  check('close total', out.totalRealRoots, 2);
  check('close undecided', out.undecidedCount, 0);
  for (const iv of out.intervals) console.log(' close', iv.status, fmt(iv.left), fmt(iv.right), iv.display);
}

// budget exhaustion leaves undecided
{
  const a = parsePoly(['-1/1000', '1']);
  const b = parsePoly(['-1/1001', '1']);
  const p = pmul(a, b);
  const sf = squareFree(p);
  const out = isolateFactors(sf.factors, { maxWidth: parseFrac('1/10'), maxIterations: 3, maxBits: 300 });
  console.log('budget exhausted it=', out.iterationsUsed, 'undecided', out.undecidedCount, 'exhausted', out.exhausted);
  check('budget keeps undecided', out.undecidedCount >= 1, true);
}

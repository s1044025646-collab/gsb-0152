import { Frac, parseFrac, fracToString, fcmp } from '../core/frac.js';
import { parsePoly, Poly, degree, MAX_DEGREE, polyToPretty, polyToCoeffStrings, pmul, psignAt } from '../core/poly.js';
import { squareFree } from '../core/squarefree.js';
import { sturmSequence, sturmCountIn } from '../core/sturm.js';
import { isolateFactors, cauchyBound, AnalysisParams, RootInterval } from '../core/isolation.js';
import { signOnInterval } from '../core/sign.js';
import { buildProof } from '../core/proof.js';
import { Repo, Page, Paged, PolyRow, RunRow, IntervalRow } from '../db/repo.js';
import { AppError } from './errors.js';

export interface CreatePolyInput {
  coefficients?: unknown;
  terms?: unknown;
  alias?: string;
}

export interface AnalyzeInput {
  maxWidth?: string;
  maxIterations?: number;
  maxBits?: number;
  requestKey?: string;
}

const DEFAULTS = {
  maxWidth: '1/1000000',
  maxIterations: 5000,
  maxBits: 1024,
};

export class Service {
  constructor(private repo: Repo) {}

  createPolynomial(input: CreatePolyInput): { row: PolyRow; created: boolean } {
    let coeffs: unknown;
    if (input.coefficients !== undefined) coeffs = input.coefficients;
    else if (input.terms !== undefined) coeffs = input.terms;
    else throw new AppError('VALIDATION_ERROR', 'Provide "coefficients" (array indexed by degree) or "terms" (object degree->coeff).');
    let p: Poly;
    try {
      p = parsePoly(coeffs);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'POLY_DEGREE_OUT_OF_RANGE') {
        throw new AppError('DEGREE_EXCEEDED', `Polynomial degree must be <= ${MAX_DEGREE}.`);
      }
      throw new AppError('VALIDATION_ERROR', `Invalid polynomial: ${msg}`);
    }
    return this.repo.upsertPolynomial(polyToCoeffStrings(p), input.alias);
  }

  resolvePoly(idOrAlias: string): { row: PolyRow; poly: Poly } {
    const row = this.repo.resolvePolynomial(idOrAlias);
    if (!row) throw new AppError('NOT_FOUND', `Polynomial '${idOrAlias}' not found.`);
    return { row, poly: parsePoly(row.coefficients) };
  }

  listPolynomials(page: Page): Paged<PolyRow> {
    return this.repo.listPolynomials(page);
  }

  private parseParams(input: AnalyzeInput): AnalysisParams {
    const widthStr = input.maxWidth ?? DEFAULTS.maxWidth;
    let maxWidth: Frac;
    try {
      maxWidth = parseFrac(widthStr);
    } catch (e) {
      throw new AppError('VALIDATION_ERROR', `Invalid maxWidth: ${(e as Error).message}`);
    }
    if (fcmp(maxWidth, { n: 0n, d: 1n }) <= 0) {
      throw new AppError('VALIDATION_ERROR', 'maxWidth must be a positive rational number.');
    }
    const maxIterations = input.maxIterations ?? DEFAULTS.maxIterations;
    const maxBits = input.maxBits ?? DEFAULTS.maxBits;
    if (!Number.isInteger(maxIterations) || maxIterations < 1) {
      throw new AppError('VALIDATION_ERROR', 'maxIterations must be a positive integer.');
    }
    if (!Number.isInteger(maxBits) || maxBits < 16) {
      throw new AppError('VALIDATION_ERROR', 'maxBits must be an integer >= 16.');
    }
    return { maxWidth, maxIterations, maxBits };
  }

  analyze(polyRef: string, input: AnalyzeInput): {
    run: RunRow; intervals: IntervalRow[]; proof: unknown; created: boolean;
  } {
    const { row, poly } = this.resolvePoly(polyRef);
    const params = this.parseParams(input);
    // Re-run idempotency check up front (repo also enforces the unique key).
    if (input.requestKey) {
      const existing = this.repo.getRunByRequestKey(row.id, input.requestKey);
      if (existing) {
        return {
          run: existing,
          intervals: this.repo.allIntervals(existing.id),
          proof: this.repo.getProof(existing.id),
          created: false,
        };
      }
    }
    if (poly.length === 0) {
      // Zero polynomial: every number is a root; root isolation is undefined.
      const outcome = {
        totalRealRoots: null as number | null,
        isolatedCount: 0,
        undecidedCount: 0,
        intervals: [] as RootInterval[],
        exhausted: { iterations: false, bits: false },
        iterationsUsed: 0,
        notes: ['Zero polynomial: root set is the whole real line; no finite isolation exists.'],
      };
      const { row: run, created } = this.repo.createRun(row.id, params, outcome as never, input.requestKey);
      const proof = buildProof(poly, [], [], 0, 0, 0);
      this.repo.saveProof(run.id, JSON.stringify(proof));
      return { run, intervals: [], proof, created };
    }
    const sf = squareFree(poly);
    const outcome = isolateFactors(sf.factors, params);
    const { row: run, created } = this.repo.createRun(row.id, params, outcome, input.requestKey);
    const proof = buildProof(
      poly, sf.factors, outcome.intervals,
      outcome.totalRealRoots, outcome.isolatedCount, outcome.undecidedCount,
    );
    this.repo.saveProof(run.id, JSON.stringify(proof));
    return { run, intervals: this.repo.allIntervals(run.id), proof, created };
  }

  getRun(polyRef: string, version?: number): { run: RunRow; intervals: IntervalRow[]; proof: unknown } {
    const { row } = this.resolvePoly(polyRef);
    const run = version === undefined
      ? this.repo.latestRun(row.id)
      : this.repo.getRunByVersion(row.id, version);
    if (!run) throw new AppError('NOT_FOUND', version ? `Version ${version} not found.` : 'No analysis run exists yet.');
    return { run, intervals: this.repo.allIntervals(run.id), proof: this.repo.getProof(run.id) };
  }

  listRuns(polyRef: string, page: Page): Paged<RunRow> {
    const { row } = this.resolvePoly(polyRef);
    return this.repo.listRuns(row.id, page);
  }

  listIntervals(polyRef: string, version: number | undefined, page: Page): Paged<IntervalRow> {
    const { run } = this.getRun(polyRef, version);
    return this.repo.listIntervals(run.id, page);
  }

  countRoots(polyRef: string, aStr: string | null, bStr: string | null, requestKey?: string): {
    count: number; bounded: boolean; left: string | null; right: string | null;
  } {
    const { row, poly } = this.resolvePoly(polyRef);
    if (poly.length === 0) {
      throw new AppError('ZERO_POLYNOMIAL_ROOT_COUNT_UNDEFINED',
        'The zero polynomial vanishes everywhere; a finite root count is undefined.');
    }
    let a: Frac | null = null;
    let b: Frac | null = null;
    try {
      if (aStr !== null) a = parseFrac(aStr);
      if (bStr !== null) b = parseFrac(bStr);
    } catch (e) {
      throw new AppError('VALIDATION_ERROR', `Invalid endpoint: ${(e as Error).message}`);
    }
    const seq = sturmSequence(squareFreeProduct(poly));
    let count: number;
    if (a && b) {
      if (fcmp(a, b) >= 0) throw new AppError('BAD_INTERVAL', 'Require left < right.');
      count = sturmCountIn(squareFreeProduct(poly), a, b, seq);
    } else {
      // Whole real line via Cauchy bound.
      const R = cauchyBound(squareFreeProduct(poly));
      count = sturmCountIn(squareFreeProduct(poly), { n: -R.n, d: R.d }, R, seq);
    }
    this.repo.recordRootCount(row.id, null, !!(a && b), a, b, count, requestKey);
    return {
      count,
      bounded: !!(a && b),
      left: a ? fracToString(a) : null,
      right: b ? fracToString(b) : null,
    };
  }

  signAt(polyRef: string, aStr: string, bStr: string, requestKey?: string): unknown {
    const { row, poly } = this.resolvePoly(polyRef);
    let a: Frac;
    let b: Frac;
    try {
      a = parseFrac(aStr);
      b = parseFrac(bStr);
    } catch (e) {
      throw new AppError('VALIDATION_ERROR', `Invalid endpoint: ${(e as Error).message}`);
    }
    if (fcmp(a, b) >= 0) throw new AppError('BAD_INTERVAL', 'Require left < right.');
    // Guard: certify the open interval contains no root, else sign is not
    // constant and a single interior label would be misleading.
    const sfp = squareFreeProduct(poly);
    const rootsInside = poly.length === 0 ? 1 : sturmCountIn(sfp, a, b, sturmSequence(sfp))
      - (rootAt(sfp, a) ? 1 : 0) - (rootAt(sfp, b) ? 1 : 0);
    if (poly.length === 0) {
      throw new AppError('ZERO_POLYNOMIAL_ROOT_COUNT_UNDEFINED', 'Zero polynomial is identically zero.');
    }
    if (rootsInside !== 0) {
      throw new AppError('INTERVAL_CONTAINS_ROOT',
        `Open interval (${fracToString(a)}, ${fracToString(b)}) contains ${rootsInside} root(s); sign is not constant. Query a certified isolating interval instead.`);
    }
    const report = signOnInterval(poly, a, b);
    this.repo.recordSignQuery({
      polyId: row.id, runId: null, a, b,
      interior: report.interiorSign, left: report.leftSign, right: report.rightSign,
      basis: report.basis, requestKey,
    });
    return {
      left: fracToString(a),
      right: fracToString(b),
      interiorSign: report.interiorLabel,
      leftEndpointSign: signLabel(report.leftSign),
      rightEndpointSign: signLabel(report.rightSign),
      exactProbe: fracToString(report.probe),
      basis: report.basis,
    };
  }
}

function signLabel(s: -1 | 0 | 1): string {
  return s === 1 ? 'positive' : s === -1 ? 'negative' : 'zero';
}

function rootAt(p: Poly, x: Frac): boolean {
  return psignAt(p, x) === 0;
}

// Distinct real roots are those of the square-free part gcd(f,f') removed.
export function squareFreeProduct(p: Poly): Poly {
  const sf = squareFree(p);
  // Product of distinct square-free factors (multiplicity collapsed to 1).
  let acc: Poly = [{ n: 1n, d: 1n }];
  for (const { factor } of sf.factors) acc = pmul(acc, factor);
  return acc.length === 0 ? p : acc;
}

export function describePoly(p: Poly): string {
  return polyToPretty(p);
}

export { degree };

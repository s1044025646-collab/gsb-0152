import { Frac } from './algebra/frac.ts';
import { parsePolyCoeffs, Poly, PolyValidationError } from './algebra/poly.ts';
import { sturmSequence, countRootsOpen, countRootsReal } from './algebra/sturm.ts';
import {
  DEFAULT_PARAMS,
  analyzePolynomial,
  signAtPoint,
  signOnInterval,
  coefficientSignVariations,
  type AnalysisParams,
} from './algebra/isolator.ts';
import { Repository, codedError } from './db/repo.ts';

export const MAX_DEGREE = 12;

export function validateParams(raw: unknown): AnalysisParams {
  if (typeof raw !== 'object' || raw === null) throw codedError('INVALID_PARAMS', 400);
  const obj = raw as Record<string, unknown>;
  const params: AnalysisParams = { ...DEFAULT_PARAMS };
  if (obj.width !== undefined) {
    if (typeof obj.width !== 'string') throw codedError('INVALID_WIDTH', 400);
    try {
      const w = Frac.parse(obj.width);
      if (w.sign() <= 0) throw new Error();
      params.width = obj.width;
    } catch {
      throw codedError('INVALID_WIDTH', 400, 'width must be a positive fraction string');
    }
  }
  for (const key of ['maxIterations', 'maxBits'] as const) {
    if (obj[key] !== undefined) {
      const v = obj[key];
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
        throw codedError('INVALID_BUDGET', 400, `${key} must be a positive integer`);
      }
      params[key] = v;
    }
  }
  if (obj.bound !== undefined) {
    if (typeof obj.bound !== 'string') throw codedError('INVALID_BOUND', 400);
    try {
      if (Frac.parse(obj.bound).sign() <= 0) throw new Error();
      params.bound = obj.bound;
    } catch {
      throw codedError('INVALID_BOUND', 400, 'bound must be a positive fraction string');
    }
  }
  return params;
}

export class PolyService {
  private readonly repo: Repository;

  constructor(repo: Repository) {
    this.repo = repo;
  }

  createPolynomial(rawCoeffs: unknown) {
    let poly: Poly;
    try {
      poly = parsePolyCoeffs(rawCoeffs, MAX_DEGREE);
    } catch (err) {
      if (err instanceof PolyValidationError || (err as { code?: string }).code === 'INVALID_FRACTION') {
        throw codedError('INVALID_POLYNOMIAL', 400, (err as Error).message);
      }
      throw err;
    }
    const { row, created } = this.repo.upsertPolynomial([...poly.coeff]);
    return { polynomial: this.polyDto(row), created };
  }

  private polyDto(row: {
    id: string;
    coeffs_json: string;
    degree: number;
    is_zero: number;
    created_at: string;
  }) {
    return {
      id: row.id,
      coefficients: JSON.parse(row.coeffs_json) as string[],
      degree: row.degree,
      isZero: row.is_zero === 1,
      createdAt: row.created_at,
    };
  }

  getPolynomial(id: string) {
    const row = this.repo.getPolynomial(id);
    if (!row) throw codedError('POLYNOMIAL_NOT_FOUND', 404);
    return this.polyDto(row);
  }

  listPolynomials(limit: number, offset: number) {
    const { rows, total } = this.repo.listPolynomials(limit, offset);
    return { items: rows.map((r) => this.polyDto(r)), total, limit, offset };
  }

  /** Distinct real roots in an open rational interval (a,b), per square-free factor multiplicity. */
  countRoots(polyId: string, aStr: string, bStr: string) {
    const poly = this.requirePoly(polyId);
    let a: Frac;
    let b: Frac;
    try {
      a = Frac.parse(aStr);
      b = Frac.parse(bStr);
    } catch {
      throw codedError('INVALID_FRACTION', 400);
    }
    if (a.cmp(b) >= 0) throw codedError('INVALID_INTERVAL', 400, 'require a < b');
    if (poly.isZero()) {
      throw codedError('ZERO_POLYNOMIAL', 400, 'the zero polynomial has every point as a root');
    }
    let distinct = 0;
    const byMultiplicity: Record<number, number> = {};
    if (!poly.isConstant()) {
      for (const { factor, multiplicity } of poly.squareFree().factors) {
        const seq = sturmSequence(factor);
        const c = countRootsOpen(factor, seq, a, b);
        distinct += c;
        byMultiplicity[multiplicity] = (byMultiplicity[multiplicity] ?? 0) + c;
      }
    }
    const endpoints = {
      loIsRoot: poly.eval(a).isZero(),
      hiIsRoot: poly.eval(b).isZero(),
    };
    return { interval: `(${a}, ${b})`, distinctRootsInside: distinct, byMultiplicity, endpoints };
  }

  createAnalysis(polyId: string, paramsRaw: unknown, idempotencyKey?: string) {
    this.getPolynomial(polyId); // 404 if missing
    const params = validateParams(paramsRaw);
    const { analysis, outcome, created } = this.repo.createAnalysis(polyId, params, idempotencyKey);
    return {
      analysisId: analysis.id,
      version: analysis.version,
      status: analysis.status,
      created,
      params,
      outcome,
    };
  }

  listAnalyses(polyId: string, limit: number, offset: number) {
    this.getPolynomial(polyId);
    const { rows, total } = this.repo.listAnalyses(polyId, limit, offset);
    return { items: rows, total, limit, offset };
  }

  getAnalysis(analysisId: string) {
    const analysis = this.repo.getAnalysis(analysisId);
    if (!analysis) throw codedError('ANALYSIS_NOT_FOUND', 404);
    return {
      id: analysis.id,
      polyId: analysis.poly_id,
      version: analysis.version,
      status: analysis.status,
      params: JSON.parse(analysis.params_json as string),
      totalRealRoots: analysis.total_real,
      isolatedCount: analysis.isolated_count,
      pendingCount: analysis.pending_count,
      budgetExhausted: analysis.budget_exhausted === 1,
      createdAt: analysis.created_at,
    };
  }

  listRoots(analysisId: string, limit: number, offset: number) {
    this.getAnalysis(analysisId);
    const { rows, total } = this.repo.listRoots(analysisId, limit, offset);
    return { items: rows, total, limit, offset };
  }

  listUnresolved(analysisId: string) {
    this.getAnalysis(analysisId);
    return { items: this.repo.listUnresolved(analysisId) };
  }

  /**
   * Continue refinement with a revised width/budget. Always appends a new
   * version; old intervals and evidence remain untouched.
   */
  refine(polyId: string, paramsRaw: unknown, idempotencyKey?: string) {
    return this.createAnalysis(polyId, paramsRaw, idempotencyKey);
  }

  signPoint(polyId: string, xStr: string) {
    const poly = this.requirePoly(polyId);
    let x: Frac;
    try {
      x = Frac.parse(xStr);
    } catch {
      throw codedError('INVALID_FRACTION', 400);
    }
    return { point: xStr, sign: signAtPoint(poly, x), evaluated: poly.eval(x).toString() };
  }

  signInterval(polyId: string, aStr: string, bStr: string) {
    const poly = this.requirePoly(polyId);
    let a: Frac;
    let b: Frac;
    try {
      a = Frac.parse(aStr);
      b = Frac.parse(bStr);
    } catch {
      throw codedError('INVALID_FRACTION', 400);
    }
    try {
      return { interval: `(${a}, ${b})`, ...signOnInterval(poly, a, b) };
    } catch {
      throw codedError('INVALID_INTERVAL', 400);
    }
  }

  descartes(polyId: string) {
    const poly = this.requirePoly(polyId);
    return {
      positiveAxisUpperBound: coefficientSignVariations(poly),
      note: 'Descartes gives an upper bound on positive roots; evidence remains Sturm-based',
    };
  }

  /** Compare two immutable analysis versions for the same polynomial. */
  compareVersions(polyId: string, v1: number, v2: number) {
    this.getPolynomial(polyId);
    const rows = this.repo.listAnalyses(polyId, 100000, 0).rows as Record<string, unknown>[];
    const find = (v: number) => rows.find((r) => Number(r.version) === v);
    const a = find(v1);
    const b = find(v2);
    if (!a || !b) throw codedError('VERSION_NOT_FOUND', 404);
    return {
      polyId,
      versions: {
        [v1]: {
          params: JSON.parse(a.params_json as string),
          totalRealRoots: a.total_real,
          isolatedCount: a.isolated_count,
          pendingCount: a.pending_count,
          status: a.status,
        },
        [v2]: {
          params: JSON.parse(b.params_json as string),
          totalRealRoots: b.total_real,
          isolatedCount: b.isolated_count,
          pendingCount: b.pending_count,
          status: b.status,
        },
      },
      pendingDelta: Number(a.pending_count) - Number(b.pending_count),
      sameRootCount: Number(a.total_real) === Number(b.total_real),
    };
  }

  proofSummary(analysisId: string) {
    return this.repo.saveProofSummary(analysisId);
  }

  private requirePoly(id: string): Poly {
    const row = this.repo.getPolynomial(id);
    if (!row) throw codedError('POLYNOMIAL_NOT_FOUND', 404);
    return this.repo.loadPoly(row);
  }
}

export { analyzePolynomial, countRootsReal, sturmSequence };

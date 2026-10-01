import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Frac } from '../algebra/frac.ts';
import { Poly } from '../algebra/poly.ts';
import { analyzePolynomial, type AnalysisParams, type AnalysisOutcome } from '../algebra/isolator.ts';

export interface Clock {
  now(): string;
  uuid(): string;
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString(),
  uuid: () => randomUUID(),
};

export interface PolyRow {
  id: string;
  coeffs_json: string;
  canonical: string;
  degree: number;
  is_zero: number;
  created_at: string;
}

export function canonicalKey(coeffs: Frac[]): string {
  const trimmed = new Poly(coeffs);
  return JSON.stringify(trimmed.coeff.map((c) => c.toString()));
}

export class Repository {
  private readonly db: DatabaseSync;
  private readonly clock: Clock;

  constructor(db: DatabaseSync, clock: Clock = defaultClock) {
    this.db = db;
    this.clock = clock;
  }

  /** Insert a polynomial; identical canonical forms collapse to one row. */
  upsertPolynomial(coeffs: Frac[]): { row: PolyRow; created: boolean } {
    const poly = new Poly(coeffs);
    const canonical = canonicalKey(coeffs);
    const existing = this.db
      .prepare('SELECT * FROM polynomials WHERE canonical = ?')
      .get(canonical) as PolyRow | undefined;
    if (existing) return { row: existing, created: false };
    const id = this.clock.uuid();
    this.db
      .prepare(
        `INSERT INTO polynomials(id, coeffs_json, canonical, degree, is_zero, created_at)
         VALUES(?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        JSON.stringify(poly.coeff.map((c) => c.toString())),
        canonical,
        poly.degree(),
        poly.isZero() ? 1 : 0,
        this.clock.now(),
      );
    return { row: this.getPolynomial(id)!, created: true };
  }

  getPolynomial(id: string): PolyRow | undefined {
    return this.db.prepare('SELECT * FROM polynomials WHERE id = ?').get(id) as PolyRow | undefined;
  }

  listPolynomials(limit: number, offset: number): { rows: PolyRow[]; total: number } {
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM polynomials').get() as { c: number }).c;
    const rows = this.db
      .prepare('SELECT * FROM polynomials ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as PolyRow[];
    return { rows, total: Number(total) };
  }

  loadPoly(row: PolyRow): Poly {
    return new Poly((JSON.parse(row.coeffs_json) as string[]).map((s) => Frac.parse(s)));
  }

  listAnalyses(polyId: string, limit: number, offset: number) {
    const total = (
      this.db.prepare('SELECT COUNT(*) AS c FROM analyses WHERE poly_id = ?').get(polyId) as {
        c: number;
      }
    ).c;
    const rows = this.db
      .prepare(
        `SELECT id, poly_id, version, params_json, status, total_real, isolated_count,
                pending_count, budget_exhausted, created_at
         FROM analyses WHERE poly_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`,
      )
      .all(polyId, limit, offset) as Record<string, unknown>[];
    return { rows, total: Number(total) };
  }

  getAnalysis(id: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
  }

  /**
   * Create a new, immutable analysis version. Parameter revisions never
   * overwrite prior versions; versions are append-only. The computation and
   * all derived rows commit in one transaction.
   */
  createAnalysis(
    polyId: string,
    params: AnalysisParams,
    idempotencyKey?: string,
  ): { analysis: Record<string, unknown>; outcome: AnalysisOutcome; created: boolean } {
    const polyRow = this.getPolynomial(polyId);
    if (!polyRow) throw codedError('POLYNOMIAL_NOT_FOUND', 404);

    if (idempotencyKey) {
      const prior = this.db
        .prepare('SELECT result_json FROM operations WHERE idempotency_key = ?')
        .get(idempotencyKey) as { result_json: string } | undefined;
      if (prior) {
        const parsed = JSON.parse(prior.result_json) as { analysisId: string };
        const analysis = this.getAnalysis(parsed.analysisId)!;
        return {
          analysis,
          outcome: JSON.parse(analysis.result_json as string) as AnalysisOutcome,
          created: false,
        };
      }
    }

    const poly = this.loadPoly(polyRow);
    const outcome = analyzePolynomial(poly, params);
    const analysisId = this.clock.uuid();
    const createdAt = this.clock.now();

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const versionRow = this.db
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM analyses WHERE poly_id = ?')
        .get(polyId) as { v: number };
      const version = Number(versionRow.v) + 1;
      this.db
        .prepare(
          `INSERT INTO analyses(id, poly_id, version, params_json, status, result_json,
             total_real, isolated_count, pending_count, budget_exhausted, created_at)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          analysisId,
          polyId,
          version,
          JSON.stringify(params),
          outcome.budgetExhausted || outcome.pendingCount > 0 ? 'incomplete' : 'complete',
          JSON.stringify(outcome),
          outcome.totalRealRoots,
          outcome.isolatedCount,
          outcome.pendingCount,
          outcome.budgetExhausted ? 1 : 0,
          createdAt,
        );

      outcome.isolatedRoots.forEach((root, idx) => {
        this.db
          .prepare(
            `INSERT INTO roots(id, analysis_id, root_seq, kind, multiplicity, lo, hi, exact,
               approx, width, evidence, status)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.clock.uuid(),
            analysisId,
            idx,
            root.kind,
            root.multiplicity,
            root.lo,
            root.hi,
            root.exact,
            root.approx,
            root.width,
            root.evidence,
            root.status,
          );
      });

      outcome.unresolvedRegions.forEach((region) => {
        this.db
          .prepare(
            `INSERT INTO unresolved_regions(id, analysis_id, lo, hi, multiplicity, reason)
             VALUES(?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.clock.uuid(),
            analysisId,
            region.lo,
            region.hi,
            region.multiplicity,
            region.reason,
          );
      });

      if (idempotencyKey) {
        this.db
          .prepare(
            `INSERT INTO operations(id, idempotency_key, type, payload_json, result_json, created_at)
             VALUES(?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.clock.uuid(),
            idempotencyKey,
            'create_analysis',
            JSON.stringify({ polyId, params }),
            JSON.stringify({ analysisId }),
            createdAt,
          );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return {
      analysis: this.getAnalysis(analysisId)!,
      outcome,
      created: true,
    };
  }

  listRoots(analysisId: string, limit: number, offset: number) {
    const total = (
      this.db.prepare('SELECT COUNT(*) AS c FROM roots WHERE analysis_id = ?').get(analysisId) as {
        c: number;
      }
    ).c;
    const rows = this.db
      .prepare('SELECT * FROM roots WHERE analysis_id = ? ORDER BY root_seq LIMIT ? OFFSET ?')
      .all(analysisId, limit, offset) as Record<string, unknown>[];
    return { rows, total: Number(total) };
  }

  listUnresolved(analysisId: string) {
    return this.db
      .prepare('SELECT * FROM unresolved_regions WHERE analysis_id = ?')
      .all(analysisId) as Record<string, unknown>[];
  }

  /** Persist a proof summary so evidence is independently retrievable. */
  saveProofSummary(analysisId: string): Record<string, unknown> {
    const analysis = this.getAnalysis(analysisId);
    if (!analysis) throw codedError('ANALYSIS_NOT_FOUND', 404);
    const outcome = JSON.parse(analysis.result_json as string) as AnalysisOutcome;
    const roots = this.db
      .prepare('SELECT * FROM roots WHERE analysis_id = ? ORDER BY root_seq')
      .all(analysisId) as Record<string, unknown>[];
    const unresolved = this.listUnresolved(analysisId);
    const summary = {
      analysisId,
      polyId: analysis.poly_id,
      degree: outcome.degree,
      method:
        'square-free decomposition over Q (BigInt rationals), exact Euclidean GCD, and Sturm ' +
        'sign-variation counting; rational bisection; no sampling or floating-point root finding',
      totalRealRoots: outcome.totalRealRoots,
      isolatedCount: outcome.isolatedCount,
      pendingCount: outcome.pendingCount,
      completenessClaim: outcome.pendingCount === 0 && !outcome.budgetExhausted,
      roots: roots.map((r) => ({
        kind: r.kind,
        multiplicity: r.multiplicity,
        lo: r.lo,
        hi: r.hi,
        exact: r.exact,
        approx: r.approx,
        width: r.width,
        evidence: r.evidence,
      })),
      unresolved,
      generatedAt: this.clock.now(),
    };
    const id = this.clock.uuid();
    this.db
      .prepare('INSERT INTO proof_summaries(id, analysis_id, summary_json, created_at) VALUES(?, ?, ?, ?)')
      .run(id, analysisId, JSON.stringify(summary), this.clock.now());
    return summary;
  }
}

export function codedError(code: string, status: number, message?: string): Error & {
  code: string;
  status: number;
} {
  return Object.assign(new Error(message ?? code), { code, status });
}

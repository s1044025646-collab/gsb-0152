import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { Frac } from '../core/frac.js';
import { Poly, parsePoly, polyToCoeffStrings } from '../core/poly.js';
import { AnalysisParams, IsolationOutcome, RootInterval } from '../core/isolation.js';

export interface Page {
  limit: number;
  offset: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Clock {
  now: () => string;
  uuid: () => string;
}

export const defaultClock: Clock = {
  now: () => new Date().toISOString(),
  uuid: () => randomUUID(),
};

export interface PolyRow {
  id: string;
  canonical: string;
  coefficients: string[];
  degree: number;
  isZero: boolean;
  createdAt: string;
}

export interface RunRow {
  id: string;
  polynomialId: string;
  version: number;
  params: { maxWidth: string; maxIterations: number; maxBits: number };
  totalRealRoots: number | null;
  isolatedCount: number;
  undecidedCount: number;
  exhaustedIterations: boolean;
  exhaustedBits: boolean;
  iterationsUsed: number;
  createdAt: string;
}

// Canonical key: degree-prefixed exact coefficient list. Zero poly is "0".
export function canonicalKey(p: Poly): string {
  if (p.length === 0) return '0';
  return `${p.length - 1}:${polyToCoeffStrings(p).join(',')}`;
}

function fStr(x: Frac): string {
  return x.d === 1n ? `${x.n}` : `${x.n}/${x.d}`;
}

export class Repo {
  constructor(private db: DatabaseSync, private clock: Clock = defaultClock) {}

  // Idempotent polynomial creation: identical canonical forms map to one row.
  upsertPolynomial(coeffs: unknown, alias?: string): { row: PolyRow; created: boolean } {
    const p = parsePoly(coeffs);
    const canonical = canonicalKey(p);
    const existing = this.db.prepare('SELECT * FROM polynomials WHERE canonical = ?').get(canonical) as
      | Record<string, unknown>
      | undefined;
    if (existing) {
      const row = this.toPolyRow(existing);
      if (alias) this.setAlias(alias, row.id);
      return { row, created: false };
    }
    const id = this.clock.uuid();
    this.db.prepare(
      `INSERT INTO polynomials (id, canonical, coefficients_json, degree, is_zero, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, canonical, JSON.stringify(polyToCoeffStrings(p)), p.length - 1, p.length === 0 ? 1 : 0, this.clock.now());
    if (alias) this.setAlias(alias, id);
    return { row: this.getPolynomial(id)!, created: true };
  }

  setAlias(alias: string, polyId: string): void {
    this.db.prepare(
      `INSERT INTO polynomial_aliases (alias, polynomial_id) VALUES (?, ?)
       ON CONFLICT(alias) DO UPDATE SET polynomial_id=excluded.polynomial_id`,
    ).run(alias, polyId);
  }

  resolvePolynomial(idOrAlias: string): PolyRow | undefined {
    const byId = this.getPolynomial(idOrAlias);
    if (byId) return byId;
    const r = this.db.prepare('SELECT polynomial_id FROM polynomial_aliases WHERE alias = ?').get(idOrAlias) as
      | { polynomial_id: string }
      | undefined;
    return r ? this.getPolynomial(r.polynomial_id) : undefined;
  }

  getPolynomial(id: string): PolyRow | undefined {
    const r = this.db.prepare('SELECT * FROM polynomials WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.toPolyRow(r) : undefined;
  }

  listPolynomials(page: Page): Paged<PolyRow> {
    const total = Number((this.db.prepare('SELECT COUNT(*) c FROM polynomials').get() as { c: number }).c);
    const rows = this.db.prepare(
      'SELECT * FROM polynomials ORDER BY created_at, id LIMIT ? OFFSET ?',
    ).all(page.limit, page.offset) as Record<string, unknown>[];
    return { items: rows.map((r) => this.toPolyRow(r)), total, limit: page.limit, offset: page.offset };
  }

  private toPolyRow(r: Record<string, unknown>): PolyRow {
    return {
      id: r.id as string,
      canonical: r.canonical as string,
      coefficients: JSON.parse(r.coefficients_json as string) as string[],
      degree: Number(r.degree),
      isZero: Number(r.is_zero) === 1,
      createdAt: r.created_at as string,
    };
  }

  // Idempotent run: same (polynomial, requestKey) returns the prior run.
  // New runs always get a new monotonic version; old results are retained.
  createRun(
    polyId: string, params: AnalysisParams,
    outcome: IsolationOutcome | { totalRealRoots: null; isolatedCount: number; undecidedCount: number;
      exhausted: { iterations: boolean; bits: boolean }; iterationsUsed: number; intervals: RootInterval[]; notes: string[] },
    requestKey?: string,
  ): { row: RunRow; created: boolean } {
    if (requestKey) {
      const dup = this.db.prepare(
        'SELECT id FROM analysis_runs WHERE polynomial_id = ? AND request_key = ?',
      ).get(polyId, requestKey) as { id: string } | undefined;
      if (dup) return { row: this.getRun(dup.id)!, created: false };
    }
    const version = Number((this.db.prepare(
      'SELECT COALESCE(MAX(version),0) v FROM analysis_runs WHERE polynomial_id = ?',
    ).get(polyId) as { v: number }).v) + 1;
    const id = this.clock.uuid();
    const paramsJson = JSON.stringify({
      maxWidth: fStr(params.maxWidth),
      maxIterations: params.maxIterations,
      maxBits: params.maxBits,
    });
    const tx = this.db.prepare(
      `INSERT INTO analysis_runs
       (id, polynomial_id, version, params_json, total_real_roots, isolated_count,
        undecided_count, exhausted_iterations, exhausted_bits, iterations_used, request_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insertInterval = this.db.prepare(
      `INSERT INTO intervals
       (id, run_id, ord, left_num, left_den, right_num, right_den, multiplicity,
        status, display, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    );
    this.db.exec('BEGIN');
    try {
      tx.run(
        id, polyId, version, paramsJson,
        outcome.totalRealRoots, outcome.isolatedCount, outcome.undecidedCount,
        outcome.exhausted.iterations ? 1 : 0, outcome.exhausted.bits ? 1 : 0,
        outcome.iterationsUsed, requestKey ?? null, this.clock.now(),
      );
      outcome.intervals.forEach((iv, ord) => {
        insertInterval.run(
          this.clock.uuid(), id, ord,
          `${iv.left.n}`, `${iv.left.d}`, `${iv.right.n}`, `${iv.right.d}`,
          iv.multiplicity, iv.status, iv.display, iv.reason,
        );
      });
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { row: this.getRun(id)!, created: true };
  }

  getRun(id: string): RunRow | undefined {
    const r = this.db.prepare('SELECT * FROM analysis_runs WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? this.toRunRow(r) : undefined;
  }

  latestRun(polyId: string): RunRow | undefined {
    const r = this.db.prepare(
      'SELECT * FROM analysis_runs WHERE polynomial_id = ? ORDER BY version DESC LIMIT 1',
    ).get(polyId) as Record<string, unknown> | undefined;
    return r ? this.toRunRow(r) : undefined;
  }

  getRunByRequestKey(polyId: string, requestKey: string): RunRow | undefined {
    const r = this.db.prepare(
      'SELECT * FROM analysis_runs WHERE polynomial_id = ? AND request_key = ?',
    ).get(polyId, requestKey) as Record<string, unknown> | undefined;
    return r ? this.toRunRow(r) : undefined;
  }

  getRunByVersion(polyId: string, version: number): RunRow | undefined {
    const r = this.db.prepare(
      'SELECT * FROM analysis_runs WHERE polynomial_id = ? AND version = ?',
    ).get(polyId, version) as Record<string, unknown> | undefined;
    return r ? this.toRunRow(r) : undefined;
  }

  listRuns(polyId: string, page: Page): Paged<RunRow> {
    const total = Number((this.db.prepare(
      'SELECT COUNT(*) c FROM analysis_runs WHERE polynomial_id = ?',
    ).get(polyId) as { c: number }).c);
    const rows = this.db.prepare(
      'SELECT * FROM analysis_runs WHERE polynomial_id = ? ORDER BY version DESC LIMIT ? OFFSET ?',
    ).all(polyId, page.limit, page.offset) as Record<string, unknown>[];
    return { items: rows.map((r) => this.toRunRow(r)), total, limit: page.limit, offset: page.offset };
  }

  private toRunRow(r: Record<string, unknown>): RunRow {
    const params = JSON.parse(r.params_json as string) as RunRow['params'];
    return {
      id: r.id as string,
      polynomialId: r.polynomial_id as string,
      version: Number(r.version),
      params,
      totalRealRoots: r.total_real_roots === null ? null : Number(r.total_real_roots),
      isolatedCount: Number(r.isolated_count),
      undecidedCount: Number(r.undecided_count),
      exhaustedIterations: Number(r.exhausted_iterations) === 1,
      exhaustedBits: Number(r.exhausted_bits) === 1,
      iterationsUsed: Number(r.iterations_used),
      createdAt: r.created_at as string,
    };
  }

  listIntervals(runId: string, page: Page): Paged<IntervalRow> {
    const total = Number((this.db.prepare(
      'SELECT COUNT(*) c FROM intervals WHERE run_id = ?',
    ).get(runId) as { c: number }).c);
    const rows = this.db.prepare(
      'SELECT * FROM intervals WHERE run_id = ? ORDER BY ord LIMIT ? OFFSET ?',
    ).all(runId, page.limit, page.offset) as Record<string, unknown>[];
    return { items: rows.map((r) => this.toIntervalRow(r)), total, limit: page.limit, offset: page.offset };
  }

  allIntervals(runId: string): IntervalRow[] {
    const rows = this.db.prepare(
      'SELECT * FROM intervals WHERE run_id = ? ORDER BY ord',
    ).all(runId) as Record<string, unknown>[];
    return rows.map((r) => this.toIntervalRow(r));
  }

  private toIntervalRow(r: Record<string, unknown>): IntervalRow {
    return {
      id: r.id as string,
      runId: r.run_id as string,
      ord: Number(r.ord),
      left: { n: BigInt(r.left_num as string), d: BigInt(r.left_den as string) },
      right: { n: BigInt(r.right_num as string), d: BigInt(r.right_den as string) },
      multiplicity: Number(r.multiplicity),
      status: r.status as RootInterval['status'],
      display: r.display as string,
      reason: r.reason as string,
    };
  }

  saveProof(runId: string, proofJson: string): void {
    this.db.prepare(
      `INSERT INTO proofs (run_id, proof_json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET proof_json=excluded.proof_json, created_at=excluded.created_at`,
    ).run(runId, proofJson, this.clock.now());
  }

  getProof(runId: string): unknown | undefined {
    const r = this.db.prepare('SELECT proof_json FROM proofs WHERE run_id = ?').get(runId) as
      | { proof_json: string }
      | undefined;
    return r ? JSON.parse(r.proof_json) : undefined;
  }

  recordRootCount(
    polyId: string, runId: string | null, bounded: boolean,
    a: Frac | null, b: Frac | null, count: number, requestKey?: string,
  ): { id: string; created: boolean } {
    if (requestKey) {
      const dup = this.db.prepare(
        'SELECT id FROM root_counts WHERE polynomial_id = ? AND request_key = ?',
      ).get(polyId, requestKey) as { id: string } | undefined;
      if (dup) return { id: dup.id, created: false };
    }
    const id = this.clock.uuid();
    this.db.prepare(
      `INSERT INTO root_counts
       (id, polynomial_id, run_id, left_num, left_den, right_num, right_den,
        bounded, count, request_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, polyId, runId,
      a ? `${a.n}` : null, a ? `${a.d}` : null, b ? `${b.n}` : null, b ? `${b.d}` : null,
      bounded ? 1 : 0, count, requestKey ?? null, this.clock.now(),
    );
    return { id, created: true };
  }

  recordSignQuery(row: {
    polyId: string; runId: string | null; a: Frac; b: Frac;
    interior: number; left: number; right: number; basis: string; requestKey?: string;
  }): { id: string; created: boolean } {
    if (row.requestKey) {
      const dup = this.db.prepare(
        'SELECT id FROM sign_queries WHERE polynomial_id = ? AND request_key = ?',
      ).get(row.polyId, row.requestKey) as { id: string } | undefined;
      if (dup) return { id: dup.id, created: false };
    }
    const id = this.clock.uuid();
    this.db.prepare(
      `INSERT INTO sign_queries
       (id, polynomial_id, run_id, left_num, left_den, right_num, right_den,
        interior_sign, left_sign, right_sign, basis, request_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, row.polyId, row.runId,
      `${row.a.n}`, `${row.a.d}`, `${row.b.n}`, `${row.b.d}`,
      row.interior, row.left, row.right, row.basis, row.requestKey ?? null, this.clock.now(),
    );
    return { id, created: true };
  }
}

export interface IntervalRow {
  id: string;
  runId: string;
  ord: number;
  left: Frac;
  right: Frac;
  multiplicity: number;
  status: RootInterval['status'];
  display: string;
  reason: string;
}

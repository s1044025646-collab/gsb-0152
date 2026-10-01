import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Open (creating parent dirs) and apply idempotent migrations. Migrations are
// tracked in schema_migrations and every statement is safe to re-run.
export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA foreign_keys=ON;');
  migrate(db);
  return db;
}

const MIGRATIONS: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: 'initial',
    sql: `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS polynomials (
      id TEXT PRIMARY KEY,
      canonical TEXT NOT NULL UNIQUE,
      coefficients_json TEXT NOT NULL,
      degree INTEGER NOT NULL,
      is_zero INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS polynomial_aliases (
      alias TEXT PRIMARY KEY,
      polynomial_id TEXT NOT NULL REFERENCES polynomials(id)
    );
    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      polynomial_id TEXT NOT NULL REFERENCES polynomials(id),
      version INTEGER NOT NULL,
      params_json TEXT NOT NULL,
      total_real_roots INTEGER,
      isolated_count INTEGER NOT NULL,
      undecided_count INTEGER NOT NULL,
      exhausted_iterations INTEGER NOT NULL,
      exhausted_bits INTEGER NOT NULL,
      iterations_used INTEGER NOT NULL,
      request_key TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(polynomial_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS intervals (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id),
      ord INTEGER NOT NULL,
      left_num TEXT NOT NULL,
      left_den TEXT NOT NULL,
      right_num TEXT NOT NULL,
      right_den TEXT NOT NULL,
      multiplicity INTEGER NOT NULL,
      status TEXT NOT NULL,
      display TEXT NOT NULL,
      reason TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS root_counts (
      id TEXT PRIMARY KEY,
      polynomial_id TEXT NOT NULL REFERENCES polynomials(id),
      run_id TEXT REFERENCES analysis_runs(id),
      left_num TEXT, left_den TEXT,
      right_num TEXT, right_den TEXT,
      bounded INTEGER NOT NULL,
      count INTEGER NOT NULL,
      request_key TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(polynomial_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS sign_queries (
      id TEXT PRIMARY KEY,
      polynomial_id TEXT NOT NULL REFERENCES polynomials(id),
      run_id TEXT REFERENCES analysis_runs(id),
      left_num TEXT NOT NULL, left_den TEXT NOT NULL,
      right_num TEXT NOT NULL, right_den TEXT NOT NULL,
      interior_sign INTEGER NOT NULL,
      left_sign INTEGER NOT NULL,
      right_sign INTEGER NOT NULL,
      basis TEXT NOT NULL,
      request_key TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(polynomial_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS proofs (
      run_id TEXT PRIMARY KEY REFERENCES analysis_runs(id),
      proof_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_runs_poly ON analysis_runs(polynomial_id, version);
    CREATE INDEX IF NOT EXISTS idx_intervals_run ON intervals(run_id, ord);
    `,
  },
];

export function migrate(db: DatabaseSync, now: () => string = () => new Date().toISOString()): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );`,
  );
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((r: unknown) =>
      Number((r as { id: number }).id)),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    const tx = db.prepare(
      'INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)');
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      tx.run(m.id, m.name, now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

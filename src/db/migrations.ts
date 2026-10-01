/**
 * Idempotent schema creation. Safe to run on every startup and against an
 * already-migrated database: every statement is guarded by IF NOT EXISTS.
 */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO schema_meta(key, value) VALUES('schema_version', '1')
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS polynomials (
  id           TEXT PRIMARY KEY,
  coeffs_json  TEXT NOT NULL,
  canonical    TEXT NOT NULL,
  degree       INTEGER NOT NULL,
  is_zero      INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_poly_canonical ON polynomials(canonical);

CREATE TABLE IF NOT EXISTS analyses (
  id              TEXT PRIMARY KEY,
  poly_id         TEXT NOT NULL REFERENCES polynomials(id),
  version         INTEGER NOT NULL,
  params_json     TEXT NOT NULL,
  status          TEXT NOT NULL,
  result_json     TEXT,
  total_real      INTEGER,
  isolated_count  INTEGER NOT NULL DEFAULT 0,
  pending_count   INTEGER NOT NULL DEFAULT 0,
  budget_exhausted INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE(poly_id, version)
);
CREATE INDEX IF NOT EXISTS idx_analyses_poly ON analyses(poly_id);

CREATE TABLE IF NOT EXISTS roots (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL REFERENCES analyses(id),
  root_seq     INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  multiplicity INTEGER NOT NULL,
  lo           TEXT NOT NULL,
  hi           TEXT NOT NULL,
  exact        TEXT,
  approx       TEXT NOT NULL,
  width        TEXT NOT NULL,
  evidence     TEXT NOT NULL,
  status       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roots_analysis ON roots(analysis_id);

CREATE TABLE IF NOT EXISTS unresolved_regions (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL REFERENCES analyses(id),
  lo           TEXT NOT NULL,
  hi           TEXT NOT NULL,
  multiplicity INTEGER NOT NULL,
  reason       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_unresolved_analysis ON unresolved_regions(analysis_id);

CREATE TABLE IF NOT EXISTS operations (
  id           TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  type         TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proof_summaries (
  id           TEXT PRIMARY KEY,
  analysis_id  TEXT NOT NULL REFERENCES analyses(id),
  summary_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
`;

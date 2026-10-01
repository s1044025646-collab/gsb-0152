import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL } from './migrations.ts';

export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(SCHEMA_SQL);
  return db;
}

export interface Page {
  limit: number;
  offset: number;
}

export function parsePage(query: { limit?: string; offset?: string }): Page {
  const limitRaw = query.limit ?? '50';
  const offsetRaw = query.offset ?? '0';
  const bad = () => Object.assign(new Error('INVALID_PAGINATION'), {
    code: 'INVALID_PAGINATION',
    status: 400,
  });
  if (!/^\d+$/.test(limitRaw) || !/^\d+$/.test(offsetRaw)) {
    throw bad();
  }
  const limit = Number(limitRaw);
  const offset = Number(offsetRaw);
  if (limit < 1 || limit > 200 || offset < 0) {
    throw bad();
  }
  return { limit, offset };
}

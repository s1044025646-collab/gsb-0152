import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/migrate.js';
import { Repo } from '../db/repo.js';
import { Service } from '../service/service.js';
import { polyToPretty } from '../core/poly.js';
import { AppError } from '../service/errors.js';

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

function dataDir(): string {
  return process.env.POLY_DATA_DIR ?? join(process.cwd(), '.data');
}

function buildService(dbFile?: string): Service {
  const db = openDatabase(dbFile ?? join(dataDir(), 'poly.db'));
  return new Service(new Repo(db));
}

function parsePagination(url: URL): { limit: number; offset: number } {
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new AppError('BAD_PAGINATION', 'limit must be an integer in [1,500].');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new AppError('BAD_PAGINATION', 'offset must be a non-negative integer.');
  }
  return { limit, offset };
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1_000_000) reject(new AppError('VALIDATION_ERROR', 'Request body too large.'));
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new AppError('VALIDATION_ERROR', 'Body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const json = JSON.stringify(payload, (_k, v) =>
    typeof v === 'bigint' ? `${v}n` : v);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(json);
}

function errorBody(code: string, message: string, details?: unknown) {
  return { error: { code, message, details } };
}

export function createApp(service: Service) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && path === '/health') {
        return send(res, 200, { status: 'ok', service: 'poly-root-isolation' });
      }

      if (req.method === 'POST' && path === '/polynomials') {
        const body = (await readJson(req)) as { coefficients?: unknown; terms?: unknown; alias?: string };
        const { row, created } = service.createPolynomial(body);
        return send(res, created ? 201 : 200, { polynomial: row, created });
      }

      const polyMatch = path.match(/^\/polynomials\/([^/]+)$/);
      if (req.method === 'GET' && polyMatch) {
        const { row, poly } = service.resolvePoly(decodeURIComponent(polyMatch[1]));
        return send(res, 200, { polynomial: row, pretty: polyToPretty(poly) });
      }

      if (req.method === 'GET' && path === '/polynomials') {
        const page = parsePagination(url);
        return send(res, 200, service.listPolynomials(page));
      }

      const analyzeMatch = path.match(/^\/polynomials\/([^/]+)\/analyze$/);
      if (req.method === 'POST' && analyzeMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        const result = service.analyze(decodeURIComponent(analyzeMatch[1]), {
          maxWidth: body.maxWidth as string | undefined,
          maxIterations: body.maxIterations as number | undefined,
          maxBits: body.maxBits as number | undefined,
          requestKey: body.requestKey as string | undefined,
        });
        return send(res, result.created ? 201 : 200, {
          run: result.run,
          intervals: result.intervals,
          proof: result.proof,
          created: result.created,
        });
      }

      const runsMatch = path.match(/^\/polynomials\/([^/]+)\/runs$/);
      if (req.method === 'GET' && runsMatch) {
        const page = parsePagination(url);
        return send(res, 200, service.listRuns(decodeURIComponent(runsMatch[1]), page));
      }

      const runMatch = path.match(/^\/polynomials\/([^/]+)\/runs\/(\d+)$/);
      if (req.method === 'GET' && runMatch) {
        const v = Number(runMatch[2]);
        const out = service.getRun(decodeURIComponent(runMatch[1]), v);
        return send(res, 200, { run: out.run, intervals: out.intervals, proof: out.proof });
      }

      const latestMatch = path.match(/^\/polynomials\/([^/]+)\/runs\/latest$/);
      if (req.method === 'GET' && latestMatch) {
        const out = service.getRun(decodeURIComponent(latestMatch[1]));
        return send(res, 200, { run: out.run, intervals: out.intervals, proof: out.proof });
      }

      const intervalsMatch = path.match(/^\/polynomials\/([^/]+)\/intervals$/);
      if (req.method === 'GET' && intervalsMatch) {
        const page = parsePagination(url);
        const version = url.searchParams.get('version') ? Number(url.searchParams.get('version')) : undefined;
        return send(res, 200, service.listIntervals(decodeURIComponent(intervalsMatch[1]), version, page));
      }

      const countMatch = path.match(/^\/polynomials\/([^/]+)\/count-roots$/);
      if (req.method === 'POST' && countMatch) {
        const body = (await readJson(req)) as { left?: string; right?: string; requestKey?: string };
        const result = service.countRoots(
          decodeURIComponent(countMatch[1]),
          body.left ?? null, body.right ?? null, body.requestKey,
        );
        return send(res, 200, result);
      }

      const signMatch = path.match(/^\/polynomials\/([^/]+)\/sign$/);
      if (req.method === 'POST' && signMatch) {
        const body = (await readJson(req)) as { left: string; right: string; requestKey?: string };
        if (body.left === undefined || body.right === undefined) {
          throw new AppError('VALIDATION_ERROR', 'Both "left" and "right" rational endpoints are required.');
        }
        const result = service.signAt(
          decodeURIComponent(signMatch[1]), body.left, body.right, body.requestKey,
        );
        return send(res, 200, result);
      }

      const proofMatch = path.match(/^\/polynomials\/([^/]+)\/proof$/);
      if (req.method === 'GET' && proofMatch) {
        const version = url.searchParams.get('version') ? Number(url.searchParams.get('version')) : undefined;
        const { proof } = service.getRun(decodeURIComponent(proofMatch[1]), version);
        if (!proof) throw new AppError('NOT_FOUND', 'Proof summary not generated yet.');
        return send(res, 200, proof);
      }

      return send(res, 404, errorBody('NOT_FOUND', `No route for ${req.method} ${path}`));
    } catch (e) {
      if (e instanceof AppError) {
        const status = e.code === 'NOT_FOUND' ? 404
          : e.code === 'VALIDATION_ERROR' || e.code === 'BAD_PAGINATION' ||
            e.code === 'BAD_INTERVAL' || e.code === 'DEGREE_EXCEEDED' ? 400
          : e.code === 'ZERO_POLYNOMIAL_ROOT_COUNT_UNDEFINED' ? 422
          : e.code === 'INTERVAL_CONTAINS_ROOT' ? 409
          : 400;
        return send(res, status, errorBody(e.code, e.message, e.details));
      }
      return send(res, 500, errorBody('INTERNAL', (e as Error).message));
    }
  };
}

export async function startServer(options: { dbFile?: string; portFile?: string } = {}): Promise<ServerHandle> {
  const service = buildService(options.dbFile);
  const app = createApp(service);
  const server = createServer(app);
  // Bind to loopback only; port 0 => OS assigns an ephemeral local port.
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const portFile = options.portFile ?? join(dir, 'server.port');
  mkdirSync(dirname(portFile), { recursive: true });
  writeFileSync(portFile, String(port));
  writeFileSync(join(dir, 'server.pid'), String(process.pid));
  return {
    port,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then(({ port }) => {
    console.log(`poly-root-isolation API listening on http://127.0.0.1:${port}`);
    console.log('Bound to loopback only. Port file: .data/server.port');
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

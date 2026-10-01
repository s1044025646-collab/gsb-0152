import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parsePage } from '../db/database.ts';
import { PolyService } from '../service.ts';

export interface ApiServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

interface JsonError {
  code: string;
  message: string;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('PAYLOAD_TOO_LARGE'), { code: 'PAYLOAD_TOO_LARGE', status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('INVALID_JSON'), { code: 'INVALID_JSON', status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function startApi(service: PolyService, preferredPort = 0): Promise<ApiServer> {
  const server = createServer((req, res) => {
    void handle(service, req, res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Bind only to loopback; port 0 lets the OS assign a free port automatically.
    server.listen(preferredPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        server,
        port,
        close: () =>
          new Promise<void>((resClose, rejClose) =>
            server.close((err) => (err ? rejClose(err) : resClose())),
          ),
      });
    });
  });
}

async function handle(service: PolyService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    const seg = path.split('/').filter(Boolean);
    const page = parsePage(Object.fromEntries(url.searchParams));

    if (method === 'GET' && path === '/health') {
      send(res, 200, { status: 'ok' });
      return;
    }

    // POST /polynomials
    if (method === 'POST' && seg.length === 1 && seg[0] === 'polynomials') {
      const body = (await readJson(req)) as { coefficients?: unknown };
      send(res, 201, service.createPolynomial(body.coefficients));
      return;
    }
    // GET /polynomials
    if (method === 'GET' && seg.length === 1 && seg[0] === 'polynomials') {
      send(res, 200, service.listPolynomials(page.limit, page.offset));
      return;
    }
    // GET /polynomials/:id
    if (method === 'GET' && seg.length === 2 && seg[0] === 'polynomials') {
      send(res, 200, service.getPolynomial(seg[1]!));
      return;
    }

    if (seg[0] === 'polynomials' && seg[1]) {
      const polyId = seg[1];
      // GET /polynomials/:id/analyses
      if (method === 'GET' && seg.length === 3 && seg[2] === 'analyses') {
        send(res, 200, service.listAnalyses(polyId, page.limit, page.offset));
        return;
      }
      // POST /polynomials/:id/analyses  (idempotency via Idempotency-Key header)
      if (method === 'POST' && seg.length === 3 && seg[2] === 'analyses') {
        const body = await readJson(req);
        const key = req.headers['idempotency-key'];
        send(
          res,
          201,
          service.createAnalysis(polyId, body, typeof key === 'string' ? key : undefined),
        );
        return;
      }
      // POST /polynomials/:id/refine
      if (method === 'POST' && seg.length === 3 && seg[2] === 'refine') {
        const body = await readJson(req);
        const key = req.headers['idempotency-key'];
        send(res, 201, service.refine(polyId, body, typeof key === 'string' ? key : undefined));
        return;
      }
      // GET /polynomials/:id/roots-count?a=..&b=..
      if (method === 'GET' && seg.length === 3 && seg[2] === 'roots-count') {
        const a = url.searchParams.get('a');
        const b = url.searchParams.get('b');
        if (!a || !b) throw coded('MISSING_QUERY', 400, 'a and b are required');
        send(res, 200, service.countRoots(polyId, a, b));
        return;
      }
      // GET /polynomials/:id/sign-point?x=..
      if (method === 'GET' && seg.length === 3 && seg[2] === 'sign-point') {
        const x = url.searchParams.get('x');
        if (!x) throw coded('MISSING_QUERY', 400, 'x is required');
        send(res, 200, service.signPoint(polyId, x));
        return;
      }
      // GET /polynomials/:id/sign-interval?a=..&b=..
      if (method === 'GET' && seg.length === 3 && seg[2] === 'sign-interval') {
        const a = url.searchParams.get('a');
        const b = url.searchParams.get('b');
        if (!a || !b) throw coded('MISSING_QUERY', 400, 'a and b are required');
        send(res, 200, service.signInterval(polyId, a, b));
        return;
      }
      // GET /polynomials/:id/descartes
      if (method === 'GET' && seg.length === 3 && seg[2] === 'descartes') {
        send(res, 200, service.descartes(polyId));
        return;
      }
    }

    if (seg[0] === 'analyses' && seg[1]) {
      const analysisId = seg[1];
      if (method === 'GET' && seg.length === 2) {
        send(res, 200, service.getAnalysis(analysisId));
        return;
      }
      if (method === 'GET' && seg.length === 3 && seg[2] === 'roots') {
        send(res, 200, service.listRoots(analysisId, page.limit, page.offset));
        return;
      }
      if (method === 'GET' && seg.length === 3 && seg[2] === 'unresolved') {
        send(res, 200, service.listUnresolved(analysisId));
        return;
      }
      if (method === 'POST' && seg.length === 3 && seg[2] === 'proof-summary') {
        send(res, 201, service.proofSummary(analysisId));
        return;
      }
    }

    // GET /polynomials/:id/compare-versions?v1=1&v2=2
    if (method === 'GET' && seg.length === 3 && seg[0] === 'polynomials' && seg[2] === 'compare-versions') {
      const v1 = Number(url.searchParams.get('v1'));
      const v2 = Number(url.searchParams.get('v2'));
      if (!Number.isInteger(v1) || !Number.isInteger(v2)) {
        throw coded('MISSING_QUERY', 400, 'v1 and v2 integer versions required');
      }
      send(res, 200, service.compareVersions(seg[1]!, v1, v2));
      return;
    }

    send(res, 404, { code: 'NOT_FOUND', message: `no route for ${method} ${path}` } satisfies JsonError);
  } catch (err) {
    const e = err as { code?: string; status?: number; message?: string };
    const status = typeof e.status === 'number' ? e.status : 500;
    const code = e.code ?? 'INTERNAL';
    if (status >= 500) console.error(err);
    send(res, status, { code, message: e.message ?? code } satisfies JsonError);
  }
}

function coded(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status });
}

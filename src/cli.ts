import { openDatabase } from './db/database.ts';
import { Repository } from './db/repo.ts';
import { PolyService, MAX_DEGREE } from './service.ts';
import { startApi } from './api/server.ts';
import { runDemo } from './demo.ts';

function parseFlags(argv: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function line(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function rootLine(r: Record<string, unknown>): string {
  if (r.kind === 'exact') return `  exact ${r.exact}  multiplicity ${r.multiplicity}`;
  return `  [${r.lo}, ${r.hi}] ~ ${r.approx}  mult ${r.multiplicity}  width ${r.width}`;
}

export async function runCli(argv: string[]): Promise<number> {
  const { positional, flags } = parseFlags(argv);
  const command = positional[0] ?? 'help';
  const dbPath = flags.db ?? 'data/poly.db';

  if (command === 'help' || command === '--help') {
    console.log(
      [
        'polycli — exact real-root isolation backend',
        '',
        'Commands:',
        '  serve [--port 0] [--db data/poly.db]      Start local-only HTTP API on 127.0.0.1',
        `  poly --coeffs "0,1,-2/3" [--db ...]      Create polynomial (degree <= ${MAX_DEGREE})`,
        '  list [--limit 50] [--offset 0]           List polynomials (paginated)',
        '  count --id ID --a "0" --b "1"            Count distinct real roots in (a,b)',
        '  analyze --id ID [--width 1/1000] [--maxIterations N] [--maxBits N] [--key K]',
        '  refine  --id ID [--width ...] ...        Append a new, finer analysis version',
        '  roots --analysis AID [--limit --offset]  List isolated roots (paginated)',
        '  unresolved --analysis AID                List pending/unresolved regions',
        '  sign-point --id ID --x "1/2"',
        '  sign-interval --id ID --a "0" --b "1"',
        '  compare --id ID --v1 1 --v2 2',
        '  proof --analysis AID                     Export exact proof summary',
        '  demo --run                               Reproducible end-to-end demonstration',
      ].join('\n'),
    );
    return 0;
  }

  if (command === 'demo') {
    const db = openDatabase(flags.db ?? 'data/demo.db');
    try {
      const service = new PolyService(new Repository(db));
      await runDemo(service, { print: console.log });
    } finally {
      db.close();
    }
    return 0;
  }

  if (command === 'serve') {
    const db = openDatabase(dbPath);
    const service = new PolyService(new Repository(db));
    const api = await startApi(service, Number(flags.port ?? 0));
    console.log(`API listening on http://127.0.0.1:${api.port} (db=${dbPath})`);
    const shutdown = async () => {
      await api.close();
      db.close();
      process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    return 0;
  }

  const db = openDatabase(dbPath);
  const service = new PolyService(new Repository(db));
  try {
    switch (command) {
      case 'poly': {
        const coeffs = (flags.coeffs ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        line('BEFORE: creating polynomial from coefficients');
        console.log('input:', coeffs);
        const result = service.createPolynomial(coeffs);
        line('AFTER: stored polynomial');
        printJson(result);
        break;
      }
      case 'list': {
        printJson(service.listPolynomials(Number(flags.limit ?? 50), Number(flags.offset ?? 0)));
        break;
      }
      case 'count': {
        line(`BEFORE: Sturm root count in (${flags.a}, ${flags.b})`);
        const result = service.countRoots(required(flags, 'id'), required(flags, 'a'), required(flags, 'b'));
        line('AFTER: exact count');
        printJson(result);
        break;
      }
      case 'analyze':
      case 'refine': {
        const before = service.listAnalyses(required(flags, 'id'), 100, 0).total;
        line(`BEFORE: ${before} existing analysis version(s)`);
        const result =
          command === 'analyze'
            ? service.createAnalysis(required(flags, 'id'), paramsFromFlags(flags), flags.key)
            : service.refine(required(flags, 'id'), paramsFromFlags(flags), flags.key);
        line(
          `AFTER: version ${result.version} (${command === 'analyze' ? 'created' : 'append'}) ` +
            `totalReal=${result.outcome.totalRealRoots} isolated=${result.outcome.isolatedCount} ` +
            `pending=${result.outcome.pendingCount}`,
        );
        for (const root of result.outcome.isolatedRoots) {
          console.log(rootLine(root as unknown as Record<string, unknown>));
        }
        if (result.outcome.unresolvedRegions.length > 0) {
          console.log('unresolved regions:');
          printJson(result.outcome.unresolvedRegions);
        }
        console.log('analysisId:', result.analysisId);
        break;
      }
      case 'roots': {
        printJson(
          service.listRoots(
            required(flags, 'analysis'),
            Number(flags.limit ?? 50),
            Number(flags.offset ?? 0),
          ),
        );
        break;
      }
      case 'unresolved': {
        printJson(service.listUnresolved(required(flags, 'analysis')));
        break;
      }
      case 'sign-point': {
        line(`BEFORE: evaluate exact sign at ${flags.x}`);
        printJson(service.signPoint(required(flags, 'id'), required(flags, 'x')));
        break;
      }
      case 'sign-interval': {
        printJson(
          service.signInterval(required(flags, 'id'), required(flags, 'a'), required(flags, 'b')),
        );
        break;
      }
      case 'compare': {
        printJson(
          service.compareVersions(
            required(flags, 'id'),
            Number(required(flags, 'v1')),
            Number(required(flags, 'v2')),
          ),
        );
        break;
      }
      case 'proof': {
        printJson(service.proofSummary(required(flags, 'analysis')));
        break;
      }
      default:
        console.error(`unknown command: ${command} (try 'help')`);
        return 2;
    }
  } catch (err) {
    const e = err as { code?: string; message?: string };
    console.error(`error [${e.code ?? 'INTERNAL'}]: ${e.message ?? String(err)}`);
    return 1;
  } finally {
    db.close();
  }
  return 0;
}

function paramsFromFlags(flags: Record<string, string>): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (flags.width) params.width = flags.width;
  if (flags.maxIterations) params.maxIterations = Number(flags.maxIterations);
  if (flags.maxBits) params.maxBits = Number(flags.maxBits);
  if (flags.bound) params.bound = flags.bound;
  return params;
}

function required(flags: Record<string, string>, key: string): string {
  if (flags[key] === undefined) throw new Error(`--${key} is required`);
  return flags[key]!;
}

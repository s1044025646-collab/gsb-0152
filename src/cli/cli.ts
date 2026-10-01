#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { openDatabase } from '../db/migrate.js';
import { Repo } from '../db/repo.js';
import { Service } from '../service/service.js';
import { join } from 'node:path';
import { fracToString } from '../core/frac.js';
import { polyToPretty } from '../core/poly.js';
import { allFixtures } from '../generator/index.js';

function dataDir(): string {
  return process.env.POLY_DATA_DIR ?? join(process.cwd(), '.data');
}

function getService(): Service {
  const db = openDatabase(join(dataDir(), 'poly.db'));
  return new Service(new Repo(db));
}

function parseCoeffsArg(arg: string): unknown {
  try {
    return JSON.parse(arg);
  } catch {
    return arg.split(',').map((s) => s.trim());
  }
}

function parseArgs(args: string[]): { flags: Map<string, string>; positional: string[] } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, 'true');
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function header(title: string): void {
  console.log(`\n=== ${title} ===`);
}

function printRun(run: ReturnType<Service['getRun']>): void {
  console.log(`Run v${run.run.version}  totalRealRoots=${run.run.totalRealRoots ?? 'N/A(zero poly)'}  isolated=${run.run.isolatedCount}  undecided=${run.run.undecidedCount}  iterationsUsed=${run.run.iterationsUsed}`);
  console.log(`params=${JSON.stringify(run.run.params)} exhausted(iter/bits)=${run.run.exhaustedIterations}/${run.run.exhaustedBits}`);
  for (const iv of run.intervals) {
    const l = fracToString(iv.left);
    const r = fracToString(iv.right);
    console.log(
      `  [${iv.status}] mult=${iv.multiplicity}  [${l}, ${r}]  ${l === r ? '' : `(${iv.display})`}`);
    console.log(`      evidence: ${iv.reason}`);
  }
  const p = run.proof as { declaration?: string } | undefined;
  if (p?.declaration) console.log(`  ${p.declaration}`);
}

const USAGE = `polyctl - exact rational polynomial root isolation CLI

Usage:
  polyctl put --coeffs '["2","-3","0","1"]' [--alias NAME]
  polyctl list [--limit 50] [--offset 0]
  polyctl show <id|alias>
  polyctl analyze <id|alias> [--width 1/1000000] [--max-iter 5000] [--max-bits 1024] [--request-key KEY]
  polyctl refine <id|alias> --width 1/1000000000 [--max-iter N] [--max-bits N] [--request-key KEY]
  polyctl runs <id|alias>
  polyctl run <id|alias> [--version N]
  polyctl intervals <id|alias> [--version N] [--limit 50] [--offset 0]
  polyctl count <id|alias> [--left A] [--right B]
  polyctl sign <id|alias> --left A --right B
  polyctl proof <id|alias> [--version N]
  polyctl fixtures
  polyctl help

Coefficients are exact integers or fractions ("p/q"), ascending degree.
Decimal numbers are rejected; decimals appear only as display hints.
`;

export function main(argv: string[]): number {
  const [cmd, ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  try {
    switch (cmd) {
      case 'put': {
        const svc = getService();
        const raw = flags.get('coeffs');
        if (!raw) throw new Error('--coeffs is required');
        const before = svc.listPolynomials({ limit: 1, offset: 0 }).total;
        const { row, created } = svc.createPolynomial({
          coefficients: parseCoeffsArg(raw), alias: flags.get('alias'),
        });
        const after = svc.listPolynomials({ limit: 1, offset: 0 }).total;
        header(`put (${created ? 'created' : 'already existed; idempotent'})`);
        console.log(`polynomials ${before} -> ${after}`);
        console.log(JSON.stringify(row, null, 2));
        return 0;
      }
      case 'list': {
        const svc = getService();
        const page = svc.listPolynomials({
          limit: Number(flags.get('limit') ?? 50),
          offset: Number(flags.get('offset') ?? 0),
        });
        header(`polynomials (${page.offset + 1}-${page.offset + page.items.length} of ${page.total})`);
        for (const p of page.items) console.log(`${p.id}  deg=${p.degree}  ${p.canonical}`);
        return 0;
      }
      case 'show': {
        const svc = getService();
        const { row, poly } = svc.resolvePoly(positional[0]);
        header('polynomial');
        console.log(JSON.stringify(row, null, 2));
        console.log('pretty:', polyToPretty(poly));
        return 0;
      }
      case 'analyze':
      case 'refine': {
        const svc = getService();
        const ref = positional[0];
        if (!ref) throw new Error('polynomial id/alias required');
        const prior = (() => {
          try {
            return svc.getRun(ref);
          } catch {
            return null;
          }
        })();
        header(`${cmd}: before`);
        if (prior) printRun(prior);
        else console.log('(no previous run)');
        const result = svc.analyze(ref, {
          maxWidth: flags.get('width') ?? (cmd === 'refine' ? '1/1000000000' : undefined),
          maxIterations: flags.get('max-iter') ? Number(flags.get('max-iter')) : undefined,
          maxBits: flags.get('max-bits') ? Number(flags.get('max-bits')) : undefined,
          requestKey: flags.get('request-key'),
        });
        header(`${cmd}: after (${result.created ? 'new version' : 'idempotent reuse'})`);
        printRun({ run: result.run, intervals: result.intervals, proof: result.proof });
        return 0;
      }
      case 'runs': {
        const svc = getService();
        const runs = svc.listRuns(positional[0], {
          limit: Number(flags.get('limit') ?? 50), offset: Number(flags.get('offset') ?? 0),
        });
        header(`versions (${runs.total})`);
        for (const r of runs.items) {
          console.log(`v${r.version}  total=${r.totalRealRoots ?? 'N/A'} isolated=${r.isolatedCount} undecided=${r.undecidedCount}  ${r.createdAt}`);
        }
        return 0;
      }
      case 'run':
      case 'intervals':
      case 'proof': {
        const svc = getService();
        const version = flags.get('version') ? Number(flags.get('version')) : undefined;
        const out = svc.getRun(positional[0], version);
        if (cmd === 'proof') {
          header('proof summary');
          console.log(JSON.stringify(out.proof, null, 2));
        } else if (cmd === 'intervals') {
          const page = svc.listIntervals(positional[0], version, {
            limit: Number(flags.get('limit') ?? 50), offset: Number(flags.get('offset') ?? 0),
          });
          header(`intervals v${out.run.version} (${page.offset + 1}-${page.offset + page.items.length} of ${page.total})`);
          for (const iv of page.items) {
            console.log(`[${iv.status}] mult=${iv.multiplicity} [${fracToString(iv.left)}, ${fracToString(iv.right)}]`);
          }
        } else {
          header(`run v${out.run.version}`);
          printRun(out);
        }
        return 0;
      }
      case 'count': {
        const svc = getService();
        const result = svc.countRoots(
          positional[0],
          flags.get('left') ?? null,
          flags.get('right') ?? null,
        );
        header('root count');
        if (result.bounded) {
          console.log(`distinct real roots in [${result.left}, ${result.right}] = ${result.count}`);
        } else {
          console.log(`distinct real roots on the whole real line = ${result.count}`);
        }
        return 0;
      }
      case 'sign': {
        const svc = getService();
        const left = flags.get('left');
        const right = flags.get('right');
        if (!left || !right) throw new Error('--left and --right are required');
        const result = svc.signAt(positional[0], left, right);
        header('sign on certified root-free open interval');
        console.log(JSON.stringify(result, null, 2));
        return 0;
      }
      case 'fixtures': {
        process.stdout.write(JSON.stringify(allFixtures(), null, 2) + '\n');
        return 0;
      }
      case 'help':
      case undefined:
        console.log(USAGE);
        return 0;
      default:
        console.error(`Unknown command: ${cmd}\n`);
        console.log(USAGE);
        return 2;
    }
  } catch (e) {
    const err = e as { code?: string; message: string };
    console.error(`ERROR${err.code ? ` [${err.code}]` : ''}: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}

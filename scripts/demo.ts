// Repeatable end-to-end demonstration runnable with `npm run demo`.
// Uses an isolated data directory inside the project and prints the state
// before/after key operations. No network service and no randomness.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { openDatabase } from '../src/db/migrate.js';
import { Repo } from '../src/db/repo.js';
import { Service } from '../src/service/service.js';
import { allFixtures } from '../src/generator/index.js';

const dir = join(process.cwd(), '.data', 'demo');
rmSync(dir, { recursive: true, force: true });
const db = openDatabase(join(dir, 'demo.db'));
const svc = new Service(new Repo(db, {
  now: (() => {
    let t = 0;
    return () => `2026-09-30T00:00:${String(t++).padStart(2, '0')}Z`;
  })(),
  uuid: (() => {
    let n = 0;
    return () => `demo-${(n++).toString(36)}`;
  })(),
}));

const line = (s: string) => console.log(`\n--- ${s} ---`);

line('1) fixtures generated deterministically');
for (const fx of allFixtures()) {
  console.log(`  ${fx.name}: distinct real roots = ${fx.expectedDistinctRealRoots}`);
}

line('2) create a polynomial with repeated roots  (2x-1)^3 (x+3)^2 (4x-7)');
const repeated = allFixtures().find((f) => f.name === 'repeated-roots')!;
const { row: poly, created } = svc.createPolynomial({ coefficients: repeated.coefficients, alias: 'rep' });
console.log(`  created=${created} id=${poly.id} degree=${poly.degree}`);

line('3) whole-line root count BEFORE isolation');
console.log(' ', svc.countRoots('rep', null, null));

line('4) analyze with a deliberately small iteration budget (interruption)');
const tightBudget = svc.analyze('rep', {
  maxWidth: '1/1000000000000', maxIterations: 6, maxBits: 4000, requestKey: 'phase1',
});
console.log(`  totalRealRoots=${tightBudget.run.totalRealRoots} isolated=${tightBudget.run.isolatedCount} undecided=${tightBudget.run.undecidedCount}`);
for (const iv of tightBudget.intervals) {
  console.log(`    [${iv.status}] mult=${iv.multiplicity}`);
}
console.log('  declaration:', (tightBudget.proof as { declaration: string }).declaration);

line('5) resume with a large budget (new version; old result retained)');
const resumed = svc.analyze('rep', {
  maxWidth: '1/1000000000000', maxIterations: 200000, maxBits: 4000, requestKey: 'phase2',
});
console.log(`  version v${resumed.run.version} total=${resumed.run.totalRealRoots} undecided=${resumed.run.undecidedCount}`);
for (const iv of resumed.intervals) {
  console.log(`    mult=${iv.multiplicity} [${iv.status}] ${iv.display}`);
  console.log(`      ${iv.reason}`);
}

line('6) bounded root count and sign query');
console.log('  roots in [-4,0]:', svc.countRoots('rep', '-4', '0').count);
// Find a certified isolated interval from the run to query sign safely.
const iso = resumed.intervals.find((i) => i.status === 'isolated');
if (iso) {
  // Query strictly outside the bracket using its midpoint-free outer gap.
  console.log(`  sign on [10, 11]:`, (svc.signAt('rep', '10', '11') as { interiorSign: string }).interiorSign);
}

line('7) version comparison');
const runs = svc.listRuns('rep', { limit: 10, offset: 0 });
for (const r of runs.items) {
  console.log(`  v${r.version}: total=${r.totalRealRoots} isolated=${r.isolatedCount} undecided=${r.undecidedCount} width<=${r.params.maxWidth}`);
}

line('8) proof summary export (exact evidence only)');
const proof = svc.getRun('rep', 2).proof as {
  recomposition: { ok: boolean; scalar: string };
  declaration: string;
};
console.log(`  recomposition ok=${proof.recomposition.ok} scalar=${proof.recomposition.scalar}`);
console.log(`  ${proof.declaration}`);

line('9) idempotency check (same request key)');
const again = svc.analyze('rep', {
  maxWidth: '1/1000000000000', maxIterations: 200000, maxBits: 4000, requestKey: 'phase2',
});
console.log(`  created=${again.created} (expected false), versions total=${svc.listRuns('rep', { limit: 10, offset: 0 }).total}`);

console.log('\nDemo complete. Data written under .data/demo (inside this project).');
db.close();

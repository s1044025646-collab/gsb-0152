import type { PolyService } from './service.ts';

export interface DemoSink {
  print(text: string): void;
}

/**
 * Deterministic end-to-end demonstration. Uses no randomness and only exact
 * arithmetic, so output is byte-for-byte repeatable. Walks through creation,
 * whole-axis/interval counting, isolation with evidence, refinement into a new
 * version, version comparison, sign queries, proof export, and the no-real-root
 * / zero-polynomial semantics.
 */
export async function runDemo(service: PolyService, sink: DemoSink): Promise<void> {
  const p = (text: string) => sink.print(text);
  p('--- Demo 1: repeated, exact and close roots ------------------------------');
  // (x-1)^2 (x-2)(x+3): coefficients low-degree-first
  const created1 = service.createPolynomial(['-6', '13', '-7', '-1', '1']);
  p(`polynomial id: ${created1.polynomial.id} (created=${created1.created})`);
  const id1 = created1.polynomial.id;
  p(`whole-axis distinct real roots: ${service.countRoots(id1, '-100', '100').distinctRootsInside}`);
  const a1 = service.createAnalysis(id1, { width: '1/100', maxIterations: 5000, maxBits: 100000 }, 'demo-a1');
  p(`analysis v${a1.version}: totalReal=${a1.outcome.totalRealRoots} ` +
    `isolated=${a1.outcome.isolatedCount} pending=${a1.outcome.pendingCount}`);
  for (const r of a1.outcome.isolatedRoots) {
    p(
      r.kind === 'exact'
        ? `  exact root ${r.exact} multiplicity ${r.multiplicity}`
        : `  [${r.lo}, ${r.hi}] ~${r.approx} mult ${r.multiplicity} width ${r.width}`,
    );
    p(`      evidence: ${r.evidence}`);
  }
  const refined = service.refine(id1, { width: '1/1000000', maxIterations: 5000, maxBits: 100000 }, 'demo-a1-fine');
  p(`refinement created version v${refined.version} (old v${a1.version} retained)`);
  p(JSON.stringify(service.compareVersions(id1, a1.version as number, refined.version as number)));

  p('\n--- Demo 2: no real roots --------------------------------------------------');
  const created2 = service.createPolynomial(['1', '0', '1']);
  const a2 = service.createAnalysis(created2.polynomial.id, { width: '1/1000' });
  p(`x^2+1 -> totalReal=${a2.outcome.totalRealRoots} isolated=${a2.outcome.isolatedCount}`);

  p('\n--- Demo 3: zero root and zero polynomial ---------------------------------');
  const created3 = service.createPolynomial(['0', '0', '1']);
  const a3 = service.createAnalysis(created3.polynomial.id, { width: '1/1000' });
  p(`x^2 -> root: ${JSON.stringify(a3.outcome.isolatedRoots[0])}`);
  const zero = service.createPolynomial(['0', '0', '0']);
  const a0 = service.createAnalysis(zero.polynomial.id, { width: '1/1000' });
  p(`zero polynomial -> isZeroPolynomial=${a0.outcome.isZeroPolynomial} totalReal=${String(a0.outcome.totalRealRoots)}`);

  p('\n--- Demo 4: exact sign queries --------------------------------------------');
  p(`sign of demo1 at x=1: ${JSON.stringify(service.signPoint(id1, '1'))}`);
  p(`sign on (1,2): ${JSON.stringify(service.signInterval(id1, '1', '2'))}`);
  p(`sign on (2,3): ${JSON.stringify(service.signInterval(id1, '2', '3'))}`);

  p('\n--- Demo 5: proof summary -------------------------------------------------');
  p(JSON.stringify(service.proofSummary(a1.analysisId as string), null, 2));
}

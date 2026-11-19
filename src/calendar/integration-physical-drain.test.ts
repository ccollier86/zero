/** Actual coordinator/controller and WorkPools, with controlled raw native
 * callbacks replacing transport. Not a realm, actor or managed-app test.
 * Every synthetic callback is released and joined in finally; no disk output.
 */
import { expect, test } from 'bun:test';
import { WorkPool } from '../workers/work-pool';
import { CalendarIntegrationCoordinator } from './integration-coordinator';
import { CalendarIntegrationPolicyController } from './integration-controller';
import type { CalendarIntegrationOwner } from './integration-runtime';

function latch() { let release!: () => void; return { promise: new Promise<void>(resolve => { release = resolve; }), release() { release(); } }; }
async function pending(task: Promise<void>) {
  let settled = false; void task.then(() => { settled = true; }, () => { settled = true; });
  await Bun.sleep(3); expect(settled).toBe(false);
}
function coordinator() {
  const unexpected = () => { throw new Error('No domain/Jobs operation is admitted by this pool-lifetime fixture.'); };
  return new CalendarIntegrationCoordinator({ rules: [{ id: 'observe', version: '1', dueOffsetMs: 0, maxLatenessMs: 60_000 }],
    owner: unexpected, pin: unexpected, discover: unexpected, resolveOwner: unexpected, inspect: unexpected, jobs: { forSource: unexpected } });
}

test('native Calendar intake join outlives a bounded drain refusal instead of releasing a retained callback', async () => {
  const value = coordinator(), raw = value as unknown as { intake: WorkPool };
  const original = raw.intake; await original.close(); await original.drainPhysical();
  const pool = new WorkPool({ concurrency: 1, shutdownGraceMs: 1 }); raw.intake = pool;
  const entered = latch(), body = latch();
  let physical: Promise<void> | undefined;
  const work = pool.run(async signal => { entered.release(); await body.promise; expect(signal.aborted).toBe(true); });
  const outcome = work.catch(error => error);
  try {
    await expect(value.drainPhysicalIntake()).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await entered.promise;
    await expect(value.drain()).rejects.toThrow('Calendar integration intake did not drain cleanly');
    expect(await outcome).toMatchObject({ code: 'WORKER_NOT_READY', outcome: 'unknown' });
    expect(value.diagnostics().intake.active).toBe(1);
    physical = value.drainPhysicalIntake(); await pending(physical);
    body.release(); await physical;
    expect(value.diagnostics().intake.active).toBe(0);
    await value.drain(); await value.closeEvidence(); await value.drainPhysicalEvidence();
  } finally {
    body.release(); await outcome;
    try { await value.drain(); } finally { await value.drainPhysicalIntake(); }
    try { await value.closeEvidence(); } finally { await value.drainPhysicalEvidence(); }
    await physical;
  }
});

test('native Calendar evidence join retains an actual callback after its caller and bounded close already failed', async () => {
  const value = coordinator(), raw = value as unknown as { evidence: WorkPool };
  const original = raw.evidence; await original.close(); await original.drainPhysical();
  const pool = new WorkPool({ concurrency: 1, shutdownGraceMs: 1 }); raw.evidence = pool;
  const entered = latch(), body = latch(), caller = new AbortController();
  let providerClosed = false, reads = 0, physical: Promise<void> | undefined;
  const work = pool.run(async () => { entered.release(); await body.promise; expect(providerClosed).toBe(false); reads++; }, { signal: caller.signal });
  const outcome = work.catch(error => error);
  try {
    await entered.promise; caller.abort(new Error('Synthetic outer activity stopped.')); await outcome;
    await value.drain(); await value.drainPhysicalIntake();
    await expect(value.closeEvidence()).rejects.toMatchObject({ code: 'WORKER_DRAIN_TIMEOUT', outcome: 'unknown' });
    expect(value.diagnostics().evidence.active).toBe(1);
    physical = value.drainPhysicalEvidence(); await pending(physical);
    expect(providerClosed).toBe(false); body.release(); await physical;
    providerClosed = true; expect(reads).toBe(1); expect(value.diagnostics().evidence.active).toBe(0);
    await value.closeEvidence(); expect(value.diagnostics().state).toBe('closed');
  } finally {
    body.release(); await outcome;
    try { await value.drain(); } finally { await value.drainPhysicalIntake(); }
    try { await value.closeEvidence(); } finally { await value.drainPhysicalEvidence(); }
    await physical;
  }
});

test('native Calendar policy controller joins its physical pool after a cancelled caller and bounded close failure', async () => {
  const owner = { assertCurrent() {}, signal: new AbortController().signal } as CalendarIntegrationOwner;
  const controller = new CalendarIntegrationPolicyController({ owner, jobs() { throw new Error('No Jobs operation expected.'); } });
  const raw = controller as unknown as { pool: WorkPool }; await raw.pool.close(); await raw.pool.drainPhysical();
  const pool = new WorkPool({ concurrency: 1, shutdownGraceMs: 1 }); raw.pool = pool;
  const entered = latch(), body = latch(); let physical: Promise<void> | undefined;
  const work = pool.run(async signal => { entered.release(); await body.promise; expect(signal.aborted).toBe(true); });
  const outcome = work.catch(error => error);
  try {
    await entered.promise;
    await expect(controller.close()).rejects.toMatchObject({ code: 'WORKER_DRAIN_TIMEOUT' });
    physical = controller.drainPhysical(); await pending(physical);
    body.release(); await physical; await outcome;
    expect(controller.diagnostics().pool.active).toBe(0); await controller.close();
  } finally { body.release(); await outcome; try { await controller.close(); } finally { await controller.drainPhysical(); } await physical; }
});

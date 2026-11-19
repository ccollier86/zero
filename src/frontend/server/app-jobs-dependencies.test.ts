/** Real Jobs/Torrent with a spied MEMORY transport open and explicit dependent
 * lifecycle probes. No createApp, file SQLite, actors, listeners or build output.
 */
import { expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { AuthorityCommitCoordinator } from '../../databases/authority-commit-coordinator';
import { JobsRuntime } from '../../jobs/runtime';
import { memorySourceJobsFixture, untilMemoryJobs } from '../../jobs/test-support/memory-source-fixture';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_DATABASE_COMMIT_AUTHORITY, ZERO_DATABASE_MANAGER, ZERO_JOBS_SERVICE, ZERO_SYSTEM_DB } from '../../runtime/service-keys';
import { createReactiveDB } from '../../sync/reactive-db';
import { WorkPool } from '../../workers/work-pool';
import type { ResolvedConfig } from './types';
import { prepareManagedJobs } from './app-jobs';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

async function fixture() {
  const memory = await memorySourceJobsFixture(), system = createReactiveDB({ mode: 'memory' }), authority = new AuthorityCommitCoordinator();
  const runtime = new ZeroAppRuntime(), app = new Elysia();
  const open = spyOn(JobsRuntime, 'open').mockResolvedValue(memory.runtime);
  let stops = 0;
  try {
    system.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    runtime.set(ZERO_SYSTEM_DB, system);
    runtime.set(ZERO_DATABASE_MANAGER, { systemRuntime: { sqlite: { mode: 'ephemeral' } } } as never);
    runtime.set(ZERO_DATABASE_COMMIT_AUTHORITY, { coordinator: authority, actorContext: null });
    const config = { jobs: memory.config, migrate: false } as ResolvedConfig;
    const owner = (await prepareManagedJobs(app, runtime, config, memory.workflows, async () => { stops++; await memory.workflows.dispose(); }))!;
    return { memory, runtime, owner, stops: () => stops,
      closed: () => (memory.runtime.diagnostics() as unknown as { closed: boolean }).closed,
      async close() {
        try { await runtime.dispose(); }
        finally { open.mockRestore(); try { await memory.close(); } finally { system.dispose(); await authority.drain(); } }
      },
    };
  } catch (error) {
    open.mockRestore(); try { await memory.close(); } finally { system.dispose(); await authority.drain(); } throw error;
  }
}

test('native dependency attaches once before sealing and shared teardown has one ordered final provider close', async () => {
  const f = await fixture(), phases: string[] = [];
  try {
    f.owner.assertDependency(f.memory.workflows, f.memory.definition);
    const dependency = { quiesce() { phases.push('quiesce'); }, async drainIntake() { phases.push('intake'); },
      async drainEvidence() { expect(f.stops()).toBe(1); expect(f.closed()).toBe(false); phases.push('evidence'); },
      async closeProvider() { expect(f.closed()).toBe(true); phases.push('provider'); } };
    f.owner.attachDependency(dependency);
    expect(() => f.owner.attachDependency(dependency)).toThrow();
    dependency.quiesce = () => { throw new Error('Mutated hook must not replace captured cleanup.'); };
    dependency.closeProvider = async () => { throw new Error('Mutated provider close must not run.'); };
    f.owner.sealDependencies(); f.owner.sealDependencies();
    expect(() => f.owner.attachDependency(dependency)).toThrow();
    await expect(f.owner.cancelPreparation()).rejects.toMatchObject({ code: 'JOBS_NOT_READY' });
    const closing = f.owner.close(); expect(f.owner.close()).toBe(closing);
    expect(() => f.owner.sealDependencies()).toThrow(expect.objectContaining({ code: 'JOBS_NOT_READY' }));
    await closing; await f.runtime.dispose();
    expect(phases).toEqual(['quiesce', 'intake', 'evidence', 'provider']); expect(f.stops()).toBe(1);
    expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBeNull();
  } finally { await f.close(); }
});

test('dependent final provider refusal can retry the same provider without repeating physical shutdown or Workflow stop', async () => {
  const f = await fixture(); let providerCalls = 0, intakeCalls = 0, evidenceCalls = 0;
  try {
    f.owner.attachDependency({ quiesce() {}, async drainIntake() { intakeCalls++; }, async drainEvidence() { evidenceCalls++; },
      async closeProvider() { providerCalls++; if (providerCalls === 1) throw new Error('Synthetic quarantined provider refuses close.'); } });
    f.owner.sealDependencies();
    await expect(f.owner.close()).rejects.toBeInstanceOf(AggregateError);
    expect(f.stops()).toBe(1); expect(f.closed()).toBe(true);
    await f.owner.close();
    expect(providerCalls).toBe(2); expect(intakeCalls).toBe(1); expect(evidenceCalls).toBe(1); expect(f.stops()).toBe(1);
  } finally { await f.close(); }
});

test('unsealed preparation cancellation drains native dependencies without recursively stopping Workflow initialization', async () => {
  const f = await fixture(), phases: string[] = [];
  try {
    f.owner.attachDependency({ quiesce() { phases.push('quiesce'); }, async drainIntake() { phases.push('intake'); },
      async drainEvidence() { phases.push('evidence'); }, async closeProvider() { phases.push('provider'); } });
    await f.owner.cancelPreparation(); await f.runtime.dispose();
    expect(f.stops()).toBe(0); f.memory.bridge.assertRuntimeCurrent();
    expect(phases).toEqual(['quiesce', 'intake', 'evidence', 'provider']); expect(f.closed()).toBe(true);
    expect(() => f.owner.start({} as never)).toThrow(expect.objectContaining({ code: 'JOBS_NOT_READY' }));
  } finally { await f.close(); }
});

test('bounded dependent failures aggregate only after ignored-cancellation intake and evidence bodies physically settle', async () => {
  const f = await fixture(), intake = new WorkPool({ concurrency: 1, shutdownGraceMs: 1 }), evidence = new WorkPool({ concurrency: 1, shutdownGraceMs: 1 });
  const intakeEntered = deferred(), evidenceEntered = deferred(), intakeGate = deferred(), evidenceGate = deferred();
  let evidencePhase = false, providerClosed = false, finished = false, closing: Promise<unknown> | undefined;
  const intakeCall = intake.run(async () => { intakeEntered.resolve(); await intakeGate.promise; });
  const evidenceCall = evidence.run(async () => { evidenceEntered.resolve(); await evidenceGate.promise; });
  void intakeCall.catch(() => {}); void evidenceCall.catch(() => {});
  try {
    await Promise.all([intakeEntered.promise, evidenceEntered.promise]);
    const closeAndJoin = async (pool: WorkPool) => {
      let failure: unknown;
      try { await pool.close(); } catch (error) { failure = error; }
      await pool.drainPhysical(); if (failure) throw failure;
    };
    f.owner.attachDependency({ quiesce() {}, async drainIntake() { await closeAndJoin(intake); },
      async drainEvidence() { evidencePhase = true; await closeAndJoin(evidence); },
      async closeProvider() { providerClosed = true; } });
    f.owner.sealDependencies();
    closing = f.owner.close().then(() => { finished = true; }, error => { finished = true; return error; });
    await untilMemoryJobs(() => intake.status().state === 'closing');
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    expect(finished).toBe(false); expect(f.stops()).toBe(0); expect(f.closed()).toBe(false);
    intakeGate.resolve(); await untilMemoryJobs(() => evidencePhase);
    await new Promise<void>(resolve => setTimeout(resolve, 5));
    expect(finished).toBe(false); expect(f.stops()).toBe(1); expect(f.closed()).toBe(false); expect(providerClosed).toBe(false);
    evidenceGate.resolve(); expect(await closing).toBeInstanceOf(AggregateError);
    expect(f.closed()).toBe(true); expect(providerClosed).toBe(true);
  } finally {
    intakeGate.resolve(); evidenceGate.resolve(); await closing;
    try { await Promise.allSettled([intake.close(), evidence.close()]); }
    finally { await Promise.all([intake.drainPhysical(), evidence.drainPhysical()]); await f.close().catch(() => {}); }
  }
});

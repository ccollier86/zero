/** Native Jobs/realm/Torrent and route construction in memory. JobsRuntime.open
 * is explicitly replaced by the owned MEMORY transport fixture, not an actor or
 * real createApp/file/deployment qualification. No listener/build is started.
 */
import { expect, spyOn, test } from 'bun:test';
import { Elysia } from 'elysia';
import { AuthorityCommitCoordinator } from '../../databases/authority-commit-coordinator';
import { JobsRuntime } from '../../jobs/runtime';
import type { ResolvedJobsConfig } from '../../jobs/config';
import { memorySourceJobsFixture, untilMemoryJobs } from '../../jobs/test-support/memory-source-fixture';
import { applicationServiceDataScope } from '../../auth/service-data-scope';
import { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_DATABASE_COMMIT_AUTHORITY, ZERO_DATABASE_MANAGER, ZERO_JOBS_SERVICE, ZERO_SYSTEM_DB } from '../../runtime/service-keys';
import { createReactiveDB } from '../../sync/reactive-db';
import { SchedulerService } from '../../scheduler/scheduler-service';
import type { ResolvedConfig } from './types';
import { prepareManagedJobs } from './app-jobs';

async function fixture(activity?: () => Promise<void>) {
  const f = await memorySourceJobsFixture({ activity: async () => { await activity?.(); } }), system = createReactiveDB({ mode: 'memory' }), authority = new AuthorityCommitCoordinator();
  try {
    system.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    const runtime = new ZeroAppRuntime(), app = new Elysia();
    const options = (f.service as unknown as { options: { runtime: JobsRuntime; config: ResolvedJobsConfig } }).options;
    const open = spyOn(JobsRuntime, 'open').mockResolvedValue(options.runtime);
    runtime.set(ZERO_SYSTEM_DB, system);
    runtime.set(ZERO_DATABASE_MANAGER, { systemRuntime: { sqlite: { mode: 'ephemeral' } } } as never);
    runtime.set(ZERO_DATABASE_COMMIT_AUTHORITY, { coordinator: authority, actorContext: null });
    // Only these composition fields are consumed; this is intentionally NOT a
    // fully configured managed app or an authorization fixture.
    const config = { jobs: options.config, migrate: false } as ResolvedConfig;
    return { f, app, runtime, config, open, async close() {
      try { await runtime.dispose(); }
      finally { open.mockRestore(); try { await f.close(); } finally { system.dispose(); await authority.drain(); } }
    } };
  } catch (error) { try { await f.close(); } finally { system.dispose(); await authority.drain(); } throw error; }
}

test('managed Jobs construction is dormant; runtime teardown drains while workflow-dependent evidence is still owned', async () => {
  const f = await fixture(), scheduler = new SchedulerService(); let stopped = 0;
  try {
    const owned = await prepareManagedJobs(f.app, f.runtime, f.config, f.f.workflows, async () => {
      stopped++; expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBe(owned!.service);
      expect((f.f.service.diagnostics().persistence as unknown as { closed: boolean }).closed).toBe(false);
      expect(owned!.service.diagnostics().automaticWakes).toBe(false);
      await f.f.workflows.dispose();
    });
    expect(owned).not.toBeNull(); expect(f.open).toHaveBeenCalledTimes(1);
    expect(f.open.mock.calls[0]![0].installAllowed).toBe(true);
    expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBe(owned!.service);
    expect(owned!.service.diagnostics().automaticWakes).toBe(false); expect(scheduler.list()).toEqual([]);
    owned!.start(scheduler); expect(owned!.service.diagnostics().automaticWakes).toBe(true);
    expect(scheduler.has('zero-durable-jobs')).toBe(true);
    await f.runtime.dispose(); expect(stopped).toBe(1); expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBeNull();
    expect(scheduler.has('zero-durable-jobs')).toBe(false); expect((f.f.service.diagnostics().persistence as unknown as { closed: boolean }).closed).toBe(true);
    await owned!.close(); expect(stopped).toBe(1);
  } finally { try { await f.close(); } finally { await scheduler.close(); } }
});

test('disabled managed Jobs makes no native owner, routes, runtime publication or dependency callback', async () => {
  const f = await fixture(); let stops = 0;
  try {
    const before = f.app.routes.length;
    expect(await prepareManagedJobs(f.app, f.runtime, { ...f.config, jobs: false }, f.f.workflows, async () => { stops++; })).toBeNull();
    expect(f.open).not.toHaveBeenCalled(); expect(f.app.routes).toHaveLength(before);
    expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBeNull(); expect(stops).toBe(0);
  } finally { await f.close(); }
});

test('managed Jobs final close retains its provider beyond Torrent shutdown grace until the actual ignored-abort activity settles', async () => {
  let release!: () => void, entered = false, stopped = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(async () => { entered = true; await gate; });
  let closing: Promise<void> | undefined;
  try {
    const owned = await prepareManagedJobs(f.app, f.runtime, f.config, f.f.workflows, async () => { await f.f.workflows.dispose(); stopped = true; });
    await f.f.workflows.enqueueAsSystemOnce('synthetic.source.workflow', { kind: 'ignores-abort' }, {
      principal: 'synthetic:shutdown-proof', reason: 'Synthetic physical shutdown proof', scope: applicationServiceDataScope(), idempotencyKey: 'physical-shutdown',
    });
    await untilMemoryJobs(() => entered);
    let finished = false; closing = owned!.close().then(() => { finished = true; });
    await untilMemoryJobs(() => stopped);
    expect(finished).toBe(false); expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBe(owned!.service);
    expect((f.f.service.diagnostics().persistence as unknown as { closed: boolean }).closed).toBe(false);
    release(); await closing;
    expect(finished).toBe(true); expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBeNull();
    expect((f.f.service.diagnostics().persistence as unknown as { closed: boolean }).closed).toBe(true);
  } finally { release(); try { await closing; } finally { await f.close(); } }
});

test('late route-construction failure closes its exact dormant provider without recursively stopping workflow initialization', async () => {
  const f = await fixture(); let stops = 0;
  const use = spyOn(f.app, 'use').mockImplementation(() => { throw new Error('Synthetic route construction failure.'); });
  try {
    await expect(prepareManagedJobs(f.app, f.runtime, f.config, f.f.workflows, async () => { stops++; })).rejects.toThrow('Synthetic route construction failure.');
    expect(f.runtime.get(ZERO_JOBS_SERVICE)).toBeNull(); expect((f.f.service.diagnostics().persistence as unknown as { closed: boolean }).closed).toBe(true);
    await f.runtime.dispose(); expect(stops).toBe(0);
  } finally { use.mockRestore(); await f.close(); }
});

/** Pure dispatcher admission algorithm, not an authorization or database substitute. Native managed integration tests own those proofs. */
import { expect, test } from 'bun:test';
import { trustedSystemServiceDataScope, serviceDataScopeKey } from '../auth/service-data-scope';
import { WorkPool } from '../workers/work-pool';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type { WorkflowDeferredStartBridge } from '../workflows/workflow-deferred-start-bridge';
import { resolveJobsConfig } from './config';
import type { JobsDueCursor, JobsRuntime } from './runtime';
import { JobsRunner } from './runner';
import { JobsError } from './error';
import { currentLoggingAttribution, runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';

for (const entry of ['tick', 'wake'] as const) for (const phase of ['active', 'retired'] as const) test(`background ${entry} cannot inherit an ${phase} request audit lifetime`, async () => {
  const owner = {}, scope = trustedSystemServiceDataScope({ scopeKind: 'application' });
  const configured = resolveJobsConfig(true, process.cwd(), resolveAuthBehaviorConfig({}), true);
  if (!configured) throw new Error('Synthetic jobs config was not admitted.');
  const gate = new WorkPool({ concurrency: 1 });
  let due = true, reads = 0, release!: () => void, finished!: () => void;
  const later = new Promise<void>(resolve => { release = resolve; });
  const settled = new Promise<void>(resolve => { finished = resolve; });
  const runtime = {
    dueScopePage() { return due ? [{ scope, cursor: { wakeAt: 0, id: 'application' } }] : []; },
    async read<T>(): Promise<T> { expect(currentLoggingAttribution(owner)).toBeNull(); reads++; return [] as T; },
    async refreshWake() { due = false; finished(); },
  } as unknown as JobsRuntime;
  const runner = new JobsRunner({ runtime, config: configured, bridge: { assertRuntimeCurrent() {} } as WorkflowDeferredStartBridge, gate });
  let deferred: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observe = () => Promise.race([settled, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Owned background run did not settle.')), 1000); })]);
  try {
    await runWithLoggingAttribution(owner, loggingContext(null), () => {}, async () => {
      expect(currentLoggingAttribution(owner)).not.toBeNull();
      if (phase === 'active') {
        if (entry === 'tick') await runner.tick(); else runner.wake();
        await observe();
      } else deferred = later.then(async () => { if (entry === 'tick') await runner.tick(); else runner.wake(); });
    });
    release(); await deferred;
    if (phase === 'retired') await observe();
    expect(reads).toBeGreaterThan(0); expect(runner.diagnostics().reportedFailures).toEqual([]);
  } finally { clearTimeout(timer); release(); await deferred; await runner.close(); await gate.close(); }
});

function duePage(scopes: readonly ReturnType<typeof trustedSystemServiceDataScope>[], limit: number, after?: JobsDueCursor) {
  return scopes.map(scope => ({ scope, cursor: { wakeAt: 0, id: serviceDataScopeKey(scope) } }))
    .sort((a, b) => a.cursor.id.localeCompare(b.cursor.id))
    .filter(entry => !after || entry.cursor.id > after.id).slice(0, limit);
}

test('a freed scope slot advances the next due database without waiting on an unrelated slow scope or another timer', async () => {
  const scope = (id: string) => trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: id });
  const due = new Map(['a-slow', 'fast-one', 'fast-two', 'fast-three'].map(id => [serviceDataScopeKey(scope(id)), scope(id)]));
  const entered: string[] = []; let active = 0, peak = 0, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const configured = resolveJobsConfig({ maxActiveDatabases: 2 }, process.cwd(), resolveAuthBehaviorConfig({}), true);
  if (!configured) throw new Error('Synthetic jobs config was not admitted.');
  const gate = new WorkPool({ concurrency: 8 });
  const runtime = {
    dueScopePage(_now: number, limit: number, after?: JobsDueCursor) { return duePage([...due.values()], limit, after); },
    async read<T>(_scope: unknown, name: string): Promise<T> { return [] as T; },
    async refreshWake(value: ReturnType<typeof scope>) {
      const key = serviceDataScopeKey(value); entered.push(key); peak = Math.max(peak, ++active);
      try { if (key === 'tenant:a-slow') await blocked; due.delete(key); } finally { active--; }
    },
  } as unknown as JobsRuntime;
  const bridge = { assertRuntimeCurrent() {} } as WorkflowDeferredStartBridge;
  const runner = new JobsRunner({ runtime, bridge, config: configured, gate });
  try {
    await runner.tick();
    const deadline = Date.now() + 1000;
    while (!entered.includes('tenant:fast-three')) { if (Date.now() > deadline) throw new Error('Freed scope slot did not refill.'); await Bun.sleep(1); }
    expect(entered).toContain('tenant:a-slow'); expect(due.has('tenant:a-slow')).toBe(true);
    expect(peak).toBe(2); expect(runner.diagnostics().activeScopes).toBe(1);
    let closed = false; const closing = runner.close().then(() => { closed = true; });
    await Bun.sleep(1); expect(closed).toBe(false); release(); await closing;
    expect(runner.diagnostics()).toMatchObject({ state: 'closed', activeScopes: 0 });
  } finally { release(); await runner.close(); await gate.close(); }
});

test('a rejected retained command backs off rather than spinning a scope-refill loop', async () => {
  const value = trustedSystemServiceDataScope({ scopeKind: 'application' });
  const configured = resolveJobsConfig(true, process.cwd(), resolveAuthBehaviorConfig({}), true);
  if (!configured) throw new Error('Synthetic jobs config was not admitted.');
  const gate = new WorkPool({ concurrency: 1 }); let ready = true, commands = 0, deferred = 0;
  const runtime = {
    dueScopePage(_now: number, limit: number, after?: JobsDueCursor) { return duePage(ready ? [value] : [], limit, after); },
    async read<T>(_scope: unknown, name: string): Promise<T> { return (name === 'jobs.due' ? [{ id: 'synthetic', revision: 1 }] : []) as T; },
    async write() { commands++; throw new JobsError('JOBS_STATE_INVALID'); },
    async refreshWake() {},
    async deferWake(_scope: unknown, time: number) { expect(time).toBe(2000); ready = false; deferred++; },
  } as unknown as JobsRuntime;
  const runner = new JobsRunner({ runtime, config: configured, bridge: { assertRuntimeCurrent() {} } as WorkflowDeferredStartBridge, gate, now: () => 1000 });
  try {
    await runner.tick(); const deadline = Date.now() + 1000;
    while (!deferred) { if (Date.now() > deadline) throw new Error('Synthetic scope did not defer.'); await Bun.sleep(1); }
    await Bun.sleep(5); expect(commands).toBe(1); expect(deferred).toBe(1);
    expect(runner.diagnostics().reportedFailures).toContain('scope:JOBS_STATE_INVALID');
  } finally { await runner.close(); await gate.close(); }
});

for (const publication of ['no-op', 'throws'] as const) test('local retry admission survives durable backoff publication that ' + publication, async () => {
  const scope = (id: string) => trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: id });
  const failing = scope('failing'), healthy = scope('healthy');
  const configured = resolveJobsConfig({ maxActiveDatabases: 1 }, process.cwd(), resolveAuthBehaviorConfig({}), true);
  if (!configured) throw new Error('Synthetic jobs config was not admitted.');
  const gate = new WorkPool({ concurrency: 1 }); let now = 1000, failures = 0, progressed = false;
  const runtime = {
    dueScopePage(_now: number, limit: number, after?: JobsDueCursor) { return duePage([failing, ...(progressed ? [] : [healthy])], limit, after); },
    async read<T>(value: ReturnType<typeof scope>): Promise<T> {
      if (serviceDataScopeKey(value) === 'tenant:failing') { failures++; throw new JobsError('JOBS_STATE_INVALID'); }
      return [] as T;
    },
    async refreshWake() { progressed = true; },
    async deferWake() { if (publication === 'throws') throw new JobsError('JOBS_NOT_READY'); },
  } as unknown as JobsRuntime;
  const runner = new JobsRunner({ runtime, config: configured, bridge: { assertRuntimeCurrent() {} } as WorkflowDeferredStartBridge, gate, now: () => now });
  try {
    await runner.tick(); const deadline = Date.now() + 1000;
    while (!progressed || runner.diagnostics().activeScopes) { if (Date.now() > deadline) throw new Error('Backoff did not yield to the healthy scope.'); await Bun.sleep(1); }
    await runner.tick(); await Bun.sleep(5); expect(failures).toBe(1); expect(progressed).toBeTruthy();
    now = 6000; await runner.tick();
    while (runner.diagnostics().activeScopes) { if (Date.now() > deadline) throw new Error('Retry did not settle.'); await Bun.sleep(1); }
    expect(failures).toBe(2);
  } finally { await runner.close(); await gate.close(); }
});

test('a full page of locally backed-off roots cannot hide a healthy due database beyond the discovery window', async () => {
  const scopes = Array.from({ length: 100 }, (_, i) => trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'bad-' + String(i).padStart(3, '0') }));
  const healthy = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'healthy' });
  const configured = resolveJobsConfig({ maxActiveDatabases: 1 }, process.cwd(), resolveAuthBehaviorConfig({}), true);
  if (!configured) throw new Error('Synthetic jobs config was not admitted.');
  let failures = 0, progressed = false, pageReads = 0;
  const gate = new WorkPool({ concurrency: 1 });
  const runtime = {
    dueScopePage(_now: number, limit: number, after?: JobsDueCursor) { pageReads++; return duePage([...scopes, ...(progressed ? [] : [healthy])], limit, after); },
    async read<T>(value: ReturnType<typeof trustedSystemServiceDataScope>): Promise<T> {
      if (serviceDataScopeKey(value) !== 'tenant:healthy') { failures++; throw new JobsError('JOBS_STATE_INVALID'); }
      return [] as T;
    },
    async refreshWake() { progressed = true; }, async deferWake() {},
  } as unknown as JobsRuntime;
  const runner = new JobsRunner({ runtime, config: configured, bridge: { assertRuntimeCurrent() {} } as WorkflowDeferredStartBridge, gate, now: () => 1000 });
  try {
    await runner.tick(); const deadline = Date.now() + 3000;
    while (!progressed || runner.diagnostics().activeScopes) { if (Date.now() > deadline) throw new Error('Healthy scope was hidden behind backed-off roots.'); await Bun.sleep(1); }
    expect(failures).toBe(100); expect(progressed).toBeTruthy();
    const before = pageReads; await runner.tick(); await Bun.sleep(5);
    expect(failures).toBe(100); expect(pageReads - before).toBeLessThanOrEqual(2);
  } finally { await runner.close(); await gate.close(); }
});

test('continuously advancing cron wakes cannot keep newly dirty scopes behind the discovery cursor forever', async () => {
  const target = (id: string) => trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: id });
  const rows = new Map(Array.from({ length: 100 }, (_, i) => {
    const scope = target('recurring-' + String(i).padStart(3, '0')); return [serviceDataScopeKey(scope), { scope, wakeAt: i }];
  }));
  const added = target('new-dirty');
  const configured = resolveJobsConfig({ maxActiveDatabases: 1 }, process.cwd(), resolveAuthBehaviorConfig({}), true);
  if (!configured) throw new Error('Synthetic jobs config was not admitted.');
  let now = 100, recurring = 0, progressed = false, release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const gate = new WorkPool({ concurrency: 1 });
  const runtime = {
    dueScopePage(horizon: number, limit: number, after?: JobsDueCursor) {
      return [...rows.values()].map(row => ({ scope: row.scope, cursor: { wakeAt: row.wakeAt, id: serviceDataScopeKey(row.scope) } }))
        .filter(entry => entry.cursor.wakeAt <= horizon && (!after || entry.cursor.wakeAt > after.wakeAt || entry.cursor.wakeAt === after.wakeAt && entry.cursor.id > after.id))
        .sort((a, b) => a.cursor.wakeAt - b.cursor.wakeAt || a.cursor.id.localeCompare(b.cursor.id)).slice(0, limit);
    },
    async read<T>(): Promise<T> { return [] as T; },
    async refreshWake(scope: ReturnType<typeof target>) {
      const key = serviceDataScopeKey(scope);
      if (key === serviceDataScopeKey(added)) { progressed = true; rows.delete(key); await blocked; return; }
      recurring++; now += 2000;
      rows.set(key, { scope, wakeAt: now - 500 });
      rows.set(serviceDataScopeKey(added), { scope: added, wakeAt: 0 });
      if (recurring > 100) throw new Error('A repeated advancing scope prevented pass completion.');
    },
    async deferWake() {},
  } as unknown as JobsRuntime;
  const runner = new JobsRunner({ runtime, config: configured, bridge: { assertRuntimeCurrent() {} } as WorkflowDeferredStartBridge, gate, now: () => now });
  try {
    await runner.tick(); const deadline = Date.now() + 3000;
    while (!progressed) { if (Date.now() > deadline) throw new Error('New dirty scope was starved by advancing cron roots.'); await Bun.sleep(1); }
    expect(recurring).toBe(100); expect(progressed).toBeTruthy();
  } finally { release(); await runner.close(); await gate.close(); }
});

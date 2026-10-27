/** Actual managed Fabric actors, private files and synthetic contexts; no live apps or credentials. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LoggingRuntime } from './logging-runtime';
import { resolveManagedLoggingConfig, type ResolvedManagedLoggingConfig } from './logging-managed-config';
import { loggingContext, loggingEvent } from './test-support/logging-fixture';
import { installLoggingObservabilityBridge } from './logging-observability-bridge';
import { emitPlatformEventTo } from '../observability/sink';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { MemoryEventStore } from '../observability/memory-event-store';

function observability(): PlatformObservabilityRuntime {
  const store = new MemoryEventStore(); return { sink: store, store, config: { console: false } };
}
function config(rootDirectory: string): ResolvedManagedLoggingConfig {
  return resolveManagedLoggingConfig({ rootDirectory, preset: 'activity' }, rootDirectory) as ResolvedManagedLoggingConfig;
}
function diagnostic(code: string) { return { level: 'warn' as const, category: 'fixture', code, message: 'Synthetic private detail',
  metadata: { password: 'synthetic-secret', patient: 'synthetic-content' }, error: new Error('Private raw error') }; }

test('managed runtime opens both streams, drains admissions before release and persists across ownership restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-runtime-')); let runtime: LoggingRuntime | undefined;
  try {
    runtime = await LoggingRuntime.open(config(root), observability());
    const event = loggingEvent('persisted'); const { version, stream, sourceId, origin, scope, actor, requestId, correlationId, policyVersion, ...input } = event;
    const admitted = runtime.capture(loggingContext(), input);
    const closing = runtime.close(); expect(runtime.close()).toBe(closing);
    await expect(runtime.capture(loggingContext(), input)).rejects.toMatchObject({ code: 'LOGGING_CLOSED' });
    expect((await admitted)?.id).toBe('persisted'); await closing;
    expect(runtime.diagnostics()).toMatchObject({ state: 'closed', databases: { state: 'closed', heldAuthorityLeases: 0 } });
    runtime = await LoggingRuntime.open(config(root), observability());
    expect((await runtime.page('audit', { kind: 'tenant', tenantId: 'tenant-a' })).events.map(row => row.event.id)).toEqual(['persisted']);
    expect((await runtime.page('operational', { kind: 'platform' })).events).toHaveLength(0);
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('partial actor startup failure releases ownership so a corrected runtime can open immediately', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-partial-')); let runtime: LoggingRuntime | undefined;
  try {
    const valid = config(root);
    const broken = { ...valid, createExecutor: ((context: Parameters<typeof valid.createExecutor>[0]) => {
      if (context.slot === 1) throw new Error('Synthetic actor startup failure');
      return valid.createExecutor(context);
    }) as typeof valid.createExecutor };
    await expect(LoggingRuntime.open(broken, observability())).rejects.toThrow();
    runtime = await LoggingRuntime.open(valid, observability());
    expect(runtime.diagnostics().state).toBe('ready');
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('diagnostic bridge excludes private contents, preserves previous sinks, avoids log-of-log recursion and restores ownership', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-bridge-')); let runtime: LoggingRuntime | undefined;
  try {
    const obs = observability(), previous = obs.sink;
    runtime = await LoggingRuntime.open(config(root), obs);
    const bridge = installLoggingObservabilityBridge(runtime, obs);
    emitPlatformEventTo(obs, diagnostic('fixture.warning'));
    emitPlatformEventTo(obs, { ...diagnostic('fixture.frontend'), source: 'frontend' });
    await runtime.flush();
    const first = await runtime.page('operational', { kind: 'platform' });
    expect(first.events.map(row => row.event.action)).toEqual(['fixture.warning']);
    expect(JSON.stringify(first)).not.toMatch(/synthetic-secret|synthetic-content|private detail|Private raw error/i);
    expect(first.events[0]?.event.metadata).toEqual({ category: 'fixture', sourceCode: 'fixture.warning' });
    expect(obs.store?.query({ code: 'fixture.warning' }).count).toBe(1);
    await runtime.flush();
    expect((await runtime.page('operational', { kind: 'platform' })).highWaterOrdinal).toBe(first.highWaterOrdinal);
    expect(bridge.diagnostics()).toMatchObject({ accepted: 1, failed: 0 });
    expect(runtime.diagnostics().coverage).toMatchObject({ automaticAudit: false, complianceReady: false });
    bridge.detach(); expect(obs.sink).toBe(previous);
    emitPlatformEventTo(obs, diagnostic('fixture.after_detach')); await runtime.flush();
    expect((await runtime.page('operational', { kind: 'platform' })).events).toHaveLength(1);
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('new app lifetimes cannot collide when the operational emitter restarts its event counter', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-boot-identity-')); let runtime: LoggingRuntime | undefined;
  try {
    for (const code of ['fixture.first_boot', 'fixture.second_boot']) {
      const obs = observability(); runtime = await LoggingRuntime.open(config(root), obs);
      const bridge = installLoggingObservabilityBridge(runtime, obs);
      emitPlatformEventTo(obs, diagnostic(code)); await runtime.flush(); bridge.detach(); await runtime.close();
    }
    runtime = await LoggingRuntime.open(config(root), observability());
    const rows = (await runtime.page('operational', { kind: 'platform' })).events;
    expect(rows.map(row => row.event.action)).toEqual(['fixture.second_boot', 'fixture.first_boot']);
    expect(rows.map(row => row.event.id)).toEqual(['obs_1', 'obs_1']);
    expect(new Set(rows.map(row => row.event.sourceId)).size).toBe(2);
  } finally { await runtime?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test('a failed retained source retires strict grants and recovery requires a new durable acknowledgment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-strict-source-health-'));
  const strict = resolveManagedLoggingConfig({ preset: 'compliance', rootDirectory: root }, root) as ResolvedManagedLoggingConfig;
  const runtime = await LoggingRuntime.open(strict, observability());
  let offline = false;
  const source = runtime.registerDeliverySource({ page() { if (offline) throw new Error('Synthetic unavailable source'); return { rows: [], queued: 0, bytes: 0 }; }, failed() {} });
  const auth = { userId: 'fixture-user', sessionId: 'fixture-session', role: 'user', email: 'fixture@example.test', sessionKind: 'web' as const };
  const context = { ...loggingContext(), policyVersion: strict.policyVersion };
  const acknowledge = () => runtime.admission.acknowledge({ auth }, context, strict.policyVersion, async () => {});
  try {
    await source.flush(); await acknowledge(); expect(() => runtime.admission.assertCurrent({ auth })).not.toThrow();
    offline = true; source.wake(); await source.flush();
    expect(runtime.diagnostics().unavailableSources).toBe(1);
    expect(() => runtime.admission.assertCurrent({ auth })).toThrow(); await expect(acknowledge()).rejects.toThrow();
    offline = false; source.wake(); await source.flush(); expect(runtime.diagnostics().unavailableSources).toBe(0);
    expect(() => runtime.admission.assertCurrent({ auth })).toThrow();
    await acknowledge(); expect(() => runtime.admission.assertCurrent({ auth })).not.toThrow();
  } finally { await source.close(); await runtime.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

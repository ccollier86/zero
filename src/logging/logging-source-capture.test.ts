/** Real source transactions and a faulting sink; no live identities or application files. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { registerReactiveDBMutationInterceptor } from '../sync/reactive-db-mutation-interceptor';
import { LoggingSourceOutbox } from './logging-source-outbox';
import { installLoggingSourceCapture } from './logging-source-capture';
import { resolveManagedLoggingConfig } from './logging-managed-config';
import type { LoggingRuntime } from './logging-runtime';
import type { LoggingEvent } from './logging-contracts';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LoggingDeliveryProcess } from './logging-delivery-process';
import type { ResolvedManagedLoggingConfig } from './logging-managed-config';
import type { DeliverySourceRegistration } from './logging-delivery-protocol';
import type { LoggingResourcePolicies } from './logging-activity-contracts';

async function sourceOwner(root: string, deliver: (event: LoggingEvent) => Promise<unknown>, resources: LoggingResourcePolicies = {}) {
  const config = resolveManagedLoggingConfig({ preset: 'activity', resources }, root) as ResolvedManagedLoggingConfig;
  const ordinals = new Map<string, number>();
  const worker = await LoggingDeliveryProcess.open(config.createExecutor, config.policy.queue, async (_stream, events) => {
    const receipts = [];
    for (const event of events) {
      await deliver(event); const key = event.sourceId + ':' + event.id, duplicate = ordinals.has(key);
      if (!duplicate) ordinals.set(key, ordinals.size + 1);
      receipts.push({ id: event.id, sourceId: event.sourceId, ordinal: ordinals.get(key)!, duplicate });
    }
    return { receipts, sequence: { seq: 0 } };
  });
  const logging = { config,
    registerDeliverySource: worker.registerSource.bind(worker),
    flushDeliverySources: (sources: readonly DeliverySourceRegistration[]) => worker.flushSources(sources.map(r => r.id)),
    closeDeliverySources: (sources: readonly DeliverySourceRegistration[]) => worker.closeSources(sources.map(r => r.id)),
  } as unknown as LoggingRuntime;
  return { logging, worker };
}

test('pinned committed changes use the same approved differences as Fabric and never retain rollback or no-op edits', async () => {
  const application = createReactiveDB({ mode: 'memory' }), system = createReactiveDB({ mode: 'memory' });
  application.defineTable('invoices', { id: 'text primary key', status: 'text', private_note: 'text' });
  const events: LoggingEvent[] = [];
  const { logging, worker } = await sourceOwner('/tmp', async event => { events.push(event); }, { invoices: { fields: { status: { values: ['draft', 'approved'] } } } });
  const capture = installLoggingSourceCapture(logging, application, system);
  try {
    application.create('invoices', { id: 'invoice-7', status: 'draft', private_note: 'DO_NOT_RETAIN' });
    application.update('invoices', 'invoice-7', { status: 'approved' });
    application.update('invoices', 'invoice-7', { status: 'approved' });
    expect(() => application.transaction(() => { application.update('invoices', 'invoice-7', { status: 'draft' }); throw new Error('Rollback'); })).toThrow('Rollback');
    await capture.flush();
    expect(events).toHaveLength(2);
    expect(events[1]!.detail).toMatchObject({ kind: 'record-change', table: 'invoices', changes: [
      { field: 'status', kind: 'value', before: 'draft', after: 'approved' },
    ] });
    expect(JSON.stringify(events)).not.toContain('DO_NOT_RETAIN');
    expect(events.map(event => event.action)).toEqual(['record.created', 'record.updated']);
  } finally { await capture.close(); await worker.close(); application.dispose(); system.dispose(); }
}, 30000);

test('capture joins the original commit, preserves automation hooks, excludes values and retries after a sink outage', async () => {
  const application = createReactiveDB({ mode: 'memory' }), system = createReactiveDB({ mode: 'memory' });
  application.defineTable('records', { id: 'text primary key', tenant_id: 'text', content: 'text' });
  let offline = true, automations = 0, failures = 0;
  const retained: LoggingEvent[] = [];
  const { logging, worker } = await sourceOwner('/tmp', async event => { if (offline) throw new Error('Unavailable'); retained.push(event); });
  const detach = registerReactiveDBMutationInterceptor(application, () => { automations++; });
  const capture = installLoggingSourceCapture(logging, application, system, { records: 'tenant_id' }, () => { failures++; });
  try {
    expect(() => application.transaction(() => {
      application.create('records', { id: 'rolled-back', tenant_id: 'tenant-a', content: 'Never retain me' });
      throw new Error('Abort');
    })).toThrow('Abort');
    expect(capture.diagnostics().application.queued).toBe(0);
    application.create('records', { id: 'committed', tenant_id: 'tenant-a', content: 'Never retain me either' });
    expect(capture.diagnostics().application.queued).toBe(1);
    await capture.flush(); expect(failures).toBeGreaterThan(0);
    expect(capture.diagnostics().application.queued).toBe(1);
    offline = false; await capture.flush();
    expect(retained).toHaveLength(1);
    expect(retained[0]!.scope).toEqual({ kind: 'tenant', tenantId: 'tenant-a' });
    expect(JSON.stringify(retained)).not.toContain('Never retain');
    expect(retained[0]!.actor.kind).toBe('system');
    expect(capture.diagnostics().application.queued).toBe(0);
    expect(automations).toBe(2);
    const outbox = new LoggingSourceOutbox(application);
    expect(outbox.sourceId).toBe(new LoggingSourceOutbox(application).sourceId);
    await Promise.all([capture.close(), capture.close()]);
  } finally { detach(); await capture.close(); await worker.close(); application.dispose(); system.dispose(); }
}, 30000);

test('a required audit admission failure rolls back the mutation, not just its evidence', async () => {
  const application = createReactiveDB({ mode: 'memory' }), system = createReactiveDB({ mode: 'memory' });
  application.defineTable('records', { id: 'text primary key', tenant_id: 'text' });
  const { logging, worker } = await sourceOwner('/tmp', async () => {});
  const capture = installLoggingSourceCapture(logging, application, system, { records: 'tenant_id' });
  try {
    expect(() => application.create('records', { id: 'bad' })).toThrow('Tenant audit attribution');
    expect(application.get('records', 'bad')).toBeNull();
    expect(capture.diagnostics().application.queued).toBe(0);
  } finally { await capture.close(); await worker.close(); application.dispose(); system.dispose(); }
}, 30000);

test('an unresolved sink acknowledgment leaves a file-backed origin queue recoverable across source reopen', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-origin-recovery-')), path = join(root, 'application.db');
  let application = createReactiveDB({ mode: 'file', path }), system = createReactiveDB({ mode: 'memory' });
  application.defineTable('records', { id: 'text primary key' });
  const committed = new Set<string>(); let fail = true;
  const { logging, worker } = await sourceOwner(root, async event => { committed.add(event.sourceId + ':' + event.id); if (fail) throw new Error('Synthetic acknowledgment lost'); });
  let capture = installLoggingSourceCapture(logging, application, system);
  try {
    application.create('records', { id: 'durable' }); await capture.flush();
    const sourceId = new LoggingSourceOutbox(application).sourceId;
    expect(capture.diagnostics().application.queued).toBe(1); expect(committed.size).toBe(1);
    await capture.close(); application.dispose(); system.dispose();
    application = createReactiveDB({ mode: 'file', path }); application.defineTable('records', { id: 'text primary key' }); system = createReactiveDB({ mode: 'memory' });
    fail = false; capture = installLoggingSourceCapture(logging, application, system); await capture.flush();
    expect(new LoggingSourceOutbox(application).sourceId).toBe(sourceId);
    expect(application.get('records', 'durable')).not.toBeNull(); expect(capture.diagnostics().application.queued).toBe(0); expect(committed.size).toBe(1);
  } finally { await capture.close(); await worker.close(); application.dispose(); system.dispose(); await rm(root, { recursive: true, force: true }); }
}, 30000);

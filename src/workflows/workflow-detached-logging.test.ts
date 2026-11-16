/** Real in-memory workflow/source capture. Only delivery scheduling is inert; no actor, file or provider is opened. */
import { expect, test } from 'bun:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createReactiveDB } from '../sync/reactive-db';
import { installLoggingSourceCapture } from '../logging/logging-source-capture';
import { LoggingSourceOutbox } from '../logging/logging-source-outbox';
import { resolveManagedLoggingConfig } from '../logging/logging-managed-config';
import { runWithLoggingAttribution } from '../logging/logging-attribution';
import { loggingContext } from '../logging/test-support/logging-fixture';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { LoggingEvent } from '../logging/logging-contracts';
import { workflowContractFixture } from './workflow-contracts.test-support';

function gate() {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
}
function matches(event: LoggingEvent, table: string, id: string): boolean {
  return event.detail?.kind === 'record-change' && event.detail.table === table && event.target?.id === id;
}

for (const format of ['graph', 'legacy'] as const) {
  test(`${format} detached execution owns its audit lifetime without stripping actor publication or request capture`, async () => {
    const f = workflowContractFixture(), system = createReactiveDB({ mode: 'memory', emitTelemetry: false });
    const hold = gate(), entered = gate(), completed = gate();
    let capture: ReturnType<typeof installLoggingSourceCapture> | undefined, unsubscribe = () => {};
    try {
      const slow = async () => { entered.release(); await hold.promise; return { complete: true }; };
      f.registry.registerActivity({ name: 'detached.slow', version: '1', databaseCallable: true, handler: slow });
      if (format === 'legacy') {
        f.registry.registerHandler('detached.legacy', slow);
        f.registry.create({ name: 'detached-legacy', steps: [{ name: 'Run', handler: 'detached.legacy' }] });
      }
      await f.restart();
      f.db.defineTable('attribution_marks', { id: 'text primary key' });
      const config = resolveManagedLoggingConfig({ preset: 'activity', resources: {
        workflow_instances: { fields: { status: { values: ['pending', 'running', 'completed', 'failed', 'cancelled'] } } },
      } }, '/synthetic/no-files');
      if (!config) throw new Error('Synthetic logging config was not resolved.');
      let sourceOrdinal = 0;
      // Source mutation capture, revocation, validation, encoding and the
      // transaction-owned outbox are canonical. Only delivery is out of scope.
      const logging = { config,
        registerDeliverySource: () => ({ id: 'memory:' + ++sourceOrdinal, wake() {}, async flush() {}, async close() {},
          diagnostics: () => ({ queued: 0, bytes: 0, failed: 0, pending: false, active: false }) }),
        async flushDeliverySources() {}, async closeDeliverySources() {},
      } as unknown as LoggingRuntime;
      capture = installLoggingSourceCapture(logging, f.db, system);
      const outbox = new LoggingSourceOutbox(f.db), events = () => outbox.page().map(row => row.event);
      const context = { ...loggingContext(null), policyVersion: config.policyVersion,
        actor: { kind: 'user' as const, id: f.context.userId, sessionId: f.context.sessionId!, initiatorId: null } };
      const attributed = <T>(operation: () => T | Promise<T>) => runWithLoggingAttribution(logging, context, () => {}, operation);
      const expectRequestActor = (event: LoggingEvent | undefined) => expect(event).toMatchObject({
        actor: { kind: 'user', id: f.context.userId }, requestId: context.requestId,
      });

      const publication = await attributed(() => f.service.definitionsForActor(f.context).publish({
        name: 'detached-graph', graph: { schemaVersion: 1, entry: 'run', nodes: [
          { id: 'run', kind: 'activity', activity: { name: 'detached.slow', version: '1' } },
        ], edges: [] },
      }));
      expectRequestActor(events().find(event => event.action === 'record.created'
        && matches(event, 'workflow_definitions', publication.catalog.definition_id)));

      let instanceId: string | undefined;
      unsubscribe = f.db.onChange(change => {
        if (change.table === 'workflow_instances' && change.row?.instance_id === instanceId && change.row.status === 'completed') completed.release();
      });
      const receipt = await within(attributed(() => f.service.enqueueAsActorOnce(
        format === 'graph' ? 'detached-graph' : 'detached-legacy', {}, f.context, { idempotencyKey: 'detached:one' },
      )));
      instanceId = receipt.instanceId;
      await within(entered.promise);
      expect(f.service.get(instanceId)?.status).toBe('running');
      expectRequestActor(events().find(event => event.action === 'record.created' && matches(event, 'workflow_instances', instanceId!)));
      expect(f.db.prepare('SELECT authority_kind FROM _workflow_execution_authorities WHERE instance_id = ?').get(instanceId)).toEqual({ authority_kind: 'actor' });

      await attributed(() => f.db.createStrict('attribution_marks', { id: 'fresh-request' }));
      expectRequestActor(events().find(event => matches(event, 'attribution_marks', 'fresh-request')));
      let retired!: () => unknown;
      await attributed(() => { retired = AsyncLocalStorage.bind(() => f.db.createStrict('attribution_marks', { id: 'retired-request' })); });
      const queuedBeforeRetired = outbox.counts().queued;
      expect(retired).toThrow('Logging attribution lifetime is closed.');
      expect(f.db.get('attribution_marks', 'retired-request')).toBeNull();
      expect(outbox.counts().queued).toBe(queuedBeforeRetired);

      hold.release();
      // Observe the original detached pump's committed completion. Calling
      // advance() here could replace a failed pump and mask the lifetime bug.
      await within(completed.promise);
      expect(f.service.get(instanceId)?.status).toBe('completed');
      const completion = events().find(event => matches(event, 'workflow_instances', instanceId!)
        && event.detail?.kind === 'record-change' && event.detail.changes.some(change => change.field === 'status'
          && change.kind === 'value' && change.after === 'completed'));
      expect(completion).toMatchObject({ actor: { kind: 'system', id: 'zero.database' }, requestId: null });
    } finally {
      hold.release(); unsubscribe();
      try { await f.service.dispose(); }
      finally {
        try { await capture?.close(); }
        finally { f.db.dispose(); system.dispose(); }
      }
    }
  });
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Detached workflow did not settle without manual advance.')), 1000);
    })]);
  } finally { clearTimeout(timer); }
}

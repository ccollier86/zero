import { afterEach, describe, expect, test } from 'bun:test';

import { applicationServiceDataScope } from '../auth/service-data-scope';
import { MemoryEventStore } from '../observability/memory-event-store';
import { OBS_CODES } from '../observability/codes';
import {
  configureObservability,
  getObservabilityRuntime,
} from '../observability/sink';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  WorkflowExecutionAuthorityStore,
} from './workflow-execution-authority';
import { WorkflowExecutionAuthorityGate } from './workflow-execution-authority-gate';
import { createWorkflowObservability } from './workflow-observability';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { WorkflowService } from './workflow-service';

const databases: ReactiveDB[] = [];
const services: WorkflowService[] = [];

afterEach(async () => {
  await Promise.allSettled(services.splice(0).map((service) => service.dispose()));
  for (const db of databases.splice(0)) db.dispose();
});

describe('workflow observability ownership and commit semantics', () => {
  test('keeps two managed app sinks isolated after the global runtime changes', () => {
    const previous = getObservabilityRuntime().config;
    const globalA = new MemoryEventStore();
    const globalB = new MemoryEventStore();
    configureObservability({ console: false, store: globalA });

    const dbA = database();
    const dbB = database();
    const storeA = new MemoryEventStore();
    const storeB = new MemoryEventStore();
    const runtimeA = runtimeWithStore('workflow-observability-a', storeA);
    const runtimeB = runtimeWithStore('workflow-observability-b', storeB);
    const observabilityA = createWorkflowObservability(dbA, runtimeA);
    const observabilityB = createWorkflowObservability(dbB, runtimeB);

    try {
      globalA.clear();
      configureObservability({ console: false, store: globalB });
      observabilityA.emitNow(OBS_CODES.WORKFLOWS_INITIALIZED, {
        metadata: { owner: 'a' },
      });
      dbB.transaction(() => observabilityB.emitAfterCommit(
        OBS_CODES.WORKFLOWS_INITIALIZED,
        { metadata: { owner: 'b' } },
      ));

      expect(storeA.query().events.map((event) => event.metadata?.owner)).toEqual(['a']);
      expect(storeB.query().events.map((event) => event.metadata?.owner)).toEqual(['b']);
      expect(globalA.query().count).toBe(0);
      expect(globalB.query().count).toBe(0);
    } finally {
      configureObservability(previous);
    }
  });

  test('suppresses a rolled-back lifecycle event and emits the committed transition once', async () => {
    const db = database();
    defineWorkflowTables(db);
    const events = new MemoryEventStore();
    const runtime = runtimeWithStore('workflow-commit-events', events);
    const observability = createWorkflowObservability(db, runtime);
    const registry = waitingRegistry();
    const service = new WorkflowService(db, registry, {
      wakeTimer: false,
      observability,
    });
    services.push(service);
    const instanceId = await service.start('observable-wait');
    events.clear();

    const rollback = new Error('roll back cancellation');
    expect(() => db.transaction(() => {
      service.cancel(instanceId, applicationServiceDataScope());
      expect(events.query({ code: OBS_CODES.WORKFLOW_INSTANCE_CANCELLED.code }).count).toBe(0);
      throw rollback;
    })).toThrow(rollback);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(events.query({ code: OBS_CODES.WORKFLOW_INSTANCE_CANCELLED.code }).count).toBe(0);

    db.transaction(() => {
      service.cancel(instanceId, applicationServiceDataScope());
      expect(events.query({ code: OBS_CODES.WORKFLOW_INSTANCE_CANCELLED.code }).count).toBe(0);
    });
    expect(events.query({ code: OBS_CODES.WORKFLOW_INSTANCE_CANCELLED.code }).count).toBe(1);
  });

  test('publishes authority invalidation once, only after its winning commit', async () => {
    const db = database();
    defineWorkflowTables(db);
    const events = new MemoryEventStore();
    const runtime = runtimeWithStore('workflow-authority-events', events);
    const observability = createWorkflowObservability(db, runtime);
    const service = new WorkflowService(db, waitingRegistry(), {
      wakeTimer: false,
      observability,
    });
    services.push(service);
    const instanceId = await service.start('observable-wait');
    const store = new WorkflowExecutionAuthorityStore(db);
    const gate = new WorkflowExecutionAuthorityGate(
      db,
      store,
      null,
      null,
      () => new Date(),
      observability,
    );
    db.prepare(`UPDATE _workflow_execution_authorities
      SET authority_mac = ? WHERE instance_id = ?`).run('0'.repeat(64), instanceId);
    events.clear();

    const rollback = new Error('roll back invalidation');
    expect(() => db.transaction(() => {
      expect(gate.validateInstance(instanceId)).toBe(false);
      expect(gate.validateInstance(instanceId)).toBe(false);
      expect(events.query({ code: OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED.code }).count)
        .toBe(0);
      throw rollback;
    })).toThrow(rollback);
    expect(service.get(instanceId)?.status).toBe('running');
    expect(events.query({ code: OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED.code }).count)
      .toBe(0);

    db.transaction(() => {
      expect(gate.validateInstance(instanceId)).toBe(false);
      expect(gate.validateInstance(instanceId)).toBe(false);
      expect(events.query({ code: OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED.code }).count)
        .toBe(0);
    });
    expect(service.get(instanceId)?.status).toBe('failed');
    expect(events.query({ code: OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED.code }).count)
      .toBe(1);
    expect(gate.validateInstance(instanceId)).toBe(false);
    expect(events.query({ code: OBS_CODES.WORKFLOWS_AUTHORITY_INVALIDATED.code }).count)
      .toBe(1);
  });
});

function database(): ReactiveDB {
  const db = createReactiveDB({ mode: 'memory' });
  databases.push(db);
  return db;
}

function runtimeWithStore(id: string, store: MemoryEventStore): ZeroAppRuntime {
  const runtime = new ZeroAppRuntime(id);
  runtime.set(ZERO_OBSERVABILITY_RUNTIME, {
    sink: store,
    store,
    config: { console: false, store },
  });
  return runtime;
}

function waitingRegistry(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registry.registerHandler('observable-handler', async () => null);
  registry.registerWorkflow({
    name: 'observable-wait',
    steps: [{
      name: 'Wait',
      handler: 'observable-handler',
      waitFor: 'continue',
    }],
  });
  return registry;
}

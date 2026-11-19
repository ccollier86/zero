/** Real Torrent/registry native pin proof, entirely in memory. No recovery, files, actors, providers or build output. */
import { expect, test } from 'bun:test';
import { applicationServiceDataScope, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { CALENDAR_OBSERVATION_ACTIVITY, CALENDAR_OBSERVATION_ACTIVITY_VERSION, CALENDAR_OBSERVATION_WORKFLOW,
  CALENDAR_OBSERVATION_WORKFLOW_VERSION, calendarObservationPinInput, registerCalendarObservationWorkflow } from '../calendar/integration-catalog';
import { createReactiveDB } from '../sync/reactive-db';
import { compileWorkflowDefinition } from './workflow-compiler';
import { workflowDeferredStarts } from './workflow-deferred-start-bridge';
import { flow, step } from './workflow-dsl';
import { WorkflowError } from './workflow-error';
import { WorkflowRegistry } from './workflow-registry';
import { defineWorkflowTables } from './workflow-schema';
import { getWorkflowGraphRuntime, WorkflowService } from './workflow-service';

const alpha = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'native-pin-alpha' });
const beta = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'native-pin-beta' });
async function fixture(multi = true) {
  const db = createReactiveDB({ mode: 'memory' }), registry = new WorkflowRegistry();
  let service: WorkflowService | undefined, now = Date.parse('2026-12-01T00:00:00.000Z'), lookups = 0, calls = 0;
  try {
    db.getRawDatabase().run('PRAGMA temp_store=MEMORY'); defineWorkflowTables(db);
    registerCalendarObservationWorkflow(registry, () => {
      lookups++; return { async execute(context) { calls++; return { intentId: context.input.intentId, state: 'observed' }; } };
    });
    // A newer activity default must not change the compiled native graph's explicit pin.
    registry.registerActivity({ name: CALENDAR_OBSERVATION_ACTIVITY, version: '2', default: true,
      handler() { calls++; throw new Error('The unpinned observation activity ran.'); } });
    registry.registerActivity({ name: 'native-pin.database-safe', version: '1', databaseCallable: true,
      async handler(context) { calls++; return context.input; } });
    const safe = flow(step('safe', { name: 'native-pin.database-safe', version: '1' }));
    registry.create({ name: 'native-pin.safe', version: 1, flow: safe });
    registry.create({ name: 'native-pin.validated', version: 1, flow: safe,
      inputSchema: { type: 'object', properties: { value: { type: 'integer' } }, required: ['value'], additionalProperties: false } });
    registry.create({ name: 'native-pin.implicit-version', flow: safe });
    registry.registerDatabaseWorkflow({ name: 'native-pin.database-registered', version: 1, flow: safe });
    registry.registerHandler('native-pin.legacy', async () => { calls++; });
    registry.create({ name: 'native-pin.legacy', steps: [{ name: 'legacy', handler: 'native-pin.legacy' }] });
    service = new WorkflowService(db, registry, { tenancyMode: multi ? 'multi' : 'single', wakeTimer: false, shutdownGraceMs: 0,
      clock: { now: () => new Date(now) }, runtimeOwnership: { now: () => now, heartbeat: false } });
    const graph = getWorkflowGraphRuntime(service), bridge = workflowDeferredStarts(service);
    return { db, registry, service, graph, bridge,
      authority(scope: ServiceDataScope = multi ? alpha : applicationServiceDataScope()) {
        const authority = bridge.system({ principal: 'jobs:source:src_' + '1'.repeat(64), reason: 'Native fixed catalog preparation', scope });
        if (authority.kind !== 'system') throw new Error('Synthetic native authority must be system-owned.');
        return authority;
      },
      advance(milliseconds: number) { now += milliseconds; }, stats: () => ({ lookups, calls }),
      async close() { try { await service!.dispose(); } finally { try { await service!.drainPhysical(); } finally { db.dispose(); } } },
    };
  } catch (error) {
    try { await service?.dispose(); } finally { try { await service?.drainPhysical(); } finally { db.dispose(); } }
    throw error;
  }
}
const fixedInput = calendarObservationPinInput();
const rejected = (operation: () => unknown, code: string) => expect(operation).toThrow(expect.objectContaining({ code }));

test('a fixed observation graph has an exact code-owned pin before recovery without executing or mutating anything', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), compiled = f.registry.getCompiledWorkflow(CALENDAR_OBSERVATION_WORKFLOW)!;
    const immutable = f.graph.versions.resolve({ name: compiled.name, version: CALENDAR_OBSERVATION_WORKFLOW_VERSION });
    const changes = f.db.prepare('SELECT total_changes() AS n').get();
    const pin = f.bridge.pinRegistered(authority, compiled.name, fixedInput, CALENDAR_OBSERVATION_WORKFLOW_VERSION);
    expect(pin).toEqual({ name: compiled.name, version: 1, definitionId: immutable.catalog.definition_id,
      versionId: immutable.version.version_id, fingerprint: compiled.fingerprint });
    expect(Object.isFrozen(pin)).toBe(true);
    expect(pin).toEqual(f.bridge.pin(authority, compiled.name, fixedInput, 1));
    expect(immutable.version).toMatchObject({ source: 'code', graph_json: compiled.graphJson, fingerprint: compiled.fingerprint });
    expect(compiled.graph.nodes).toMatchObject([{ activity: { name: CALENDAR_OBSERVATION_ACTIVITY, version: CALENDAR_OBSERVATION_ACTIVITY_VERSION } }]);
    expect(f.db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    expect(f.db.list('workflow_instances')).toHaveLength(0);
    expect(f.db.prepare('SELECT count(*) AS n FROM _workflow_system_start_receipts').get()).toEqual({ n: 0 });
    expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('a same-name tenant database graph is refused, while ordinary pin precedence and unrelated tenant fallback remain unchanged', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), original = f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1);
    const safe = f.registry.getCompiledWorkflow('native-pin.safe')!;
    const shadow = f.graph.versions.publish({ name: CALENDAR_OBSERVATION_WORKFLOW, version: 1, source: 'database',
      graph: safe.graph, graphFormat: safe.format, schemaVersion: safe.graph.schemaVersion, scope: { type: 'tenant', id: alpha.tenantId } });
    // Public/request selection intentionally still belongs to the tenant namespace.
    expect(f.bridge.pin(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1).versionId).toBe(shadow.version.version_id);
    rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1), 'WORKFLOW_NOT_FOUND');
    expect(f.bridge.pinRegistered(f.authority(beta), CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1)).toEqual(original);
    // A pin prepared before the shadow is also fenced at the actual start boundary.
    rejected(() => f.bridge.enqueue(authority, original, fixedInput, 'native-pin:shadow', 'native-pin:shadow', () => {}), 'WORKFLOW_VERSION_CONFLICT');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('even a structurally identical tenant graph with the same fingerprint is not fixed native code ownership', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), name = 'native-pin.safe', compiled = f.registry.getCompiledWorkflow(name)!;
    const native = f.bridge.pinRegistered(authority, name, {}, 1);
    const shadow = f.graph.versions.publish({ name, version: 1, source: 'database', graph: compiled.graph,
      graphFormat: compiled.format, schemaVersion: compiled.graph.schemaVersion, scope: { type: 'tenant', id: alpha.tenantId } });
    expect(shadow.version.fingerprint).toBe(native.fingerprint);
    expect(f.bridge.pin(authority, name, {}, 1).versionId).toBe(shadow.version.version_id);
    rejected(() => f.bridge.pinRegistered(authority, name, {}, 1), 'WORKFLOW_NOT_FOUND');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('persisted-only, database-registered, implicit-version and legacy definitions cannot be presented as fixed registered code', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), safe = f.registry.getCompiledWorkflow('native-pin.safe')!;
    f.graph.versions.publish({ name: 'native-pin.persisted-only', version: 1, source: 'code', graph: safe.graph,
      graphFormat: safe.format, schemaVersion: safe.graph.schemaVersion });
    for (const name of ['native-pin.missing', 'native-pin.persisted-only']) {
      rejected(() => f.bridge.pinRegistered(authority, name, {}, 1), 'WORKFLOW_VERSION_NOT_FOUND');
    }
    for (const name of ['native-pin.database-registered', 'native-pin.implicit-version', 'native-pin.legacy']) {
      rejected(() => f.bridge.pinRegistered(authority, name, {}, 1), 'WORKFLOW_VERSION_CONFLICT');
    }
    for (const version of [0, -1, 1.5, NaN]) rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, version), 'WORKFLOW_REQUEST_INVALID');
    rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 2), 'WORKFLOW_VERSION_CONFLICT');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('a newer persisted code version cannot substitute for the exact currently registered version', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), safe = f.registry.getCompiledWorkflow('native-pin.safe')!;
    const newer = f.graph.versions.publish({ name: CALENDAR_OBSERVATION_WORKFLOW, version: 2, source: 'code',
      graph: safe.graph, graphFormat: safe.format, schemaVersion: safe.graph.schemaVersion });
    expect(f.bridge.pin(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 2).versionId).toBe(newer.version.version_id);
    rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 2), 'WORKFLOW_VERSION_CONFLICT');
    expect(f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1).version).toBe(1);
    expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('an integrity-valid but substituted immutable record is not proof of the registered graph', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), compiled = f.registry.getCompiledWorkflow(CALENDAR_OBSERVATION_WORKFLOW)!;
    const current = f.graph.versions.resolve({ name: compiled.name, version: 1 });
    const replacement = compileWorkflowDefinition({ name: compiled.name, version: 1,
      graph: f.registry.getCompiledWorkflow('native-pin.safe')!.graph, access: compiled.access });
    // Deliberate memory-only corruption bypasses the normal immutable writer;
    // the replacement remains self-consistent, so the catalog proof must compare code.
    f.db.exec('DROP TRIGGER trg_workflow_version_content_immutable');
    f.db.prepare('UPDATE workflow_definition_versions SET graph_json=?,graph_format=?,fingerprint=? WHERE version_id=?')
      .run(replacement.graphJson, replacement.format, replacement.fingerprint, current.version.version_id);
    expect(f.bridge.pin(authority, compiled.name, fixedInput, 1).fingerprint).toBe(replacement.fingerprint);
    rejected(() => f.bridge.pinRegistered(authority, compiled.name, fixedInput, 1), 'WORKFLOW_VERSION_CONFLICT');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('fixed pin preparation preserves native input validation, current authority, final source guards and disposal', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), pin = f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1);
    expect(f.bridge.pinRegistered(authority, 'native-pin.validated', { value: 1 }, 1).version).toBe(1);
    rejected(() => f.bridge.pinRegistered(authority, 'native-pin.validated', { value: 'invalid' }, 1), 'WORKFLOW_INPUT_INVALID');
    rejected(() => f.bridge.pinRegistered({ ...authority, identity: { ...authority.identity, scopeId: 'tenant:wrong' } },
      CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1), 'WORKFLOW_STATE_INVALID');
    rejected(() => f.bridge.enqueue(authority, pin, fixedInput, 'native-pin:guard', 'native-pin:guard', () => {
      throw new WorkflowError('Native source retired', 'WORKFLOW_AUTHORITY_CHANGED', 409);
    }), 'WORKFLOW_AUTHORITY_CHANGED');
    rejected(() => f.bridge.enqueue(authority, pin, fixedInput, 'native-pin:async-guard', 'native-pin:async-guard', async () => {}), 'WORKFLOW_CONFIG_INVALID');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
    await f.service.dispose();
    rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1), 'WORKFLOW_NOT_READY');
  } finally { await f.close(); }
});

test('a fixed pin cannot outlive its durable Torrent owner generation', async () => {
  const f = await fixture(false);
  try {
    const authority = f.authority(); f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1);
    f.advance(30_001);
    rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1), 'WORKFLOW_RUNTIME_LEASE_LOST');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

test('a retired immutable code version is unavailable for new fixed native preparation', async () => {
  const f = await fixture();
  try {
    const authority = f.authority(), pin = f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1);
    f.graph.versions.retire(pin.definitionId, pin.versionId);
    rejected(() => f.bridge.pinRegistered(authority, CALENDAR_OBSERVATION_WORKFLOW, fixedInput, 1), 'WORKFLOW_VERSION_NOT_FOUND');
    expect(f.db.list('workflow_instances')).toHaveLength(0); expect(f.stats()).toEqual({ lookups: 0, calls: 0 });
  } finally { await f.close(); }
});

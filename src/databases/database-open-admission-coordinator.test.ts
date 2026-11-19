/** Parent/protocol logic only: simulated executors, no filesystem or subprocess fixtures. */
import { expect, test } from 'bun:test';
import type { DatabaseActorBindPayload, DatabaseActorBindResult, DatabaseActorRole } from './database-actor-protocol';
import { normalizeDatabaseCoordinatorConfig } from './database-coordinator-config';
import type { DatabaseCoordinatorOptions } from './database-coordinator-contract';
import type { DatabaseCoordinatorEntry } from './database-coordinator-entry';
import { DatabaseCoordinatorEntryFactory } from './database-coordinator-entry-factory';
import { DatabaseCoordinatorEntryLifecycle } from './database-coordinator-entry-lifecycle';
import { DatabaseCoordinatorExecutorBinding } from './database-coordinator-executor-binding';
import { DatabaseCoordinatorSyncPublication } from './database-coordinator-sync-publication';
import type { DatabaseExecutor, DatabaseExecutorRequest } from './database-executor';
import { createDatabaseRef, normalizeDatabaseId } from './database-file';
import { databaseOpenAdmissionFingerprint, type DatabaseOpenAdmission, type DatabaseOpenAdmissionResolver } from './database-open-admission';
import { DATABASE_FILE_PLACEMENT_POLICY } from './database-placement';
import { defineDatabaseRealm } from './database-realm';
import { normalizeDatabaseCoordinatorRestartPolicy } from './database-restart-policy';
import { DatabaseWriterLane } from './database-writer-lane';

const realm = defineDatabaseRealm({ name: 'open-admission-parent-memory', version: '1',
  tables: { owners: { id: 'text primary key', owner_id: 'text not null' } } });
const id = normalizeDatabaseId('synthetic-owner');
const databaseRef = createDatabaseRef(id);
const instanceId = '00000000-0000-4000-8000-000000000001';
const fileIdentity = Object.freeze({ device: '12', inode: '34' });
const admission: DatabaseOpenAdmission = { schema: 'current', row: {
  table: 'owners', id: 'application', equals: { owner_id: 'synthetic-owner' },
} };

test('coordinator config keeps optional native resolver lazy and rejects async/generator/nonfunctions', () => {
  let calls = 0;
  const base: DatabaseCoordinatorOptions = { rootDirectory: '/not-opened-memory-test', realm,
    createExecutor() { throw new Error('not invoked'); } };
  expect(Object.hasOwn(normalizeDatabaseCoordinatorConfig(base), 'openAdmission')).toBe(false);
  const resolver = () => { calls++; return admission; };
  expect(normalizeDatabaseCoordinatorConfig({ ...base, openAdmission: resolver }).openAdmission).toBe(resolver);
  expect(calls).toBe(0);
  for (const invalid of [async () => admission, function* () { yield admission; }, {}, true]) {
    expect(() => normalizeDatabaseCoordinatorConfig({ ...base, openAdmission: invalid as never }))
      .toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  }
});

test('entry factory rejects invalid callback output before inspecting or creating any physical path', () => {
  let inspected = 0;
  const factory = new DatabaseCoordinatorEntryFactory({
    rootDirectory() { inspected++; throw new Error('physical inspection is forbidden in this test'); },
    realmName: realm.name, realm, openAdmission: () => ({ schema: 'current', row: { table: 'undeclared', id: 'x', equals: { owner_id: 'x' } } }),
    placementPolicy: DATABASE_FILE_PLACEMENT_POLICY, maxDatabaseFiles: 1, maxQueuedPerDatabase: 8, maxQueuedTotal: 8,
    now: Date.now, observability: null, assertOwnedRootCurrent() { inspected++; }, queuedOperations: () => 0,
    incrementQueuedOperations() {}, decrementQueuedOperations() {}, async openEntry() {}, emit() {},
  });
  expect(() => factory.create(id, 0)).toThrow(expect.objectContaining({ code: 'DATABASE_CONFIG_INVALID' }));
  expect(inspected).toBe(0);
});

test('parent binding proof requires the exact optional admission, including reader generations', () => {
  const entry = { databaseRef, fileIdentity, bindingIdentity: { instanceId }, placement: { mode: 'file' }, openAdmission: admission } as DatabaseCoordinatorEntry;
  const boundary = new DatabaseCoordinatorExecutorBinding({ realm, createExecutor() { throw new Error('not invoked'); },
    hotDurabilitySupervisor: null as never, entries: new Map(), state: () => 'started', async retire() {}, emit() {} });
  for (const role of ['writer', 'reader'] as const) {
    const result: DatabaseActorBindResult = { databaseRef, fileIdentity, instanceId, role,
      placement: { mode: 'file' }, realmFingerprint: realm.fingerprint, schemaChecksum: realm.schemaChecksum,
      sequence: { seq: 0 }, syncEpoch: role === 'writer' ? 'synthetic-epoch' : null };
    expect(() => boundary.assertBindResult(entry, role, result)).toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
    expect(() => boundary.assertBindResult(entry, role, { ...result, openAdmissionFingerprint: '0'.repeat(64) }))
      .toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
    expect(() => boundary.assertBindResult(entry, role, { ...result,
      openAdmissionFingerprint: databaseOpenAdmissionFingerprint(admission) })).not.toThrow();
    const ordinary = { ...entry, openAdmission: undefined };
    expect(() => boundary.assertBindResult(ordinary, role, result)).not.toThrow();
    expect(() => boundary.assertBindResult(ordinary, role, { ...result,
      openAdmissionFingerprint: databaseOpenAdmissionFingerprint(admission) }))
      .toThrow(expect.objectContaining({ code: 'DATABASE_SCHEMA_MISMATCH' }));
  }
});

function harness(options: { resolver?: DatabaseOpenAdmissionResolver; readers?: boolean;
  onStart?: (role: DatabaseActorRole) => void; omitProof?: boolean } = {}) {
  const entries = new Map<typeof id, DatabaseCoordinatorEntry>();
  const executors: DatabaseExecutor[] = [];
  const binds: { role: DatabaseActorRole; payload: DatabaseActorBindPayload }[] = [];
  const generations = { writer: 0, reader: 0 };
  const lane = () => new DatabaseWriterLane({ databaseRef, placement: 'file', maxQueued: 8, now: Date.now,
    onQueued: () => true, onDequeued() {}, observability: null });
  const entry: DatabaseCoordinatorEntry = { id, databaseRef, filePath: '/not-opened-memory-test/db.sqlite', fileIdentity,
    bindingIdentity: { databaseRef, instanceId, realmName: realm.name }, placement: { mode: 'file' }, slot: 0,
    lane: lane(), readerLane: lane(), state: 'opening', writer: null, reader: null, opening: Promise.resolve(),
    recovery: null, settlement: null, closeTask: null, failure: null, closeFailure: null, restartRetryCount: 0,
    restartAbortController: null, leases: 0, activeOperations: 0, recoveryWaiters: 0, lastUsedAt: 0,
    syncIdentity: null, tenantSyncBindingSlots: 0, syncBindings: new Set(),
  };
  entries.set(id, entry);
  const syncPublication = new DatabaseCoordinatorSyncPublication({ authorityCommitCoordinator: null,
    requireCommitAuthority: false, assertStarted() {}, currentEntry: value => entries.get(value), emit() {} });
  const lifecycle = new DatabaseCoordinatorEntryLifecycle({ realm, sqlite: {}, readersEnabled: options.readers === true,
    operationTimeoutMs: 1000, restartPolicy: normalizeDatabaseCoordinatorRestartPolicy(undefined),
    observability: null, now: Date.now, entries, quarantinedSlots: new Set(), state: () => 'started',
    actorLiveness: () => ({ filePath: '/not-opened-memory-test/liveness.sqlite', fileIdentity,
      generation: '00000000-0000-4000-8000-000000000002' }),
    authorityCommitFence: null, assertOwnedRootCurrent() {}, releaseSlot() {}, rememberBlockedDatabase() {},
    syncPublication, emit() {}, ...(options.resolver ? { openAdmission: options.resolver } : {}),
    createExecutor({ role, slot }) {
      const generation = ++generations[role];
      let closed = false;
      let started = false;
      let settle!: () => void;
      const settlement = new Promise<void>(resolve => { settle = resolve; });
      const executor = {
        async start() { options.onStart?.(role); started = true; },
        async execute(request: DatabaseExecutorRequest) {
          const payload = request.payload as unknown as DatabaseActorBindPayload;
          binds.push({ role, payload });
          return { databaseRef: payload.databaseRef, role, fileIdentity: payload.fileIdentity,
            instanceId: payload.instanceId, placement: payload.placement,
            realmFingerprint: realm.fingerprint, schemaChecksum: realm.schemaChecksum,
            sequence: { seq: 0 }, syncEpoch: role === 'writer' ? 'synthetic-epoch' : null,
            ...(!options.omitProof && payload.openAdmission ? {
              openAdmissionFingerprint: databaseOpenAdmissionFingerprint(payload.openAdmission),
            } : {}),
          };
        },
        settled: () => settlement,
        async close() { closed = true; settle(); },
        diagnostics: () => ({ state: closed ? 'closed' : started ? 'ready' : 'created', slot, generation,
          inFlight: 0, maxInFlight: 1, disconnectObserved: closed, exitObserved: closed, settled: closed,
          exitCode: closed ? 0 : null, signalCode: null, lastFailureCode: null }),
      } as unknown as DatabaseExecutor;
      executors.push(executor);
      return executor;
    },
  });
  return { entry, lifecycle, binds, executors, async cleanup() {
    // No physical actors exist, but every owned simulated generation must settle.
    if (entry.state !== 'closed') entry.state = 'closing';
    for (const executor of executors) await executor.close();
    await lifecycle.closeEntry(entry, 'requested');
    expect(executors.every(executor => executor.diagnostics().settled)).toBe(true);
  } };
}

test('default parent binds remain unchanged and carry no admission or proof requirement', async () => {
  const h = harness({ readers: true });
  try {
    await h.lifecycle.openEntry(h.entry);
    expect(h.entry.state).toBe('ready');
    expect(h.binds.map(bind => Object.hasOwn(bind.payload, 'openAdmission'))).toEqual([false, false]);
  } finally { await h.cleanup(); }
});

test('writer and reader dispatch refresh the native policy after asynchronous startup', async () => {
  let selected: DatabaseOpenAdmission = { schema: 'prepare', row: { ...admission.row!, allowMissing: true } };
  const h = harness({ readers: true, resolver: () => selected, onStart(role) {
    if (role === 'writer') selected = { schema: 'prepare', row: admission.row };
    else selected = admission;
  } });
  try {
    await h.lifecycle.openEntry(h.entry);
    expect(h.binds.map(bind => bind.payload.openAdmission)).toEqual([
      { schema: 'prepare', row: admission.row }, admission,
    ]);
    expect(h.entry.openAdmission).toEqual(admission);
  } finally { await h.cleanup(); }
});

test('owner retargeting during startup rejects before any actor bind request', async () => {
  let selected = admission;
  const h = harness({ resolver: () => selected, onStart() {
    selected = { ...admission, row: { ...admission.row!, equals: { owner_id: 'substituted' } } };
  } });
  try {
    await expect(h.lifecycle.openEntry(h.entry)).rejects.toMatchObject({ code: 'DATABASE_SCHEMA_MISMATCH', outcome: 'not-started' });
    expect(h.binds.length).toBe(0);
  } finally { await h.cleanup(); }
});

test('replacement generations retain row identity and reject missing child proof', async () => {
  let selected: DatabaseOpenAdmission = { schema: 'prepare', row: { ...admission.row!, allowMissing: true } };
  const h = harness({ resolver: () => selected });
  try {
    await h.lifecycle.openEntry(h.entry);
    h.entry.state = 'opening';
    for (const executor of h.executors) await executor.close();
    selected = admission;
    await h.lifecycle.openEntry(h.entry, 1);
    expect(h.binds.map(bind => bind.payload.openAdmission?.schema)).toEqual(['prepare', 'current']);
    h.entry.state = 'opening';
    for (const executor of h.executors) await executor.close();
    selected = { ...admission, row: { ...admission.row!, id: 'other' } };
    await expect(h.lifecycle.openEntry(h.entry, 2)).rejects.toMatchObject({ code: 'DATABASE_SCHEMA_MISMATCH' });
    expect(h.binds.length).toBe(2);
  } finally { await h.cleanup(); }
  const missing = harness({ resolver: () => admission, omitProof: true });
  try {
    await expect(missing.lifecycle.openEntry(missing.entry)).rejects.toMatchObject({ code: 'DATABASE_SCHEMA_MISMATCH' });
  } finally { await missing.cleanup(); }
});

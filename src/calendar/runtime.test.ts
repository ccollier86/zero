/** Native memory SYSTEM/realm plus a deliberately mocked physical coordinator.
 * These tests qualify broker logic/lifetimes, NOT actual files, actors or package deployment.
 * No fixture directories, child processes, timers or generated dependencies are created.
 */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import type { DatabaseCoordinator, DatabaseExecutionOptions } from '../databases/database-coordinator';
import { DatabaseError } from '../databases/database-error';
import { canonicalDatabaseRootIdentity } from '../databases/database-file';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../databases/database-read-query-capability';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../databases/database-realm';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveCalendarConfig, type ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarCommandReceipt, CalendarLifecyclePolicy } from './contracts';
import { CalendarError } from './error';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';
import { resolveCalendarPersistenceConfig } from './persistence-config';
import { calendarRealm } from './realm';
import { grantId } from './realm-model';
import { assertCalendarOwnerRecord, calendarDatabaseId, CalendarRuntime, emptyCalendarRead, type CalendarRuntimeOptions } from './runtime';
import { calendarHash } from './validation';

const project = '/synthetic-zero-calendar-runtime-never-created';
const scope = applicationServiceDataScope();
const actor: CalendarActor = { scopeId: 'application', userId: 'owner', principal: 'session:owner', manageAll: true, createOwn: true };
const config = resolveCalendarConfig({ timezone: 'UTC' }, project, resolveAuthBehaviorConfig()) as ResolvedCalendarConfig;
const range = { startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
const resource = { actor, requestId: 'create-resource', id: 'resource', label: 'Synthetic', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' };
const noop = () => {};

function fixture() {
  const system = createReactiveDB({ mode: 'memory' }), realm = createReactiveDB({ mode: 'memory' });
  let acquisitions = 0, releases = 0, closes = 0;
  let simulatedFilePresent = false;
  let beforeAcquire: (() => Promise<void>) | null = null, afterCommand: (() => void | Promise<void>) | null = null;
  let beforeExecute: ((operation: any, execution: DatabaseExecutionOptions) => Promise<void>) | null = null;
  let beforeClose: (() => Promise<void>) | null = null;
  const transport = new Map<string, { fingerprint: string; result: unknown }>();
  try {
    system.getRawDatabase().run('PRAGMA temp_store=MEMORY'); realm.getRawDatabase().run('PRAGMA temp_store=MEMORY');
    installCalendarOwnerSchema(system, true);
    for (const [name, schema] of Object.entries(calendarRealm.tables)) realm.defineTable(name, schema);
    for (const migration of calendarRealm.migrations) migration.up(realm.getRawDatabase());
    const execute = async (operation: any, execution: DatabaseExecutionOptions = {}) => {
      await beforeExecute?.(operation, execution);
      if (operation.type === 'get') return { value: realm.get(operation.table, operation.id), sequence: { seq: realm.currentSeq } };
      if (operation.type === 'query') {
        const copy = Database.deserialize(realm.getRawDatabase().serialize(), { readonly: true, strict: true });
        try {
          copy.run('PRAGMA temp_store=MEMORY');
          const value = withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context, operation.name, operation.input));
          return { value, sequence: { seq: realm.currentSeq } };
        } finally { copy.close(); }
      }
      const fingerprint = calendarHash([operation.name, operation.input]), prior = transport.get(operation.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new DatabaseError('DATABASE_CONFLICT', 'Synthetic transport identity conflict.', { outcome: 'not-committed', details: { conflictType: 'idempotency-key-reused' } });
        return { ...(prior.result as object), replayed: true };
      }
      const output = runDatabaseRealmCommand(calendarRealm, realm, operation.name, operation.input);
      const result = { value: { kind: 'command', name: operation.name, output }, sequence: { seq: realm.currentSeq }, replayed: false, idempotencyKey: operation.idempotencyKey };
      transport.set(operation.idempotencyKey, { fingerprint, result });
      await afterCommand?.(); return result;
    };
    const acquire = async () => {
      acquisitions++; if (beforeAcquire) await beforeAcquire();
      simulatedFilePresent = true;
      return { execute, release() { releases++; } };
    };
    const owner = { acquire, acquireExisting: acquire, diagnostics: () => ({ synthetic: true }), close: async () => { closes++; await beforeClose?.(); } };
    const options: CalendarRuntimeOptions = { config, persistence: resolveCalendarPersistenceConfig(config, project), system, installAllowed: true,
      authority: { coordinator: new AuthorityCommitCoordinator(), actorContext: null } };
    // Private constructor seam only; open() is intentionally not called because
    // its real root lock/liveness lifecycle requires disk qualification.
    const Constructor = CalendarRuntime as unknown as new (options: CalendarRuntimeOptions, owner: DatabaseCoordinator) => CalendarRuntime;
    const runtime = new Constructor(options, owner as unknown as DatabaseCoordinator);
    // The physical coordinator and its path probe are both explicitly mocked.
    // No mock result is claimed as proof of native file/inode safety.
    (runtime as unknown as { filePresent(id: string): boolean }).filePresent = () => simulatedFilePresent;
    return { runtime, system, realm, stats: () => ({ acquisitions, releases, closes }),
      beforeAcquire(callback: (() => Promise<void>) | null) { beforeAcquire = callback; },
      afterCommand(callback: (() => void | Promise<void>) | null) { afterCommand = callback; },
      beforeExecute(callback: typeof beforeExecute) { beforeExecute = callback; },
      beforeClose(callback: typeof beforeClose) { beforeClose = callback; },
      missingFile() { simulatedFilePresent = false; },
      // Physical file existence is not simulated as qualification. Pending is
      // deliberately retained when exercising in-memory recovery/replay logic.
      pending() { system.prepare('UPDATE _calendar_owners SET established=0').run(); },
      async close() { try { await runtime.close(); } finally { realm.dispose(); system.dispose(); } },
    };
  } catch (error) { realm.dispose(); system.dispose(); throw error; }
}

test('scope keys are opaque and retained ownership pins scope, root, generation and schema', () => {
  const rootHash = 'synthetic-root', fingerprint = calendarRealm.fingerprint;
  const record: CalendarOwnerRecord = { id: calendarDatabaseId('application'), scope_id: 'application', owner_id: 'cal_00000000-0000-4000-8000-000000000001', root_hash: rootHash, realm_fingerprint: fingerprint, established: 1 };
  expect(record.id).toMatch(/^calendar:[a-f0-9]{64}$/); expect(calendarDatabaseId('tenant:private-tenant')).not.toContain('private-tenant');
  assertCalendarOwnerRecord(record, rootHash, fingerprint, false);
  for (const changed of [{ id: 'calendar:other' }, { scope_id: 'tenant:other' }, { owner_id: 'owner' }, { root_hash: 'other' }, { established: 2 }, { realm_fingerprint: 'invalid' }]) {
    expect(() => assertCalendarOwnerRecord({ ...record, ...changed } as CalendarOwnerRecord, rootHash, fingerprint, true)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
  }
  expect(() => assertCalendarOwnerRecord({ ...record, realm_fingerprint: 'sha256:' + '0'.repeat(64) }, rootHash, fingerprint, false)).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
});

test('native empty-scope broker reads allocate no owner, lease, file or fake resource', async () => {
  const f = fixture();
  try {
    expect(await f.runtime.read<{ items: unknown[]; truncated: boolean; nextAfter: null }>(scope, 'calendar.resources', { actor }, noop)).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(await f.runtime.read<{ items: unknown[]; truncated: boolean; nextAfter: null }>(scope, 'calendar.locations', { actor }, noop)).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(await f.runtime.read<{ items: unknown[]; truncated: boolean; nextAfter: null }>(scope, 'calendar.types', { actor }, noop)).toEqual({ items: [], truncated: false, nextAfter: null });
    expect(await f.runtime.read<{ items: unknown[]; truncated: boolean; nextAfter: null }>(scope, 'calendar.types', { actor, resourceIds: [] }, noop)).toEqual({ items: [], truncated: false, nextAfter: null });
    await expect(f.runtime.read(scope, 'calendar.types', { actor, resourceIds: ['missing'] }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.read(scope, 'calendar.type', { actor: { ...actor, manageAll: false }, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(await f.runtime.read<{ items: unknown[]; truncated: boolean; nextAfter: null }>(scope, 'calendar.resources', { actor, locationIds: ['missing'], regions: ['US-IN'] }, noop)).toEqual({ items: [], truncated: false, nextAfter: null });
    for (const name of ['calendar.busy', 'calendar.appointments', 'calendar.blocks']) expect(await f.runtime.read<{ items: unknown[]; truncated: boolean }>(scope, name, { actor, resourceIds: [], ...range }, noop)).toEqual({ items: [], truncated: false });
    expect(await f.runtime.read(scope, 'calendar.receipt', { actor, requestId: 'missing' }, noop)).toBeNull();
    for (const name of ['calendar.appointment', 'calendar.block', 'calendar.availability', 'calendar.location', 'calendar.resourceLocations', 'calendar.type', 'calendar.resourceTypes']) {
      await expect(f.runtime.read(scope, name, { actor, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    }
    await expect(f.runtime.read(scope, 'calendar.busy', { actor, resourceIds: ['missing'], ...range }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.system.prepare('SELECT count(*) AS count FROM _calendar_owners').get()).toEqual({ count: 0 });
    expect(f.stats().acquisitions).toBe(0);
  } finally { await f.close(); }
});

test('empty projections reject malformed inputs, forged physical scope and async guards', async () => {
  const f = fixture();
  try {
    for (const input of [{ actor, resourceIds: [], ...range, limit: 0 }, { actor, resourceIds: [], startAt: range.endAt, endAt: range.startAt }, { actor, resourceIds: ['same', 'same'], ...range }, { actor, resourceIds: [], ...range, title: 'private' }]) {
      expect(() => emptyCalendarRead('calendar.busy', input)).toThrow(CalendarError);
    }
    for (const filters of [{ locationIds: ['duplicate', 'duplicate'] }, { regions: ['US IN'] }, { regions: [null] }, { locationIds: Array.from({ length: 17 }, (_, i) => 'location-' + i) }]) {
      expect(() => emptyCalendarRead('calendar.resources', { actor, ...filters })).toThrow(CalendarError);
    }
    for (const query of [{ resourceIds: ['duplicate', 'duplicate'] }, { resourceIds: [], limit: 0 }, { resourceIds: [], actorId: 'forged' }]) {
      expect(() => emptyCalendarRead('calendar.types', { actor, ...query })).toThrow(CalendarError);
    }
    await expect(f.runtime.read(trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other' }), 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, async () => {})).rejects.toMatchObject({ code: 'CALENDAR_CONFIG_INVALID' });
    expect(f.stats().acquisitions).toBe(0);
  } finally { await f.close(); }
});

test('lifecycle broker reads stay file-free until an admitted manager policy write and route through the canonical transition domain', async () => {
  const f = fixture();
  try {
    const policy = { actor, requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'required', noShowReason: 'optional' };
    expect(await f.runtime.read<CalendarLifecyclePolicy>(scope, 'calendar.lifecycle', { actor }, noop)).toEqual({ revision: 1, extended: false, cancellationReason: 'optional', noShowReason: 'optional' });
    await expect(f.runtime.read(scope, 'calendar.lifecycle', { actor: { ...actor, manageAll: false } }, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.runtime.read(scope, 'calendar.lifecycle', { actor, revision: 1 }, noop)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(f.runtime.read(scope, 'calendar.appointmentTransitions', { actor, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.lifecycle.replace', { ...policy, actor: { ...actor, manageAll: false } }, policy.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.runtime.write(scope, 'calendar.lifecycle.replace', { ...policy, expectedRevision: 2 }, policy.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect(f.stats().acquisitions).toBe(0); expect(f.system.prepare('SELECT count(*) AS count FROM _calendar_owners').get()).toEqual({ count: 0 });
    expect(await f.runtime.write(scope, 'calendar.lifecycle.replace', policy, policy.requestId, noop)).toMatchObject({ id: 'policy', revision: 2, changed: true });
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const appointment = { actor, requestId: 'visit', id: 'visit', resourceIds: ['resource'], title: 'PRIVATE_TITLE', startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC' };
    await f.runtime.write(scope, 'calendar.appointment.create', appointment, appointment.requestId, noop);
    expect(await f.runtime.read(scope, 'calendar.appointmentTransitions', { actor, id: 'visit' }, noop)).toMatchObject({ id: 'visit', revision: 1, policyRevision: 2, status: 'confirmed' });
    const transition = { actor, requestId: 'finish', id: 'visit', expectedRevision: 1, status: 'completed', policyRevision: 2 };
    expect(await f.runtime.write(scope, 'calendar.appointment.transition', transition, transition.requestId, noop)).toMatchObject({ operation: 'appointment.transitioned', revision: 2 });
    expect(await f.runtime.read(scope, 'calendar.appointmentTransitions', { actor, id: 'visit' }, noop)).toMatchObject({ status: 'completed', allowed: [] });
    expect(f.stats().acquisitions).toBe(f.stats().releases);
  } finally { await f.close(); }
});

test('only a fully admitted own/manager resource creation may provision a never-owned scope', async () => {
  const f = fixture();
  try {
    for (const input of [{ ...resource, actor: { ...actor, manageAll: false, createOwn: false } }, { ...resource, actor: { ...actor, manageAll: false }, ownerId: 'other' }]) {
      await expect(f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    }
    await expect(f.runtime.write(scope, 'calendar.appointment.create', { actor, requestId: 'missing', resourceIds: ['missing'] }, 'missing', noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.resource.create', { ...resource, timeZone: 'invalid' }, resource.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    const type = { actor, requestId: 'type', id: 'type', label: 'Synthetic type', durationMinutes: 30 };
    await expect(f.runtime.write(scope, 'calendar.type.create', { ...type, actor: { ...actor, manageAll: false } }, type.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.runtime.write(scope, 'calendar.type.create', { ...type, durationMinutes: 0 }, type.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    expect(f.stats().acquisitions).toBe(0);
    expect(f.system.prepare('SELECT count(*) AS count FROM _calendar_owners').get()).toEqual({ count: 0 });
  } finally { await f.close(); }
});

test('memory broker binds immutable owner, commits canonical command and reauthorizes its safe receipt', async () => {
  const f = fixture();
  try {
    const result = await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    expect(result).toEqual({ requestId: resource.requestId, operation: 'resource.created', id: resource.id, revision: 1, changed: true });
    const owner = f.system.prepare('SELECT * FROM _calendar_owners').get() as CalendarOwnerRecord;
    expect(owner).toMatchObject({ id: calendarDatabaseId(actor.scopeId), scope_id: actor.scopeId, established: 1 });
    expect(f.realm.get('_calendar_owner', 'application')).toMatchObject({ owner_id: owner.owner_id, scope_id: owner.scope_id });
    expect(f.stats().acquisitions).toBe(f.stats().releases);
    // The broker must block a reported missing established file, not return empty.
    f.missingFile();
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
  } finally { await f.close(); }
});

test('interrupted pending ownership is not empty and only an admitted creator may resume missing-file provisioning', async () => {
  const f = fixture(), ownerId = 'cal_00000000-0000-4000-8000-000000000001';
  try {
    f.system.prepare('INSERT INTO _calendar_owners VALUES(?,?,?,?,?,0)').run(calendarDatabaseId(actor.scopeId), actor.scopeId,
      ownerId, calendarHash(canonicalDatabaseRootIdentity(config.rootDirectory)), calendarRealm.fingerprint);
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await expect(f.runtime.write(scope, 'calendar.appointment.create', { actor, requestId: 'missing', resourceIds: ['missing'] }, 'missing', noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.resource.create', { ...resource, actor: { ...actor, manageAll: false, createOwn: false } }, resource.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.stats().acquisitions).toBe(0);
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    expect(f.system.prepare('SELECT owner_id,established FROM _calendar_owners').get()).toEqual({ owner_id: ownerId, established: 1 });
    expect(f.realm.get('_calendar_owner', 'application')!.owner_id).toBe(ownerId);
  } finally { await f.close(); }
});

test('transport replay is stable, intent reuse conflicts and changed authority cannot return a stale receipt', async () => {
  const f = fixture();
  try {
    const first = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    f.pending(); const seq = f.realm.currentSeq;
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.create', resource, resource.requestId, noop)).toEqual(first);
    expect(f.realm.currentSeq).toBe(seq);
    f.pending();
    await expect(f.runtime.write(scope, 'calendar.resource.create', { ...resource, label: 'another' }, resource.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT', outcome: 'not-committed' });
    // A changed policy projection uses a different transport receipt, then the
    // canonical command rechecks the original domain identity/rights.
    f.pending();
    const narrowed = { ...resource, actor: { ...actor, manageAll: false, createOwn: false } };
    await expect(f.runtime.write(scope, 'calendar.resource.create', narrowed, resource.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-committed' });
  } finally { await f.close(); }
});

test('native exact transport replay rechecks live object grants before receipt delivery', async () => {
  const f = fixture();
  try {
    await f.runtime.write(scope, 'calendar.resource.create', { ...resource, ownerId: 'other' }, resource.requestId, noop);
    const delegated = { ...actor, manageAll: false }, id = grantId(actor.scopeId, resource.id, actor.userId);
    f.realm.transaction(() => f.realm.createStrict('_calendar_grants', { id, scope_id: actor.scopeId, resource_id: resource.id, user_id: actor.userId, busy: 0, details: 0, book: 1, manage: 0 }));
    const appointment = { actor: delegated, requestId: 'delegated-booking', id: 'appointment', resourceIds: [resource.id], title: 'Synthetic',
      startAt: '2026-11-16T10:00:00.000Z', endAt: '2026-11-16T11:00:00.000Z', timeZone: 'UTC' };
    f.pending(); await f.runtime.write(scope, 'calendar.appointment.create', appointment, appointment.requestId, noop);
    f.realm.transaction(() => f.realm.update('_calendar_grants', id, { book: 0 }));
    const seq = f.realm.currentSeq; f.pending();
    await expect(f.runtime.write(scope, 'calendar.appointment.create', appointment, appointment.requestId, noop)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(f.realm.currentSeq).toBe(seq);
    expect(f.realm.get('calendar_appointments', appointment.id)).not.toBeNull();
  } finally { await f.close(); }
});

test('after-await authority loss after an accepted command is unknown, not a fictional rollback', async () => {
  const f = fixture(); let current = true;
  try {
    f.afterCommand(() => { if (f.realm.get('calendar_resources', resource.id)) current = false; });
    await expect(f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, () => { if (!current) throw new CalendarError('CALENDAR_FORBIDDEN'); })).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(f.realm.get('calendar_resources', resource.id)).not.toBeNull();
    expect(f.stats().acquisitions).toBe(f.stats().releases);
  } finally { await f.close(); }
});

test('close rejects new admission, drains owned waits and releases acquired leases before native close', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), acquired = new Promise<void>(resolve => { entered = resolve; });
  try {
    f.beforeAcquire(async () => { entered(); await waiting; });
    const pending = f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    await acquired;
    const closed = f.runtime.close(); expect(f.stats().closes).toBe(0);
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    release(); await expect(pending).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' }); await closed;
    expect(f.stats()).toEqual({ acquisitions: 1, releases: 1, closes: 1 });
    expect(f.runtime.close()).toBe(closed);
    expect(f.realm.get('calendar_resources', resource.id)).toBeNull();
  } finally { release(); await f.close(); }
});

test('direct runtime close aborts queued operation admission before native owner shutdown', async () => {
  const f = fixture(); let entered!: (signal: AbortSignal) => void;
  const queued = new Promise<AbortSignal>(resolve => { entered = resolve; });
  try {
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    f.beforeExecute((_operation, execution) => new Promise<never>((_resolve, reject) => {
      const signal = execution.signal!;
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      entered(signal);
    }));
    const pending = f.runtime.read(scope, 'calendar.resources', { actor }, noop);
    const result = pending.then(() => { throw new Error('Expected queued read retirement.'); }, error => error);
    const signal = await queued;
    const closing = f.runtime.close();
    expect(signal.aborted).toBe(true);
    await closing;
    expect(await result).toMatchObject({ code: 'CALENDAR_NOT_READY' });
    expect(f.stats().acquisitions).toBe(f.stats().releases);
    expect(f.stats().closes).toBe(1);
  } finally { f.beforeExecute(null); await f.close(); }
});

test('close retains in-flight occupancy until physical settlement and conceals an accepted late receipt', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), committed = new Promise<void>(resolve => { entered = resolve; });
  try {
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    f.afterCommand(async () => { entered(); await waiting; });
    const next = { ...resource, id: 'next-resource', requestId: 'next-resource' };
    const pending = f.runtime.write(scope, 'calendar.resource.create', next, next.requestId, noop);
    const result = pending.then(() => { throw new Error('Expected uncertain late receipt.'); }, error => error);
    await committed;
    let settled = false;
    const closing = f.runtime.close(); void closing.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(f.runtime.diagnostics()).toMatchObject({ state: 'closing', activeOperations: 1 });
    expect(f.stats().closes).toBe(0);
    expect(f.stats().acquisitions - f.stats().releases).toBe(1);
    release();
    expect(await result).toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    await closing;
    expect(f.realm.get('calendar_resources', next.id)).not.toBeNull();
    expect(f.runtime.diagnostics()).toMatchObject({ state: 'closed', activeOperations: 0 });
    expect(f.stats().acquisitions).toBe(f.stats().releases);
  } finally { release(); await f.close(); }
});

test('an unconfirmed native close stays failed and can retry cleanup without reopening intake', async () => {
  const f = fixture(), failure = new Error('Synthetic unconfirmed actor settlement');
  try {
    f.beforeClose(async () => { throw failure; });
    const closing = f.runtime.close();
    expect(f.runtime.close()).toBe(closing);
    await expect(closing).rejects.toMatchObject({ errors: [failure] });
    expect(f.runtime.diagnostics().state).toBe('close-failed');
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    f.beforeClose(null);
    await f.runtime.close();
    expect(f.runtime.diagnostics().state).toBe('closed');
    expect(f.stats().closes).toBe(2);
  } finally { f.beforeClose(null); await f.close(); }
});

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
import { registerReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import { resolveCalendarConfig, type ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarCommandReceipt, CalendarLifecyclePolicy, CalendarParticipantReference } from './contracts';
import { CalendarError } from './error';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';
import { resolveCalendarPersistenceConfig } from './persistence-config';
import { calendarRealm } from './realm';
import { grantId } from './realm-model';
import { assertCalendarOwnerRecord, calendarDatabaseId, CalendarRuntime, emptyCalendarRead, type CalendarRuntimeOptions } from './runtime';
import { calendarHash } from './validation';
import { CalendarIntegrationWakeCatalog, installCalendarIntegrationWakeCatalog } from './integration-wake-catalog';

const project = '/synthetic-zero-calendar-runtime-never-created';
const scope = applicationServiceDataScope();
const actor: CalendarActor = { scopeId: 'application', userId: 'owner', principal: 'session:owner', manageAll: true, createOwn: true };
const config = resolveCalendarConfig({ timezone: 'UTC' }, project, resolveAuthBehaviorConfig()) as ResolvedCalendarConfig;
const range = { startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
const resource = { actor, requestId: 'create-resource', id: 'resource', label: 'Synthetic', kind: 'person', ownerId: actor.userId, timeZone: 'UTC' };
const noop = () => {};

function fixture(configOverrides: Partial<ResolvedCalendarConfig> = {}) {
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
    const options: CalendarRuntimeOptions = { config: { ...config, ...configOverrides }, persistence: resolveCalendarPersistenceConfig(config, project), system, installAllowed: true,
      authority: { coordinator: new AuthorityCommitCoordinator(), actorContext: null } };
    // Private constructor seam only; open() is intentionally not called because
    // its real root lock/liveness lifecycle requires disk qualification.
    const Constructor = CalendarRuntime as unknown as new (options: CalendarRuntimeOptions, owner: DatabaseCoordinator) => CalendarRuntime;
    const runtime = new Constructor(options, owner as unknown as DatabaseCoordinator);
    // The physical coordinator and its path probe are both explicitly mocked.
    // No mock result is claimed as proof of native file/inode safety.
    (runtime as unknown as { filePresent(id: string): boolean }).filePresent = () => simulatedFilePresent;
    return { runtime, system, realm, stats: () => ({ acquisitions, releases, closes }),
      async enableWake() {
        await installCalendarIntegrationWakeCatalog(system, true);
        const catalog = new CalendarIntegrationWakeCatalog(system, calendarHash(canonicalDatabaseRootIdentity(config.rootDirectory)));
        // Explicit constructor/transport test seam, not managed startup proof.
        (runtime as unknown as { wakeCatalog: CalendarIntegrationWakeCatalog }).wakeCatalog = catalog;
        return catalog;
      },
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
    for (const name of ['calendar.appointment', 'calendar.block', 'calendar.availability', 'calendar.location', 'calendar.resourceLocations', 'calendar.resourceLocationPolicy', 'calendar.type', 'calendar.resourceTypes']) {
      await expect(f.runtime.read(scope, name, { actor, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    }
    expect(await f.runtime.read<{ items: unknown[]; truncated: boolean; nextAfter: null }>(scope, 'calendar.visitLocations', { actor, resourceIds: [], interval: range }, noop)).toEqual({ items: [], truncated: false, nextAfter: null });
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
    for (const interval of [{ startAt: range.startAt }, { ...range, endAt: range.startAt }, { ...range, scopeId: 'forged' },
      { startAt: range.startAt, endAt: '2027-01-01T00:00:00.000Z' }]) {
      expect(() => emptyCalendarRead('calendar.visitLocations', { actor, resourceIds: [], interval })).toThrow(CalendarError);
    }
    for (const input of [{ actor, id: 'invalid key' }, { actor, id: 'missing', scopeId: 'forged' }]) {
      await expect(f.runtime.read(scope, 'calendar.resourceLocationPolicy', input, noop)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    await expect(f.runtime.read(trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'other' }), 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, async () => {})).rejects.toMatchObject({ code: 'CALENDAR_CONFIG_INVALID' });
    expect(f.stats().acquisitions).toBe(0);
  } finally { await f.close(); }
});

test('participant broker names keep empty reads file-free, normalize native replay and enforce configured caps before dispatch', async () => {
  const f = fixture({ maxParticipants: 2 });
  const refs: readonly CalendarParticipantReference[] = [{ kind: 'guardian-user', userId: 'target-a' }, { kind: 'guardian-user', userId: 'target-z' }];
  type BoundReferences = { readonly id: string; readonly revision: number; readonly references: readonly CalendarParticipantReference[] };
  try {
    for (const name of ['calendar.appointmentParticipants', 'calendar.holdParticipants']) {
      await expect(f.runtime.read(scope, name, { actor, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
      await expect(f.runtime.read(scope, name, { actor: { ...actor, manageAll: false }, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    }
    await expect(f.runtime.read(scope, 'calendar.holdParticipantAdmission', { actor: { ...actor, manageAll: false }, id: 'missing' }, noop)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    expect(f.stats().acquisitions).toBe(0);
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const booking = { actor, requestId: 'participants', id: 'participants', resourceIds: ['resource'], title: 'PRIVATE_TITLE',
      startAt: '2030-01-01T10:00:00.000Z', endAt: '2030-01-01T11:00:00.000Z', timeZone: 'UTC', participants: refs };
    const acquisitions = f.stats().acquisitions;
    await expect(f.runtime.write(scope, 'calendar.appointment.create', { ...booking, participants: [...refs, { kind: 'guardian-user', userId: 'third' }] }, booking.requestId, noop))
      .rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    expect(f.stats().acquisitions).toBe(acquisitions);
    const first = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', booking, booking.requestId, noop);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', { ...booking, participants: refs.slice().reverse() }, booking.requestId, noop)).toEqual(first);
    expect(await f.runtime.read<BoundReferences>(scope, 'calendar.appointmentParticipants', { actor, id: booking.id }, noop)).toEqual({ id: booking.id, revision: 1, references: refs });
    const replace = { actor, requestId: 'participants-replace', id: booking.id, expectedRevision: 1, references: [] };
    expect(await f.runtime.write(scope, 'calendar.appointment.participants', replace, replace.requestId, noop)).toMatchObject({ operation: 'appointment.participants-changed', revision: 2 });
    expect(await f.runtime.read<BoundReferences>(scope, 'calendar.appointmentParticipants', { actor, id: booking.id }, noop)).toEqual({ id: booking.id, revision: 2, references: [] });
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

test('native integration wake metadata is opt-in and establishment seeds the original owner atomically', async () => {
  const f = fixture();
  try {
    expect(f.system.prepare("SELECT 1 FROM sqlite_master WHERE name='_calendar_integration_wakes'").get()).toBeNull();
    expect(() => f.runtime.integrationWakeCatalog()).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    const catalog = await f.enableWake();
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const owner = f.runtime.integrationOwnerForScope(scope)!;
    const checkpoint = catalog.sample(owner);
    expect(checkpoint).toMatchObject({ owner, configurationGeneration: 0, dirtyGeneration: 2 });
    expect(catalog.coverage()).toMatchObject({ complete: false, configurationStamp: null });
    expect(f.runtime.integrationWakeCatalog()).toBe(catalog);
    expect(f.stats().acquisitions).toBe(3); // No per-command extra wake query.
    const coverage = await f.runtime.prepareIntegrationWakes('synthetic-config-a', 1, noop);
    expect(coverage.complete).toBe(true);
    expect(await f.runtime.refreshIntegrationWake(owner)).toBeNull();
    expect(f.system.prepare('SELECT dirty_generation,published_generation,wake_at FROM _calendar_integration_wakes WHERE id=?').get(owner.id))
      .toMatchObject({ dirty_generation: 3, published_generation: 3, wake_at: null });
  } finally { await f.close(); }
});

test('required wake marker refusal prevents private acquisition and retains truthful not-started outcome', async () => {
  const f = fixture();
  try {
    const catalog = await f.enableWake();
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const owner = f.runtime.integrationOwnerForScope(scope)!;
    const coverage = await catalog.reconcileConfiguration('synthetic-config-a', 1);
    await catalog.seedPage({ generation: coverage.configurationGeneration, now: 1 });
    await f.runtime.refreshIntegrationWake(owner);
    const prior = f.stats(), before = catalog.sample(owner);
    f.system.exec("CREATE TRIGGER synthetic_wake_refusal BEFORE UPDATE ON _calendar_integration_wakes BEGIN SELECT RAISE(ABORT,'synthetic marker refusal'); END");
    const next = { ...resource, id: 'marker-refused', requestId: 'marker-refused' };
    await expect(f.runtime.write(scope, 'calendar.resource.create', next, next.requestId, noop))
      .rejects.toMatchObject({ code: 'CALENDAR_NOT_READY', outcome: 'not-started' });
    expect(f.stats()).toEqual(prior); expect(catalog.sample(owner)).toEqual(before);
    expect(f.realm.get('calendar_resources', next.id)).toBeNull();
    expect(f.runtime.diagnostics()).toMatchObject({ writingOwners: 0 });
  } finally { await f.close(); }
});

test('native source writes mark before private work without a SYSTEM lease and publish only after actual owner settlement', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), committed = new Promise<void>(resolve => { entered = resolve; });
  try {
    const catalog = await f.enableWake();
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const record = f.runtime.integrationOwnerForScope(scope)!, owner = f.runtime.forIntegrationOwner(record);
    const coverage = await catalog.reconcileConfiguration('synthetic-config-a', 1);
    await catalog.seedPage({ generation: coverage.configurationGeneration, now: 1 });
    await f.runtime.refreshIntegrationWake(record);
    const before = catalog.sample(record);
    f.beforeExecute(async operation => {
      if (operation.type !== 'command') return;
      expect(f.system.getRawDatabase().inTransaction).toBe(false);
      expect(catalog.sample(record).dirtyGeneration).toBe(before.dirtyGeneration + 1);
    });
    f.afterCommand(async () => { entered(); await waiting; });
    const pending = owner.command('calendar.integration.claim', { now: 1, nonce: 'synthetic-claim', leaseMs: 1000, limit: 1 }, { idempotencyKey: 'synthetic-claim' });
    await committed;
    const acquisitions = f.stats().acquisitions;
    const requestedAt = Date.now(), retryAt = await f.runtime.refreshIntegrationWake(record);
    expect(retryAt).not.toBeNull(); expect(retryAt!).toBeGreaterThanOrEqual(requestedAt + 1000);
    expect(f.system.prepare('SELECT classification,wake_at,published_generation FROM _calendar_integration_wakes WHERE id=?').get(record.id))
      .toMatchObject({ classification: 'retry', wake_at: retryAt });
    expect(f.stats().acquisitions).toBe(acquisitions);
    expect(f.runtime.diagnostics()).toMatchObject({ writingOwners: 1 });
    release(); expect(await pending).toEqual([]);
    f.afterCommand(null); f.beforeExecute(null);
    expect(await f.runtime.refreshIntegrationWake(record)).toBeNull();
    const latest = catalog.sample(record);
    expect(latest.dirtyGeneration).toBe(before.dirtyGeneration + 2); // Source write + failed/busy proof generation.
    expect(f.system.prepare('SELECT published_generation FROM _calendar_integration_wakes WHERE id=?').get(record.id))
      .toEqual({ published_generation: latest.dirtyGeneration });
  } finally { release(); f.afterCommand(null); f.beforeExecute(null); await f.close(); }
});

test('an owner write racing canonical wake observation cannot publish stale quiet metadata', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; }), reading = new Promise<void>(resolve => { entered = resolve; });
  try {
    const catalog = await f.enableWake();
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const record = f.runtime.integrationOwnerForScope(scope)!;
    const coverage = await catalog.reconcileConfiguration('synthetic-config-a', 1);
    await catalog.seedPage({ generation: coverage.configurationGeneration, now: 1 });
    f.beforeExecute(async operation => {
      if (operation.type === 'query' && operation.name === 'calendar.integration.nextWake') { entered(); await waiting; }
    });
    const refreshing = f.runtime.refreshIntegrationWake(record);
    await reading;
    const next = { ...resource, id: 'racing-resource', requestId: 'racing-resource' };
    await f.runtime.write(scope, 'calendar.resource.create', next, next.requestId, noop);
    release(); expect(await refreshing).toBe(0);
    expect(f.system.prepare('SELECT dirty_generation,published_generation,wake_at IS NOT NULL AS due FROM _calendar_integration_wakes WHERE id=?').get(record.id))
      .toMatchObject({ published_generation: 0, due: 1 });
    f.beforeExecute(null); expect(await f.runtime.refreshIntegrationWake(record)).toBeNull();
  } finally { release(); f.beforeExecute(null); await f.close(); }
});

test('failed canonical publication leaves a due marker without rewriting accepted command truth', async () => {
  const f = fixture();
  try {
    const catalog = await f.enableWake();
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const record = f.runtime.integrationOwnerForScope(scope)!;
    const coverage = await catalog.reconcileConfiguration('synthetic-config-a', 1);
    await catalog.seedPage({ generation: coverage.configurationGeneration, now: 1 });
    const before = catalog.sample(record);
    f.system.exec("CREATE TRIGGER synthetic_publication_refusal BEFORE UPDATE OF published_generation ON _calendar_integration_wakes BEGIN SELECT RAISE(ABORT,'synthetic publication refusal'); END");
    const next = { ...resource, id: 'publication-survivor', requestId: 'publication-survivor' };
    expect(await f.runtime.write(scope, 'calendar.resource.create', next, next.requestId, noop)).toMatchObject({ operation: 'resource.created' });
    await expect(f.runtime.refreshIntegrationWake(record)).rejects.toThrow();
    expect(catalog.sample(record).dirtyGeneration).toBe(before.dirtyGeneration + 1);
    expect(f.realm.get('calendar_resources', next.id)).not.toBeNull();
    expect(f.system.prepare('SELECT published_generation,wake_at IS NOT NULL AS due FROM _calendar_integration_wakes WHERE id=?').get(record.id))
      .toMatchObject({ published_generation: 0, due: 1 });
    f.system.exec('DROP TRIGGER synthetic_publication_refusal');
    f.missingFile();
    expect(await f.runtime.refreshIntegrationWake(record, { classification: 'review', nextWakeAt: 5000 })).toBe(5000);
    expect(f.system.prepare('SELECT classification,published_generation,wake_at FROM _calendar_integration_wakes WHERE id=?').get(record.id))
      .toMatchObject({ classification: 'review', published_generation: 0, wake_at: 5000 });
  } finally { await f.close(); }
});

test('wake startup resumes bounded metadata pages beyond64 owners without acquiring their private databases', async () => {
  const f = fixture();
  try {
    const catalog = await f.enableWake();
    const rootHash = calendarHash(canonicalDatabaseRootIdentity(config.rootDirectory));
    for (let i = 0; i < 137; i++) {
      const scopeId = 'tenant:synthetic-wake-' + i;
      f.system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,1)')
        .run(calendarDatabaseId(scopeId), scopeId, 'cal_00000000-0000-4000-8000-' + String(i).padStart(12, '0'), rootHash, calendarRealm.fingerprint);
    }
    const originals = f.system.prepare('SELECT * FROM _calendar_owners ORDER BY id').all();
    const coverage = await f.runtime.prepareIntegrationWakes('synthetic-config-a', 1, noop);
    expect(coverage.complete).toBe(true);
    expect(f.system.prepare('SELECT count(*) AS n FROM _calendar_integration_wakes').get()).toEqual({ n: 137 });
    expect(f.system.prepare('SELECT * FROM _calendar_owners ORDER BY id').all()).toEqual(originals);
    expect(f.stats().acquisitions).toBe(0); expect(catalog.nextWakeAt(100)).toBe(1);
  } finally { await f.close(); }
});

test('catalog startup isolates missing private owners while preserving metadata admission and existing-only per-owner proof', async () => {
  const f = fixture();
  try {
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const healthy = f.runtime.integrationOwnerForScope(scope)!, missingScope = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'missing-private-owner' });
    const missing: CalendarOwnerRecord = { id: calendarDatabaseId('tenant:missing-private-owner'), scope_id: 'tenant:missing-private-owner',
      owner_id: 'cal_00000000-0000-4000-8000-000000000002', root_hash: healthy.root_hash, realm_fingerprint: calendarRealm.fingerprint, established: 1 };
    f.system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,1)')
      .run(missing.id, missing.scope_id, missing.owner_id, missing.root_hash, missing.realm_fingerprint);
    const internal = f.runtime as unknown as { startupOwners(): CalendarOwnerRecord[]; filePresent(id: string): boolean };
    const probes: string[] = [];
    internal.filePresent = id => { probes.push(id); return id === healthy.id; };
    expect(() => internal.startupOwners()).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
    expect(probes).toContain(missing.id); probes.length = 0;
    const catalog = await f.enableWake(), before = f.stats();
    expect(internal.startupOwners().map(record => record.id).sort()).toEqual([healthy.id, missing.id].sort());
    expect(probes).toEqual([]); expect(f.stats()).toEqual(before);
    await f.runtime.prepareIntegrationWakes('synthetic-isolated-startup', 1, noop);
    expect(f.runtime.integrationOwnerForScope(missingScope)).toEqual(missing);
    expect(f.runtime.integrationOwnerPage({ limit: 10 }).owners).toHaveLength(2); expect(probes).toEqual([]);
    expect(() => f.runtime.forIntegrationOwner(missing)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
    expect(f.stats()).toEqual(before); probes.length = 0;
    expect(await f.runtime.refreshIntegrationWake(missing, { classification: 'review', nextWakeAt: 5000 })).toBe(5000);
    expect(probes).toEqual([]); expect(f.stats()).toEqual(before);
    expect(f.system.prepare('SELECT classification,wake_at FROM _calendar_integration_wakes WHERE id=?').get(missing.id))
      .toEqual({ classification: 'review', wake_at: 5000 });
    await f.runtime.forIntegrationOwner(healthy).verify(); expect(probes).toContain(healthy.id);
    expect(f.stats().acquisitions).toBe(before.acquisitions + 1); expect(catalog.coverage().complete).toBe(true);
    expect(f.system.prepare('SELECT * FROM _calendar_owners WHERE id=?').get(missing.id)).toEqual(missing);
  } finally { await f.close(); }
});

test('catalog startup retains exact root/scope/owner/realm/state and retained-capacity fences without a private probe', async () => {
  const changes: ReadonlyArray<readonly [string, string | number]> = [
    ['id', 'calendar:' + 'f'.repeat(64)], ['scope_id', 'tenant:wrong-scope'], ['owner_id', 'invalid-owner'],
    ['root_hash', 'wrong-root'], ['realm_fingerprint', 'invalid-realm'], ['established', 2],
  ];
  for (const [field, value] of changes) {
    const f = fixture();
    try {
      await f.enableWake(); await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
      const internal = f.runtime as unknown as { startupOwners(): CalendarOwnerRecord[]; filePresent(id: string): boolean };
      internal.filePresent = () => { throw new Error('Startup touched a private path before rejecting metadata.'); };
      // Simulate retained corruption in this disposable MEMORY handle only.
      f.system.getRawDatabase().run('PRAGMA foreign_keys=OFF');
      f.system.getRawDatabase().run('PRAGMA ignore_check_constraints=ON');
      f.system.prepare('UPDATE _calendar_owners SET ' + field + '=?').run(value);
      expect(() => internal.startupOwners()).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
    } finally { await f.close(); }
  }
  const f = fixture({ maxDatabaseFiles: 1 });
  try {
    await f.enableWake(); await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const retained = f.runtime.integrationOwnerForScope(scope)!, scopeId = 'tenant:capacity-owner';
    f.system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,1)')
      .run(calendarDatabaseId(scopeId), scopeId, 'cal_00000000-0000-4000-8000-000000000002', retained.root_hash, calendarRealm.fingerprint);
    const internal = f.runtime as unknown as { startupOwners(): CalendarOwnerRecord[]; filePresent(id: string): boolean };
    internal.filePresent = () => { throw new Error('Capacity admission touched a private path.'); };
    expect(() => internal.startupOwners()).toThrow(expect.objectContaining({ code: 'CALENDAR_CAPACITY' }));
  } finally { await f.close(); }
});

test('catalog startup does not grant migration permission or turn a retained missing scope into an empty read', async () => {
  const f = fixture();
  try {
    await f.enableWake(); await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const internal = f.runtime as unknown as { startupOwners(): CalendarOwnerRecord[]; options: CalendarRuntimeOptions };
    f.missingFile(); expect(internal.startupOwners()).toHaveLength(1);
    const before = f.stats();
    await expect(f.runtime.read(scope, 'calendar.resources', { actor }, noop)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.stats()).toEqual(before);
    f.system.prepare('UPDATE _calendar_owners SET realm_fingerprint=?').run('sha256:' + '0'.repeat(64));
    expect(internal.startupOwners()).toHaveLength(1); // Existing explicit install permission, not a writable admission.
    internal.options = { ...internal.options, installAllowed: false };
    expect(() => internal.startupOwners()).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    expect(f.stats()).toEqual(before);
  } finally { await f.close(); }
});

test('final runtime close joins wake publication after its private read has already released', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  let remove: (() => void) | undefined;
  const waiting = new Promise<void>(resolve => { release = resolve; }), publishing = new Promise<void>(resolve => { entered = resolve; });
  try {
    const catalog = await f.enableWake();
    await f.runtime.write(scope, 'calendar.resource.create', resource, resource.requestId, noop);
    const owner = f.runtime.integrationOwnerForScope(scope)!;
    await f.runtime.prepareIntegrationWakes('synthetic-config-a', 1, noop);
    const original = catalog.sample(owner);
    remove = registerReactiveDBCommitAdmission(f.system, async operation => { entered(); await waiting; return operation(); });
    const refreshing = f.runtime.refreshIntegrationWake(owner);
    const result = refreshing.then(() => { throw new Error('Retired publication must reject.'); }, error => error);
    await publishing;
    expect(f.stats().acquisitions).toBe(f.stats().releases);
    expect(f.runtime.diagnostics()).toMatchObject({ activeOperations: 1 });
    let closed = false;
    const closing = f.runtime.close(); void closing.then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false); expect(f.stats().closes).toBe(0);
    release(); expect(await result).toMatchObject({ code: 'CALENDAR_NOT_READY' });
    await closing; expect(f.stats().closes).toBe(1);
    expect(catalog.sample(owner)).toEqual(original);
  } finally { release(); remove?.(); await f.close(); }
});

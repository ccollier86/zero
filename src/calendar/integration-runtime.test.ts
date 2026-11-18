/** Memory-only lifecycle tests with an explicitly mocked physical coordinator/path probe.
 * No file, actor, app, timer or fixture output. This does not qualify native actor
 * schema preparation, physical file identity, migrations, or process settlement.
 */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { assertDatabaseCommitAuthorityCurrent } from '../databases/database-commit-authority';
import type { DatabaseAcquireOptions, DatabaseCoordinator, DatabaseExecutionOptions } from '../databases/database-coordinator';
import { canonicalDatabaseRootIdentity, createDatabaseRef } from '../databases/database-file';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveCalendarConfig, type ResolvedCalendarConfig } from './config';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';
import { calendarRealm } from './realm';
import { CalendarRuntime, calendarDatabaseId, type CalendarRuntimeOptions, type CalendarRuntimeSource } from './runtime';
import { composeCalendarRuntimeSources } from './runtime-sources';
import { calendarHash } from './validation';

const project = '/synthetic-calendar-integration-runtime-never-created';
const config = resolveCalendarConfig({ timezone: 'UTC' }, project, resolveAuthBehaviorConfig()) as ResolvedCalendarConfig;

function fixture() {
  const system = createReactiveDB({ mode: 'memory' }), authority = new AuthorityCommitCoordinator();
  system.getRawDatabase().run('PRAGMA temp_store=MEMORY'); installCalendarOwnerSchema(system, true);
  const record: CalendarOwnerRecord = { id: calendarDatabaseId('application'), scope_id: 'application',
    owner_id: 'cal_00000000-0000-4000-8000-000000000001', root_hash: calendarHash(canonicalDatabaseRootIdentity(config.rootDirectory)),
    realm_fingerprint: calendarRealm.fingerprint, established: 1 };
  const operations: Array<{ type: string; name?: string; table?: string; input?: unknown }> = [];
  let present = true, leasePresent = true, acquisitions = 0, releases = 0, closes = 0;
  let physical: { owner_id: string; scope_id: string } | null = { owner_id: record.owner_id, scope_id: record.scope_id };
  let beforeAcquire: (() => Promise<void>) | null = null;
  let beforeExecute: ((operation: (typeof operations)[number], execution: DatabaseExecutionOptions) => void | Promise<void>) | null = null;
  let afterCommand: (() => void) | null = null;
  const put = (owner: CalendarOwnerRecord) => system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,?)')
    .run(owner.id, owner.scope_id, owner.owner_id, owner.root_hash, owner.realm_fingerprint, owner.established);
  const coordinator = {
    acquire() { throw new Error('Source work must never provision.'); },
    async acquireExisting(id: string, options: DatabaseAcquireOptions) {
      acquisitions++; await beforeAcquire?.();
      if (!leasePresent) return null;
      return {
        async execute(operation: (typeof operations)[number], execution: DatabaseExecutionOptions = {}) {
          operations.push(operation); await beforeExecute?.(operation, execution);
          if (operation.type === 'get') return { value: physical, sequence: { seq: 0 } };
          if (operation.type === 'query') return { value: operation.input, sequence: { seq: 0 } };
          assertDatabaseCommitAuthorityCurrent(options.commitAuthority!, authority, createDatabaseRef(id));
          afterCommand?.();
          return { value: { kind: 'command', name: operation.name, output: { ok: true, value: operation.input } }, sequence: { seq: 0 } };
        },
        release() { releases++; },
      };
    },
    diagnostics: () => ({ state: 'started' }),
    async close() { closes++; },
  };
  const options: CalendarRuntimeOptions = { config, persistence: { createExecutor: (() => { throw new Error('No actor factory.'); }) as never, defaultActorEntrypoint: null },
    system, installAllowed: true, authority: { coordinator: authority, actorContext: null } };
  // Do not call open(): real root ownership/actors require physical qualification.
  const Constructor = CalendarRuntime as unknown as new (options: CalendarRuntimeOptions, owner: DatabaseCoordinator) => CalendarRuntime;
  const runtime = new Constructor(options, coordinator as unknown as DatabaseCoordinator);
  (runtime as unknown as { filePresent(id: string): boolean }).filePresent = () => present;
  return { runtime, system, record, operations, put,
    stats: () => ({ acquisitions, releases, closes }),
    fileMissing() { present = false; }, leaseMissing() { leasePresent = false; },
    physical(value: typeof physical) { physical = value; },
    beforeAcquire(value: typeof beforeAcquire) { beforeAcquire = value; },
    beforeExecute(value: typeof beforeExecute) { beforeExecute = value; },
    afterCommand(value: typeof afterCommand) { afterCommand = value; },
    async close() { try { await runtime.close(); } finally { system.dispose(); await authority.drain(); } },
  };
}

test('native owner enumeration is detached, established-only and does not acquire or provision', async () => {
  const f = fixture();
  try {
    expect(f.runtime.integrationOwners()).toEqual([]);
    f.put(f.record);
    f.put({ ...f.record, id: calendarDatabaseId('tenant:pending'), scope_id: 'tenant:pending', established: 0 });
    const owners = f.runtime.integrationOwners();
    expect(owners).toEqual([f.record]); expect(Object.isFrozen(owners)).toBe(true); expect(Object.isFrozen(owners[0])).toBe(true);
    expect(owners[0]).not.toBe(f.record); expect(f.stats().acquisitions).toBe(0);
    f.system.prepare('UPDATE _calendar_owners SET established=0 WHERE id=?').run(f.record.id);
    expect(owners[0]!.established).toBe(1); expect(f.runtime.integrationOwners()).toEqual([]);
  } finally { await f.close(); }
});

test('native scope/owner/request identity is injected and every acquisition verifies its physical owner first', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record);
    expect(Object.isFrozen(owner)).toBe(true); expect(Object.isFrozen(owner.owner)).toBe(true); expect(Object.isFrozen(owner.scope)).toBe(true);
    expect(owner.scope).toEqual(applicationServiceDataScope());
    expect(f.stats().acquisitions).toBe(0);
    await owner.verify();
    const input = { ruleId: 'rule-a' };
    const reading = owner.read('calendar.integration.policy', input); input.ruleId = 'changed-after-admission';
    expect(await reading).toEqual({ ruleId: 'rule-a', scopeId: 'application', expectedOwnerId: f.record.owner_id });
    expect(await owner.command<Record<string, unknown>>('calendar.integration.policy.retire', { ruleId: 'rule-a', epoch: 1 }, { idempotencyKey: 'retire-a' }))
      .toEqual({ ruleId: 'rule-a', epoch: 1, scopeId: 'application', expectedOwnerId: f.record.owner_id, requestId: 'retire-a' });
    expect(f.operations.map(operation => operation.type + ':' + (operation.name ?? operation.table)))
      .toEqual(['get:_calendar_owner', 'get:_calendar_owner', 'query:calendar.integration.policy', 'get:_calendar_owner', 'command:calendar.integration.policy.retire']);
    expect(f.stats()).toEqual({ acquisitions: 3, releases: 3, closes: 0 });
    f.physical({ owner_id: 'replaced-physical-owner', scope_id: 'application' });
    await expect(owner.read('calendar.integration.policy', {})).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.operations.at(-1)!.type).toBe('get'); expect(f.stats().releases).toBe(4);
  } finally { await f.close(); }
});

test('tenant owner scope is native and a physical scope mismatch cannot cross the boundary', async () => {
  const f = fixture(), tenant = { ...f.record, id: calendarDatabaseId('tenant:private-tenant'), scope_id: 'tenant:private-tenant' };
  f.put(tenant); f.physical({ owner_id: tenant.owner_id, scope_id: tenant.scope_id });
  try {
    const owner = f.runtime.forIntegrationOwner(tenant);
    expect(owner.scope.scopeKind).toBe('tenant'); expect(owner.scope.tenantId).toBe('private-tenant');
    expect(await owner.read<Record<string, unknown>>('calendar.integration.policies', {})).toEqual({ scopeId: tenant.scope_id, expectedOwnerId: tenant.owner_id });
    f.physical({ owner_id: tenant.owner_id, scope_id: 'application' });
    await expect(owner.verify()).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.stats()).toEqual({ acquisitions: 2, releases: 2, closes: 0 });
  } finally { await f.close(); }
});

test('an old SYSTEM realm remains not ready even when ordinary calendar installation is allowed', async () => {
  const f = fixture(), retained = { ...f.record, realm_fingerprint: 'sha256:' + '0'.repeat(64) };
  f.put(retained);
  try {
    expect(() => f.runtime.integrationOwners()).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    expect(() => f.runtime.forIntegrationOwner(retained)).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    expect(f.stats().acquisitions).toBe(0);
    expect(f.system.prepare('SELECT realm_fingerprint FROM _calendar_owners WHERE id=?').get(retained.id)).toEqual({ realm_fingerprint: retained.realm_fingerprint });
  } finally { await f.close(); }
});

test('integration operations cannot cross into request operations or accept caller-authored routing/authority', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record);
    for (const input of [{ scopeId: 'application' }, { expectedOwnerId: f.record.owner_id }, { actor: {} }, { requestId: 'forged' }]) {
      await expect(owner.read('calendar.integration.policy', input)).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    }
    await expect(owner.read('calendar.resources' as never, {})).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(owner.command('calendar.appointment.create' as never, {}, { idempotencyKey: 'forged' })).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    await expect(f.runtime.read(applicationServiceDataScope(), 'calendar.integration.policy', {}, () => {})).rejects.toMatchObject({ code: 'CALENDAR_INPUT_INVALID' });
    expect(f.stats().acquisitions).toBe(0);
  } finally { await f.close(); }
});

test('native policy installation binds source root, realm, database, owner and scope before acquiring SQL', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record);
    const policy = { ruleId: 'observation', ruleVersion: '1', adapter: 'observation-v1' as const, dueOffsetMs: 0, maxLatenessMs: 60_000,
      source: { identity: { domain: 'zero.calendar', databaseId: f.record.id, ownerId: f.record.owner_id, rootHash: f.record.root_hash, scopeId: f.record.scope_id },
        realmFingerprint: f.record.realm_fingerprint, policyVersion: '1', semanticsVersion: '1',
        definition: { name: 'zero.calendar.observation', version: '1', fingerprint: 'a'.repeat(64) },
        workflow: { name: 'zero.calendar.observation', version: 1, definitionId: 'definition-a', versionId: 'version-a', fingerprint: 'b'.repeat(64) } } };
    for (const patch of [{ rootHash: '0'.repeat(64) }, { databaseId: 'calendar:other' }, { ownerId: 'other-owner' }, { scopeId: 'tenant:other' }]) {
      await expect(owner.command('calendar.integration.policy.install', { policy: { ...policy, source: { ...policy.source, identity: { ...policy.source.identity, ...patch } } }, expectedEpoch: 0 },
        { idempotencyKey: 'forged-identity' })).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    }
    await expect(owner.command('calendar.integration.policy.install', { policy: { ...policy, source: { ...policy.source, realmFingerprint: 'sha256:' + '0'.repeat(64) } }, expectedEpoch: 0 },
      { idempotencyKey: 'forged-realm' })).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.stats().acquisitions).toBe(0);
    const admitted = await owner.command<{ policy: typeof policy }>('calendar.integration.policy.install', { policy, expectedEpoch: 0 }, { idempotencyKey: 'native-policy' });
    expect(admitted.policy).toEqual(policy); expect(f.stats().acquisitions).toBe(1); expect(f.stats().releases).toBe(1);
  } finally { await f.close(); }
});

test('unestablished, missing and changed SYSTEM owners fail closed before actor acquisition', async () => {
  for (const patch of [{ established: 0 }, { owner_id: 'cal_00000000-0000-4000-8000-000000000002' },
    { root_hash: '0'.repeat(64) }, { realm_fingerprint: 'sha256:' + '0'.repeat(64) }]) {
    const f = fixture(); f.put(f.record);
    try {
      const owner = f.runtime.forIntegrationOwner(f.record);
      const [field, value] = Object.entries(patch)[0]!;
      f.system.prepare('UPDATE _calendar_owners SET ' + field + '=? WHERE id=?').run(value!, f.record.id);
      expect(() => owner.assertCurrent()).toThrow();
      await expect(owner.verify()).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
      expect(f.stats().acquisitions).toBe(0);
    } finally { await f.close(); }
  }
  const f = fixture();
  try {
    expect(() => f.runtime.forIntegrationOwner(f.record)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
    f.put({ ...f.record, established: 0 });
    expect(() => f.runtime.forIntegrationOwner({ ...f.record, established: 0 })).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    expect(f.stats().acquisitions).toBe(0);
  } finally { await f.close(); }
});

test('missing established files never fall back to provisioning or migration/binding commands', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record); f.leaseMissing();
    await expect(owner.verify()).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.operations).toHaveLength(0);
    f.fileMissing();
    await expect(owner.read('calendar.integration.policies', {})).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.stats().acquisitions).toBe(1);
  } finally { await f.close(); }
});

test('owner verification fences changes across acquisition and read waits, releasing the exact lease', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record);
    f.beforeAcquire(async () => { f.system.prepare('UPDATE _calendar_owners SET established=0 WHERE id=?').run(f.record.id); });
    await expect(owner.verify()).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.operations).toHaveLength(0); expect(f.stats().releases).toBe(1);
    f.beforeAcquire(null); f.system.prepare('UPDATE _calendar_owners SET established=1 WHERE id=?').run(f.record.id);
    f.beforeExecute(operation => { if (operation.type === 'get') f.physical(null); });
    await expect(owner.verify()).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(f.stats().releases).toBe(2);
  } finally { await f.close(); }
});

test('caller signals and synchronous policy guards fail without retiring the owner evidence lifetime', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record), cancelled = new AbortController(); cancelled.abort();
    await expect(owner.verify({ signal: cancelled.signal })).rejects.toBeDefined();
    await expect(owner.verify({ assertCurrent: async () => {} })).rejects.toMatchObject({ code: 'CALENDAR_CONFIG_INVALID' });
    await expect(owner.read('calendar.integration.policies', {}, { assertCurrent() { throw new Error('policy retired'); } })).rejects.toThrow('policy retired');
    expect(f.stats().acquisitions).toBe(0); expect(owner.signal.aborted).toBe(false);
    await owner.verify(); expect(f.stats().releases).toBe(1);
  } finally { await f.close(); }
});

test('a proven final native writer refusal stays refused, but lost post-commit authority stays unknown', async () => {
  const f = fixture(); f.put(f.record);
  try {
    const owner = f.runtime.forIntegrationOwner(f.record); let permitted = true;
    f.beforeExecute(operation => { if (operation.type === 'command') permitted = false; });
    await expect(owner.command('calendar.integration.policy.retire', { ruleId: 'a', epoch: 1 }, {
      idempotencyKey: 'refused', assertCurrent() { if (!permitted) throw new Error('retired'); },
    })).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN', outcome: 'not-started' });
    permitted = true; f.beforeExecute(null); f.afterCommand(() => { permitted = false; });
    await expect(owner.command('calendar.integration.policy.retire', { ruleId: 'a', epoch: 1 }, {
      idempotencyKey: 'unknown', assertCurrent() { if (!permitted) throw new Error('retired'); },
    })).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(f.stats().releases).toBe(2);
  } finally { await f.close(); }
});

test('shutdown retires source lifetime and waits for an already-dispatched physical mock operation', async () => {
  const f = fixture(); f.put(f.record);
  let release!: () => void, reached!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), entered = new Promise<void>(resolve => { reached = resolve; });
  try {
    const owner = f.runtime.forIntegrationOwner(f.record);
    f.beforeExecute(async operation => { if (operation.type === 'query') { reached(); await gate; } });
    const read = owner.read('calendar.integration.policies', {}), rejection = read.catch(error => error);
    await entered;
    const closing = f.runtime.close();
    expect(owner.signal.aborted).toBe(true); expect(() => owner.assertCurrent()).toThrow(expect.objectContaining({ code: 'CALENDAR_NOT_READY' }));
    expect(f.stats().closes).toBe(0); expect(f.stats().releases).toBe(0);
    release(); await rejection; await closing;
    expect(f.stats()).toEqual({ acquisitions: 1, releases: 1, closes: 1 });
  } finally { release(); await f.close(); }
});

test('source composition isolates advisory wakes and closes all children despite failure', async () => {
  const events: string[] = [];
  const child = (id: string, fail = false): CalendarRuntimeSource => ({ prepare() { events.push('prepare:' + id); },
    wake() { events.push('wake:' + id); if (fail) throw new Error('advisory'); },
    async close() { events.push('close:' + id); if (fail) throw new Error('close'); } });
  const source = await composeCalendarRuntimeSources(() => child('logging', true), () => child('dispatch'))({} as DatabaseCoordinator);
  source.prepare({} as CalendarOwnerRecord); source.wake('ref');
  const closing = source.close(); expect(source.close()).toBe(closing);
  await expect(closing).rejects.toBeInstanceOf(AggregateError);
  source.wake('ref'); expect(() => source.prepare({} as CalendarOwnerRecord)).toThrow();
  expect(events).toEqual(['prepare:logging', 'prepare:dispatch', 'wake:logging', 'wake:dispatch', 'close:dispatch', 'close:logging']);
});

test('source composition cleans a partially initialized chain and preserves startup/cleanup failures', async () => {
  const events: string[] = [], startup = new Error('startup'), cleanup = new Error('cleanup');
  const source: CalendarRuntimeSource = { prepare() {}, wake() {}, async close() { events.push('close'); throw cleanup; } };
  const creating = composeCalendarRuntimeSources(() => source, () => { throw startup; })({} as DatabaseCoordinator);
  try { await creating; throw new Error('Expected construction failure.'); }
  catch (error) {
    expect(error).toBeInstanceOf(AggregateError); expect((error as AggregateError).errors[0]).toBe(startup);
    expect(((error as AggregateError).errors[1] as AggregateError).errors).toEqual([cleanup]);
  }
  expect(events).toEqual(['close']);
});

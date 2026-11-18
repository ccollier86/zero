/**
 * Real file/WAL SYSTEM, native DatabaseCoordinator and matching isolated calendar
 * actors. Synthetic state only; no app/HTTP/provider or installed-bundle claim.
 *
 * The canonical allocator refuses the external integrity hold. Do not substitute
 * an internal TMPDIR or an unmarked root to make this qualification proceed.
 */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { applicationServiceDataScope, serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { canonicalDatabaseRootIdentity, resolveDatabaseFile } from '../databases/database-file';
import type { SubprocessDatabaseExecutor } from '../databases/subprocess-database-executor';
import { databaseActorFactoryLaunch, type DatabaseActorExecutorFactoryContext, type SubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { createReactiveDB } from '../sync/reactive-db';
import { allocateSyntheticFixture } from '../test-support/synthetic-fixture';
import { resolveCalendarConfig, type ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarAppointmentPage, CalendarAppointmentView, CalendarAppointmentTypeView, CalendarAvailabilityView, CalendarBlockPage, CalendarBusyPage, CalendarCommandReceipt, CalendarHoldPage, CalendarHoldView, CalendarLocationPage, CalendarLocationView, CalendarResourceLocationsView, CalendarResourcePage, CalendarLifecyclePolicy, CalendarAppointmentTransitions } from './contracts';
import { CalendarError } from './error';
import { inspectCalendarOwnerSchema } from './owner-schema';
import { resolveCalendarPersistenceConfig, type ResolvedCalendarPersistenceConfig } from './persistence-config';
import { calendarRealm } from './realm';
import { calendarDatabaseId, CalendarRuntime, type CalendarRuntimeOptions } from './runtime';
import { calendarHash } from './validation';

const fixtureParent = process.platform === 'darwin'
  ? '/Volumes/code-bank/tmp/scratch/zero-platform/calendar-file-runtime'
  : join(tmpdir(), 'zero-platform', 'calendar-file-runtime');
const range = { startAt: '2026-12-01T00:00:00.000Z', endAt: '2026-12-02T00:00:00.000Z' };
const guard = () => {};
const actor = (scope: ServiceDataScope, userId = 'synthetic-owner', manageAll = true): CalendarActor => ({
  scopeId: serviceDataScopeKey(scope), userId, principal: 'synthetic-session:' + userId, manageAll, createOwn: true,
});
const resource = (scope: ServiceDataScope, id = 'person', kind: 'person' | 'room' = 'person') => ({
  actor: actor(scope), requestId: 'create-' + id, id, label: 'SYNTHETIC_PRIVATE_LABEL_' + id,
  kind, ownerId: kind === 'person' ? 'synthetic-owner' : null, timeZone: 'UTC',
});
const appointment = (scope: ServiceDataScope, id: string, resourceIds = ['person', 'room']) => ({
  actor: actor(scope), requestId: 'book-' + id, id, resourceIds, title: 'SYNTHETIC_PRIVATE_TITLE_' + id,
  startAt: '2026-12-01T10:00:00.000Z', endAt: '2026-12-01T11:00:00.000Z', timeZone: 'UTC',
  bufferBeforeMinutes: 5, bufferAfterMinutes: 10,
});
const block = (scope: ServiceDataScope, id: string, resourceIds = ['person', 'room']) => ({
  actor: actor(scope), requestId: 'block-' + id, id, resourceIds, title: 'SYNTHETIC_PRIVATE_BLOCK_TITLE_' + id,
  startAt: '2026-12-01T13:00:00.000Z', endAt: '2026-12-01T14:00:00.000Z', timeZone: 'UTC',
});
type OwnedActor = { readonly context: DatabaseActorExecutorFactoryContext; readonly executor: SubprocessDatabaseExecutor };
type PersistenceProbe = (defaults: ResolvedCalendarPersistenceConfig, root: string, config: ResolvedCalendarConfig) => ResolvedCalendarPersistenceConfig;

async function fixture(probe?: PersistenceProbe) {
  // This is a new allocator label. Immediate finally cleanup is mandatory;
  // scheduled maintenance's existing family allowlist is NOT claimed to cover it.
  const owned = await allocateSyntheticFixture(fixtureParent, 'calendar-runtime');
  const systemPath = join(owned.root, 'system.sqlite');
  let config: ResolvedCalendarConfig;
  try {
    const resolved = resolveCalendarConfig({ rootDirectory: 'calendar', timezone: 'UTC', maxActiveDatabases: 2 }, owned.root, resolveAuthBehaviorConfig());
    if (!resolved) throw new Error('Synthetic calendar configuration was not resolved.');
    config = resolved;
  } catch (error) {
    try { await owned.cleanup(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Synthetic calendar admission failed; preserving ' + owned.root); }
    throw error;
  }
  const actors: OwnedActor[] = [];
  let system: ReturnType<typeof createReactiveDB> | null = null;
  let coordinator: AuthorityCommitCoordinator | null = null;
  let runtime: CalendarRuntime | null = null;
  let options: CalendarRuntimeOptions | null = null;

  const stop = async () => {
    if (runtime) { await runtime.close(); runtime = null; }
    // A close promise alone is not proof an exact subprocess generation died.
    for (const entry of actors) {
      if (!entry.executor.diagnostics().settled) throw new Error('Synthetic calendar actor did not settle; preserving ' + owned.root);
    }
  };
  const shutdown = async () => {
    const failures: unknown[] = [];
    try { await stop(); } catch (error) { failures.push(error); }
    // Retry exact owned actors on an exceptional runtime teardown. Never signal
    // arbitrary processes or remove a fixture while a generation can still write.
    for (const entry of actors) {
      try {
        if (!entry.executor.diagnostics().settled) await entry.executor.close();
        if (!entry.executor.diagnostics().settled) throw new Error('Owned actor remains unsettled.');
      } catch (error) { failures.push(error); }
    }
    try { await coordinator?.close(); coordinator = null; } catch (error) { failures.push(error); }
    try { system?.dispose(); system = null; } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Synthetic calendar shutdown failed; preserving ' + owned.root);
  };
  const open = async (installAllowed: boolean) => {
    system = createReactiveDB({ mode: 'file', path: systemPath });
    installAuthAuthorityRevision(system);
    coordinator = new AuthorityCommitCoordinator();
    const actorContext = new DatabaseActorAuthorityContext(system, systemPath);
    const defaults = resolveCalendarPersistenceConfig(config, owned.root);
    const launch = databaseActorFactoryLaunch(defaults.createExecutor)!;
    expect(launch.env).toEqual({});
    expect(launch.prefix).toEqual([process.execPath, '--no-env-file', defaults.defaultActorEntrypoint!]);
    expect(defaults.defaultActorEntrypoint).toEndWith('/calendar/actor-entry.ts');
    const selected = probe ? probe(defaults, owned.root, config) : defaults;
    // Forward-only observation: every executor remains the production concrete
    // subprocess implementation. No fake coordinator, database, IPC or result.
    const createExecutor: SubprocessDatabaseExecutorFactory = context => {
      const executor = selected.createExecutor(context);
      actors.push({ context, executor });
      return executor;
    };
    options = { config, persistence: { ...selected, createExecutor }, system, installAllowed, authority: { coordinator, actorContext } };
    runtime = await CalendarRuntime.open(options);
  };
  const close = async () => {
    await shutdown();
    await owned.cleanup();
    if (existsSync(owned.root)) console.warn('Synthetic calendar fixture intentionally retained: ' + owned.root);
  };
  try {
    expect(existsSync(config.rootDirectory)).toBe(false);
    await open(true);
    return {
      root: owned.root, config, actors,
      get system() { if (!system) throw new Error('Synthetic SYSTEM is stopped.'); return system; },
      get runtime() { if (!runtime) throw new Error('Synthetic calendar runtime is stopped.'); return runtime; },
      get options() { if (!options) throw new Error('Synthetic calendar options are unavailable.'); return options; },
      path(scope: ServiceDataScope) { return resolveDatabaseFile(config.rootDirectory, calendarDatabaseId(serviceDataScopeKey(scope))).path; },
      stop,
      async restart(installAllowed = false) { await shutdown(); await open(installAllowed); },
      close,
    };
  } catch (error) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Synthetic calendar setup and cleanup failed; preserving ' + owned.root); }
    throw error;
  }
}

function inspect<T>(path: string, run: (database: Database) => T): T {
  // Call only after f.stop() proves all owned actor generations settled.
  const database = new Database(path, { readonly: true, strict: true });
  try { return run(database); } finally { database.close(true); }
}

async function eventually(assertion: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!assertion()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('file runtime empty reads and denied first writes allocate no domain or actor', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), user = actor(scope);
  try {
    expect(inspectCalendarOwnerSchema(f.system)).toBe('ready');
    expect(await f.runtime.read<CalendarResourcePage>(scope, 'calendar.resources', { actor: user }, guard)).toEqual({ items: [], truncated: false, nextAfter: null });
    for (const name of ['calendar.busy', 'calendar.appointments', 'calendar.blocks', 'calendar.holds']) {
      expect(await f.runtime.read<CalendarBusyPage | CalendarAppointmentPage | CalendarBlockPage | CalendarHoldPage>(scope, name, { actor: user, resourceIds: [], ...range }, guard)).toEqual({ items: [], truncated: false });
    }
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: user, requestId: 'missing' }, guard)).toBeNull();
    await expect(f.runtime.read(scope, 'calendar.appointment', { actor: user, id: 'missing' }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.read(scope, 'calendar.block', { actor: user, id: 'missing' }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.read(scope, 'calendar.hold', { actor: user, id: 'missing' }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.read(scope, 'calendar.availability', { actor: user, id: 'missing' }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.appointment.create', appointment(scope, 'missing'), 'book-missing', guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.block.create', block(scope, 'missing'), 'block-missing', guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.resource.availability', { actor: user, id: 'missing', requestId: 'missing-policy', expectedRevision: 1,
      mode: 'windows', windows: [] }, 'missing-policy', guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    const denied = { ...resource(scope), actor: { ...user, manageAll: false, createOwn: false } };
    await expect(f.runtime.write(scope, 'calendar.resource.create', denied, denied.requestId, guard)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await expect(f.runtime.read(scope, 'calendar.resources', { actor: user }, async () => {})).rejects.toMatchObject({ code: 'CALENDAR_CONFIG_INVALID' });
    const revoked = () => { throw new CalendarError('CALENDAR_FORBIDDEN'); };
    await expect(f.runtime.write(scope, 'calendar.resource.create', resource(scope), 'create-person', revoked)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.system.prepare('SELECT count(*) AS n FROM _calendar_owners').get()).toEqual({ n: 0 });
    expect(existsSync(f.path(scope))).toBe(false);
    expect(f.actors).toHaveLength(0);
    expect(f.runtime.diagnostics().fabric).toMatchObject({ databaseFiles: 0, openDatabases: 0 });
    const closed = f.runtime; await f.stop();
    await expect(closed.read(scope, 'calendar.resources', { actor: user }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
  } finally { await f.close(); }
}, 120_000);

test('native calendar actors persist separate scopes, availability history and exact appointment/block/hold receipts across full SYSTEM restart', async () => {
  const f = await fixture(), scopes = [applicationServiceDataScope(), trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'synthetic-tenant' })];
  try {
    const receipts = await Promise.all(scopes.map(async scope => {
      for (const id of ['person', 'room', 'hold-room']) {
        const input = resource(scope, id, id === 'person' ? 'person' : 'room');
        await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
      }
      expect(await f.runtime.read<CalendarAvailabilityView>(scope, 'calendar.availability', { actor: actor(scope), id: 'person' }, guard))
        .toMatchObject({ resourceId: 'person', resourceRevision: 1, mode: 'unrestricted', windows: [], timeZone: 'UTC' });
      const policy = { actor: actor(scope), id: 'person', requestId: 'availability-first', expectedRevision: 1, mode: 'windows',
        windows: [{ startAt: '2026-12-01T08:00:00.000Z', endAt: '2026-12-01T18:00:00.000Z' }] };
      await f.runtime.write(scope, 'calendar.resource.availability', policy, policy.requestId, guard);
      const currentPolicy = { ...policy, requestId: 'availability-current', expectedRevision: 2,
        windows: [{ startAt: '2026-12-01T09:00:00.000Z', endAt: '2026-12-01T17:00:00.000Z' }] };
      const availability = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.availability', currentPolicy, currentPolicy.requestId, guard);
      const input = appointment(scope, 'same-id'), blocked = block(scope, 'same-id');
      const now = Date.now(), holdInput = { actor: actor(scope), requestId: 'retain-hold', id: 'retained-hold', resourceIds: ['hold-room'],
        startAt: new Date(now + 3_600_000).toISOString(), endAt: new Date(now + 7_200_000).toISOString(), timeZone: 'UTC', ttlSeconds: 900 };
      const hold = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.acquire', holdInput, holdInput.requestId, guard);
      const holdView = await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: actor(scope), id: hold.id }, guard);
      return { appointment: await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', input, input.requestId, guard),
        block: await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.block.create', blocked, blocked.requestId, guard), availability, currentPolicy,
        hold, holdView, holdInput };
    }));
    expect(f.system.prepare('SELECT count(*) AS n FROM _calendar_owners WHERE established=1').get()).toEqual({ n: 2 });
    const files = await Promise.all(scopes.map(async scope => ({ path: f.path(scope), identity: await lstat(f.path(scope)) })));
    expect(files[0]!.path).not.toBe(files[1]!.path);
    expect(f.actors.some(entry => entry.context.role === 'writer' && entry.executor.diagnostics().state === 'ready')).toBe(true);
    expect(f.actors.some(entry => entry.context.role === 'reader' && entry.executor.diagnostics().state === 'ready')).toBe(true);
    await f.restart(false);
    for (const [index, scope] of scopes.entries()) {
      const input = appointment(scope, 'same-id');
      const retained = receipts[index]!, blocked = block(scope, 'same-id');
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: input.requestId }, guard)).toEqual(retained.appointment);
      expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', input, input.requestId, guard)).toEqual(retained.appointment);
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: blocked.requestId }, guard)).toEqual(retained.block);
      expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.block.create', blocked, blocked.requestId, guard)).toEqual(retained.block);
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: retained.holdInput.requestId }, guard)).toEqual(retained.hold);
      expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.acquire', retained.holdInput, retained.holdInput.requestId, guard)).toEqual(retained.hold);
      expect(await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: actor(scope), id: retained.hold.id }, guard)).toEqual(retained.holdView);
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: retained.currentPolicy.requestId }, guard)).toEqual(retained.availability);
      expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.availability', retained.currentPolicy, retained.currentPolicy.requestId, guard)).toEqual(retained.availability);
      expect(await f.runtime.read<CalendarAvailabilityView>(scope, 'calendar.availability', { actor: actor(scope), id: 'person' }, guard))
        .toMatchObject({ resourceId: 'person', resourceRevision: 3, mode: 'windows', windows: retained.currentPolicy.windows, timeZone: 'UTC' });
      expect((await f.runtime.read<CalendarAppointmentPage>(scope, 'calendar.appointments', { actor: actor(scope), resourceIds: ['person'], ...range }, guard)).items)
        .toMatchObject([{ id: 'same-id', revision: 1, resourceIds: ['person', 'room'] }]);
      expect((await f.runtime.read<CalendarBlockPage>(scope, 'calendar.blocks', { actor: actor(scope), resourceIds: ['person'], ...range }, guard)).items)
        .toMatchObject([{ id: 'same-id', revision: 1, resourceIds: ['person', 'room'], status: 'active' }]);
      expect((await lstat(files[index]!.path)).ino).toBe(files[index]!.identity.ino);
    }
    await expect(f.runtime.read(scopes[0]!, 'calendar.resources', { actor: actor(scopes[1]!) }, guard)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await f.stop();
    for (const scope of scopes) inspect(f.path(scope), database => {
      expect(database.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(database.query('SELECT count(*) AS n FROM calendar_appointments').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE active=1').get()).toEqual({ n: 2 });
      expect(database.query('SELECT count(*) AS n FROM calendar_blocks').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_block_reservations WHERE active=1').get()).toEqual({ n: 2 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_block_receipts').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM calendar_holds').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_hold_reservations WHERE active=1').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_hold_receipts').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_availability_history WHERE resource_id=?').get('person')).toEqual({ n: 2 });
      expect(database.query('SELECT policy_revision FROM _calendar_availability WHERE resource_id=?').get('person')).toEqual({ policy_revision: 3 });
      const retained = f.system.prepare('SELECT owner_id,scope_id FROM _calendar_owners WHERE id=?').get(calendarDatabaseId(serviceDataScopeKey(scope)));
      expect(database.query('SELECT owner_id,scope_id FROM _calendar_owner').get()).toEqual(retained);
    });
  } finally { await f.close(); }
}, 120_000);

test('native actor source expiry never renews on replay and competing confirmations consume one hold atomically', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), user = actor(scope);
  try {
    for (const [id, kind] of [['person', 'person'], ['room', 'room']] as const) {
      const input = resource(scope, id, kind);
      await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
    }
    const now = Date.now(), startAt = new Date(now + 3_600_000).toISOString(), endAt = new Date(now + 7_200_000).toISOString();
    const expiring = { actor: user, requestId: 'acquire-expiring', id: 'expiring-hold', resourceIds: ['person', 'room'],
      startAt, endAt, timeZone: 'UTC', bufferBeforeMinutes: 5, bufferAfterMinutes: 10, ttlSeconds: 1 };
    const acquired = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.acquire', expiring, expiring.requestId, guard);
    const initial = await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: user, id: acquired.id }, guard);
    const expiresMs = Date.parse(initial.expiresAt), deadline = performance.now() + 1_100;
    while (Date.now() < expiresMs) {
      if (performance.now() >= deadline) throw new Error('Owned actor hold did not reach its admitted one-second expiry.');
      await new Promise(resolve => setTimeout(resolve, Math.max(1, Math.min(20, expiresMs - Date.now()))));
    }
    expect(await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: user, id: acquired.id }, guard))
      .toMatchObject({ status: 'expired', revision: 1, expiresAt: initial.expiresAt, appointmentId: null });
    const expiredRange = { actor: user, resourceIds: expiring.resourceIds, startAt, endAt };
    expect(await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', expiredRange, guard)).toEqual({ items: [], truncated: false });
    const expiredConfirm = { actor: user, requestId: 'confirm-expired', id: acquired.id,
      appointmentId: calendarHash(['appointment-from-hold', user.scopeId, user.principal, 'confirm-expired']), expectedRevision: 1, title: 'SYNTHETIC_PRIVATE_EXPIRED_TITLE' };
    await expect(f.runtime.write(scope, 'calendar.hold.confirm', expiredConfirm, expiredConfirm.requestId, guard))
      .rejects.toMatchObject({ code: 'CALENDAR_HOLD_EXPIRED', outcome: 'not-committed' });
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: user, requestId: expiredConfirm.requestId }, guard)).toBeNull();
    const afterExpiry = { ...appointment(scope, 'after-expiry'), startAt, endAt };
    await f.runtime.write(scope, 'calendar.appointment.create', afterExpiry, afterExpiry.requestId, guard);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.acquire', expiring, expiring.requestId, guard)).toEqual(acquired);
    expect(await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: user, id: acquired.id }, guard))
      .toMatchObject({ status: 'expired', revision: 1, expiresAt: initial.expiresAt });

    const live = { ...expiring, requestId: 'acquire-contended', id: 'contended-hold', ttlSeconds: 900,
      startAt: new Date(now + 10_800_000).toISOString(), endAt: new Date(now + 14_400_000).toISOString() };
    await f.runtime.write(scope, 'calendar.hold.acquire', live, live.requestId, guard);
    const confirmations = ['first', 'second'].map(id => ({ actor: user, requestId: 'confirm-' + id, id: live.id,
      appointmentId: calendarHash(['appointment-from-hold', user.scopeId, user.principal, 'confirm-' + id]), expectedRevision: 1, title: 'SYNTHETIC_PRIVATE_CONFIRM_' + id }));
    const competitor = { ...appointment(scope, 'ordinary-competitor'), startAt: live.startAt, endAt: live.endAt };
    const outcomes = await Promise.allSettled([
      ...confirmations.map(input => f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.confirm', input, input.requestId, guard)),
      f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', competitor, competitor.requestId, guard),
    ]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const winnerIndex = outcomes.findIndex(outcome => outcome.status === 'fulfilled'); expect(winnerIndex).toBeLessThan(2);
    const winner = confirmations[winnerIndex]!, loser = confirmations[1 - winnerIndex]!;
    expect(outcomes[1 - winnerIndex]).toMatchObject({ status: 'rejected', reason: { code: 'CALENDAR_REVISION_CONFLICT', outcome: 'not-committed' } });
    expect(outcomes[2]).toMatchObject({ status: 'rejected', reason: { code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' } });
    const accepted = (outcomes[winnerIndex] as PromiseFulfilledResult<CalendarCommandReceipt>).value;
    expect(accepted).toMatchObject({ operation: 'appointment.created', id: winner.appointmentId, revision: 1 });
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.confirm', winner, winner.requestId, guard)).toEqual(accepted);
    expect(await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: user, id: live.id }, guard))
      .toMatchObject({ status: 'confirmed', revision: 2, appointmentId: winner.appointmentId });
    const liveRange = { actor: user, resourceIds: live.resourceIds, startAt: live.startAt, endAt: live.endAt };
    expect((await f.runtime.read<CalendarAppointmentPage>(scope, 'calendar.appointments', liveRange, guard)).items.map(item => item.id)).toEqual([winner.appointmentId]);
    expect((await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', liveRange, guard)).items).toHaveLength(2);
    expect(await f.runtime.read<CalendarHoldPage>(scope, 'calendar.holds', liveRange, guard)).toEqual({ items: [], truncated: false });
    for (const requestId of [loser.requestId, competitor.requestId]) {
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: user, requestId }, guard)).toBeNull();
    }
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(database.query('SELECT count(*) AS n FROM calendar_appointments').get()).toEqual({ n: 2 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE active=1').get()).toEqual({ n: 4 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE appointment_id IN (?,?)').get(loser.appointmentId, competitor.id)).toEqual({ n: 0 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE appointment_id=? AND active=1').get(winner.appointmentId)).toEqual({ n: 2 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_hold_reservations WHERE hold_id=? AND active=1').get(live.id)).toEqual({ n: 0 });
      expect(database.query('SELECT status,appointment_id,revision FROM calendar_holds WHERE id=?').get(live.id))
        .toEqual({ status: 'confirmed', appointment_id: winner.appointmentId, revision: 2 });
    });
  } finally { await f.close(); }
}, 120_000);

test('native multi-resource appointment/block races, intent conflicts and stale revisions roll back every reservation', async () => {
  const f = await fixture(), scope = applicationServiceDataScope();
  try {
    for (const [id, kind] of [['person', 'person'], ['room', 'room'], ['other-person', 'person']] as const) {
      const input = resource(scope, id, kind);
      await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
    }
    const candidates = [appointment(scope, 'first'), appointment(scope, 'second', ['other-person', 'room'])];
    const outcomes = await Promise.allSettled(candidates.map(input => f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', input, input.requestId, guard)));
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find(outcome => outcome.status === 'rejected');
    expect(failed).toMatchObject({ status: 'rejected', reason: { code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' } });
    const winnerIndex = outcomes.findIndex(outcome => outcome.status === 'fulfilled'), loserIndex = 1 - winnerIndex;
    const winner = candidates[winnerIndex]!, loser = candidates[loserIndex]!;
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: loser.requestId }, guard)).toBeNull();
    expect((await f.runtime.read<CalendarAppointmentPage>(scope, 'calendar.appointments', { actor: actor(scope), resourceIds: [loser.resourceIds[0]!], ...range }, guard)).items).toEqual([]);
    await expect(f.runtime.write(scope, 'calendar.appointment.create', { ...winner, title: 'different intent' }, winner.requestId, guard)).rejects.toMatchObject({ code: 'CALENDAR_INTENT_CONFLICT', outcome: 'not-committed' });
    const move = { actor: actor(scope), requestId: 'stale-move', id: winner.id, expectedRevision: 99,
      startAt: '2026-12-01T13:00:00.000Z', endAt: '2026-12-01T14:00:00.000Z', timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    await expect(f.runtime.write(scope, 'calendar.appointment.reschedule', move, move.requestId, guard)).rejects.toMatchObject({ code: 'CALENDAR_REVISION_CONFLICT' });
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: move.requestId }, guard)).toBeNull();
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: actor(scope), id: winner.id }, guard)).toMatchObject({ revision: 1, startAt: winner.startAt, title: winner.title });
    const cancel = { actor: actor(scope), requestId: 'cancel-winner', id: winner.id, expectedRevision: 1, confirmed: true };
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.cancel', cancel, cancel.requestId, guard)).toMatchObject({ revision: 2, changed: true });
    expect((await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', { actor: actor(scope), resourceIds: ['person', 'room', 'other-person'], ...range }, guard)).items).toEqual([]);
    await f.runtime.write(scope, 'calendar.appointment.create', loser, loser.requestId, guard);
    const raceSlot = { startAt: '2026-12-01T14:00:00.000Z', endAt: '2026-12-01T15:00:00.000Z' };
    const raceAppointment = { ...appointment(scope, 'cross-kind-appointment'), ...raceSlot, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 };
    const raceBlock = { ...block(scope, 'cross-kind-block', ['other-person', 'room']), ...raceSlot };
    const crossKind = await Promise.allSettled([
      f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', raceAppointment, raceAppointment.requestId, guard),
      f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.block.create', raceBlock, raceBlock.requestId, guard),
    ]);
    expect(crossKind.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(crossKind.find(outcome => outcome.status === 'rejected')).toMatchObject({ status: 'rejected', reason: { code: 'CALENDAR_BOOKING_CONFLICT', outcome: 'not-committed' } });
    const appointmentWon = crossKind[0]!.status === 'fulfilled', crossLoser = appointmentWon ? raceBlock : raceAppointment;
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: crossLoser.requestId }, guard)).toBeNull();
    expect((await f.runtime.read<CalendarAppointmentPage>(scope, 'calendar.appointments', { actor: actor(scope), resourceIds: ['person', 'room', 'other-person'], ...raceSlot }, guard)).items.map(item => item.id))
      .toEqual(appointmentWon ? [raceAppointment.id] : []);
    expect((await f.runtime.read<CalendarBlockPage>(scope, 'calendar.blocks', { actor: actor(scope), resourceIds: ['person', 'room', 'other-person'], ...raceSlot }, guard)).items.map(item => item.id))
      .toEqual(appointmentWon ? [] : [raceBlock.id]);
    expect((await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', { actor: actor(scope), resourceIds: [appointmentWon ? 'other-person' : 'person'], ...raceSlot }, guard)).items).toEqual([]);
    const raceBusy = await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', { actor: actor(scope), resourceIds: ['person', 'room', 'other-person'], ...raceSlot }, guard);
    expect(raceBusy.items).toHaveLength(2); expect(JSON.stringify(raceBusy)).not.toContain('SYNTHETIC_PRIVATE'); expect(JSON.stringify(raceBusy)).not.toContain('cross-kind');
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('SELECT count(*) AS n FROM calendar_appointments').get()).toEqual({ n: appointmentWon ? 3 : 2 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE active=1').get()).toEqual({ n: appointmentWon ? 4 : 2 });
      expect(database.query('SELECT count(*) AS n FROM calendar_blocks').get()).toEqual({ n: appointmentWon ? 0 : 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_block_reservations WHERE active=1').get()).toEqual({ n: appointmentWon ? 0 : 2 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_receipts WHERE request_id=?').get(crossLoser.requestId)).toEqual({ n: 0 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_block_receipts WHERE request_id=?').get(crossLoser.requestId)).toEqual({ n: 0 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_receipts WHERE request_id=?').get(move.requestId)).toEqual({ n: 0 });
    });
  } finally { await f.close(); }
}, 120_000);

test('exact native receipt replay reauthorizes current grants after actual actor commits and restart', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), delegated = actor(scope, 'synthetic-delegate', false);
  try {
    const input = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
    const grant = { actor: actor(scope), requestId: 'grant-book', id: input.id, expectedRevision: 1, userId: delegated.userId, grants: ['busy', 'book'] };
    await f.runtime.write(scope, 'calendar.resource.grant', grant, grant.requestId, guard);
    const booking = { ...appointment(scope, 'delegated', ['person']), actor: delegated };
    const accepted = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', booking, booking.requestId, guard);
    expect(JSON.stringify(accepted)).not.toContain(booking.title);
    const busy = await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', { actor: delegated, resourceIds: ['person'], ...range }, guard);
    expect(busy.items).toEqual([{ resourceId: 'person', startAt: '2026-12-01T09:55:00.000Z', endAt: '2026-12-01T11:10:00.000Z' }]);
    expect(JSON.stringify(busy)).not.toContain(booking.id); expect(JSON.stringify(busy)).not.toContain(booking.title);
    await expect(f.runtime.read(scope, 'calendar.appointment', { actor: delegated, id: booking.id }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    const revoke = { ...grant, requestId: 'revoke-book', expectedRevision: 2, grants: [] };
    await f.runtime.write(scope, 'calendar.resource.grant', revoke, revoke.requestId, guard);
    // Identical actor/request hits the real retained native transport receipt,
    // then the runtime must deny its current-authority reconciliation query.
    await expect(f.runtime.write(scope, 'calendar.appointment.create', booking, booking.requestId, guard)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    await expect(f.runtime.read(scope, 'calendar.receipt', { actor: delegated, requestId: booking.requestId }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await f.restart(false);
    await expect(f.runtime.write(scope, 'calendar.appointment.create', booking, booking.requestId, guard)).rejects.toMatchObject({ code: 'CALENDAR_OUTCOME_UNKNOWN', outcome: 'unknown' });
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: actor(scope), id: booking.id }, guard)).toMatchObject({ revision: 1, title: booking.title });
    expect((await f.runtime.read<CalendarResourcePage>(scope, 'calendar.resources', { actor: delegated }, guard)).items).toEqual([]);
  } finally { await f.close(); }
}, 120_000);

test('missing established files and changed placement fail closed, then restored synthetic state reopens without replacement', async () => {
  const f = await fixture(), scope = applicationServiceDataScope();
  const retainedRoot = join(f.root, 'retained-calendar'); let moved = false;
  try {
    const input = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
    const identity = await lstat(f.path(scope)); await f.stop();
    await expect(CalendarRuntime.open({ ...f.options, config: { ...f.config, rootDirectory: join(f.root, 'different-calendar') } })).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(existsSync(join(f.root, 'different-calendar'))).toBe(false);
    await rename(f.config.rootDirectory, retainedRoot); moved = true;
    await expect(CalendarRuntime.open(f.options)).rejects.toMatchObject({ code: 'CALENDAR_STATE_INVALID' });
    expect(existsSync(f.path(scope))).toBe(false);
    await rename(retainedRoot, f.config.rootDirectory); moved = false;
    await f.restart(false);
    expect((await lstat(f.path(scope))).ino).toBe(identity.ino);
    expect((await f.runtime.read<CalendarResourcePage>(scope, 'calendar.resources', { actor: actor(scope) }, guard)).items).toMatchObject([{ id: input.id, revision: 1 }]);
  } finally {
    try { if (moved) await rename(retainedRoot, f.config.rootDirectory); }
    finally { await f.close(); }
  }
}, 120_000);

test('pending owner recovery retains identity and only an admitted creator can provision its missing synthetic file', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), user = actor(scope);
  const ownerId = 'cal_00000000-0000-4000-8000-000000000001';
  try {
    f.system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,0)')
      .run(calendarDatabaseId(user.scopeId), user.scopeId, ownerId, calendarHash(canonicalDatabaseRootIdentity(f.config.rootDirectory)), calendarRealm.fingerprint);
    await f.restart(false);
    await expect(f.runtime.read(scope, 'calendar.resources', { actor: user }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_READY' });
    const denied = { ...resource(scope), actor: { ...user, manageAll: false, createOwn: false } };
    await expect(f.runtime.write(scope, 'calendar.resource.create', denied, denied.requestId, guard)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.actors).toHaveLength(0); expect(existsSync(f.path(scope))).toBe(false);
    const input = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
    expect(f.system.prepare('SELECT owner_id,established FROM _calendar_owners').get()).toEqual({ owner_id: ownerId, established: 1 });
    await f.stop();
    inspect(f.path(scope), database => expect(database.query('SELECT owner_id,scope_id FROM _calendar_owner').get()).toEqual({ owner_id: ownerId, scope_id: user.scopeId }));
  } finally { await f.close(); }
}, 120_000);

test('native coordinator replaces an exact owned killed writer and recovers the accepted calendar receipt', async () => {
  const f = await fixture(), scope = applicationServiceDataScope();
  try {
    const input = resource(scope), accepted = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.create', input, input.requestId, guard);
    const writer = f.actors.find(entry => entry.context.role === 'writer' && entry.executor.diagnostics().state === 'ready');
    if (!writer) throw new Error('No owned synthetic writer was started.');
    const generation = writer.executor.diagnostics().generation;
    // Deliberate test-only whitebox fault injection into the exact subprocess
    // returned by this fixture's real factory; never discover/kill by PID/name.
    const child = (writer.executor as unknown as { child: { kill(signal: 'SIGKILL'): void } | null }).child;
    if (!child) throw new Error('Owned synthetic writer has no child process.');
    child.kill('SIGKILL'); await writer.executor.settled();
    expect(writer.executor.diagnostics()).toMatchObject({ exitObserved: true, settled: true });
    // These short calls release their leases. Native retirement therefore
    // settles the paired reader and retires the idle binding before a fresh
    // existing-only acquire; it need not reuse that same actor-pool slot.
    await eventually(() => f.runtime.diagnostics().fabric.databases.length === 0,
      'Native coordinator did not retire the exact killed synthetic binding.');
    // The next operation must not create a replacement empty file or lose its
    // accepted domain outcome when the new native generation opens the WAL.
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: input.requestId }, guard)).toEqual(accepted);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.create', input, input.requestId, guard)).toEqual(accepted);
    expect(f.actors.some(entry => entry.context.role === 'writer'
      && entry.executor.diagnostics().state === 'ready' && entry.executor.diagnostics().generation > generation)).toBe(true);
  } finally { await f.close(); }
}, 120_000);

test('native typed bookings preserve original labels, hold policy and binding history across full actor/SYSTEM restart', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), manager = actor(scope), now = Date.now();
  const instant = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  try {
    const type = { actor: manager, id: 'type', requestId: 'type', label: 'PRIVATE_SYNTHETIC_TYPE', durationMinutes: 30,
      bufferBeforeMinutes: 2, bufferAfterMinutes: 3 };
    await f.runtime.write(scope, 'calendar.type.create', type, type.requestId, guard);
    const provider = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', provider, provider.requestId, guard);
    const policy = { actor: manager, id: provider.id, requestId: 'type-policy', expectedRevision: 1, mode: 'required', typeIds: ['type'] };
    await f.runtime.write(scope, 'calendar.resource.types', policy, policy.requestId, guard);
    const booking = { actor: manager, id: 'typed', requestId: 'typed', resourceIds: [provider.id], title: 'PRIVATE_SYNTHETIC_TYPED_BOOKING',
      startAt: instant(60), endAt: instant(90), timeZone: 'UTC', appointmentType: { id: type.id, revision: 1 } };
    const accepted = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', booking, booking.requestId, guard);
    const hold = { actor: manager, id: 'typed-hold', requestId: 'typed-hold', resourceIds: [provider.id],
      startAt: instant(120), endAt: instant(150), timeZone: 'UTC', ttlSeconds: 900, appointmentType: { id: type.id, revision: 1 } };
    await f.runtime.write(scope, 'calendar.hold.acquire', hold, hold.requestId, guard);
    const replacement = { ...type, requestId: 'type-replace', expectedRevision: 1, label: 'PRIVATE_SYNTHETIC_RENAMED_TYPE', durationMinutes: 45, colorKey: null, active: true };
    await f.runtime.write(scope, 'calendar.type.replace', replacement, replacement.requestId, guard);
    await f.restart(false);
    expect(await f.runtime.read<CalendarAppointmentTypeView>(scope, 'calendar.type', { actor: manager, id: type.id }, guard))
      .toMatchObject({ revision: 2, label: replacement.label, durationMinutes: 45 });
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: manager, id: booking.id }, guard))
      .toMatchObject({ revision: 1, bufferBeforeMinutes: 2, bufferAfterMinutes: 3,
        appointmentType: { id: type.id, revision: 1, label: type.label, durationMinutes: 30 } });
    expect(await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: manager, id: hold.id }, guard))
      .toMatchObject({ status: 'held', appointmentType: { id: type.id, revision: 1, label: type.label } });
    await expect(f.runtime.write(scope, 'calendar.hold.confirm', { actor: manager, id: hold.id, appointmentId: 'stale-confirm',
      requestId: 'stale-confirm', expectedRevision: 1, title: 'Rejected' }, 'stale-confirm', guard))
      .rejects.toMatchObject({ code: 'CALENDAR_TYPE_STALE', outcome: 'not-committed' });
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: manager, requestId: 'stale-confirm' }, guard)).toBeNull();
    const move = { actor: manager, id: booking.id, requestId: 'move-typed', expectedRevision: 1, startAt: instant(60), endAt: instant(105),
      timeZone: 'UTC', bufferBeforeMinutes: 2, bufferAfterMinutes: 3, appointmentType: { id: type.id, revision: 2 } };
    const moved = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.reschedule', move, move.requestId, guard);
    expect(moved).toMatchObject({ revision: 2, changed: true });
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', booking, booking.requestId, guard)).toEqual(accepted);
    await f.restart(false);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.reschedule', move, move.requestId, guard)).toEqual(moved);
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: manager, id: booking.id }, guard))
      .toMatchObject({ revision: 2, appointmentType: { id: type.id, revision: 2, label: replacement.label, durationMinutes: 45 } });
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('SELECT appointment_revision,type_revision FROM _calendar_appointment_type_bindings ORDER BY appointment_revision').all())
        .toEqual([{ appointment_revision: 1, type_revision: 1 }, { appointment_revision: 2, type_revision: 2 }]);
      expect(database.query('SELECT type_revision FROM _calendar_hold_type_bindings').all()).toEqual([{ type_revision: 1 }]);
      expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  } finally { await f.close(); }
}, 120_000);

test('native lifecycle policy, private reasons, terminal occupancy and original outcomes survive full actor/SYSTEM restart', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), manager = actor(scope);
  try {
    const provider = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', provider, provider.requestId, guard);
    const policy = { actor: manager, requestId: 'lifecycle-policy', expectedRevision: 1, extended: true, cancellationReason: 'required', noShowReason: 'required' };
    const policyReceipt = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.lifecycle.replace', policy, policy.requestId, guard);
    const booking = { actor: manager, id: 'lifecycle-visit', requestId: 'lifecycle-visit', resourceIds: [provider.id], title: 'PRIVATE_SYNTHETIC_VISIT',
      startAt: '2026-12-01T09:00:00.000Z', endAt: '2026-12-01T10:00:00.000Z', timeZone: 'UTC' };
    await f.runtime.write(scope, 'calendar.appointment.create', booking, booking.requestId, guard);
    await expect(f.runtime.write(scope, 'calendar.appointment.cancel', { actor: manager, id: booking.id, requestId: 'missing-reason', expectedRevision: 1, confirmed: true }, 'missing-reason', guard))
      .rejects.toMatchObject({ code: 'CALENDAR_REASON_REQUIRED', outcome: 'not-committed' });
    const transition = { actor: manager, id: booking.id, requestId: 'no-show', expectedRevision: 1, policyRevision: 2, status: 'no-show', reason: 'PRIVATE_SYNTHETIC_REASON' };
    const receipt = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.transition', transition, transition.requestId, guard);
    await f.restart(false);
    expect(await f.runtime.read<CalendarLifecyclePolicy>(scope, 'calendar.lifecycle', { actor: manager }, guard))
      .toEqual({ revision: 2, extended: true, cancellationReason: 'required', noShowReason: 'required' });
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.lifecycle.replace', policy, policy.requestId, guard)).toEqual(policyReceipt);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.transition', transition, transition.requestId, guard)).toEqual(receipt);
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: manager, id: booking.id }, guard))
      .toMatchObject({ revision: 2, status: 'confirmed', lifecycle: { revision: 2, policyRevision: 2, status: 'no-show', reason: transition.reason } });
    expect((await f.runtime.read<CalendarAppointmentTransitions>(scope, 'calendar.appointmentTransitions', { actor: manager, id: booking.id }, guard)).allowed).toEqual([]);
    expect((await f.runtime.read<CalendarBusyPage>(scope, 'calendar.busy', { actor: manager, resourceIds: [provider.id], ...range }, guard)).items).toHaveLength(1);
    await expect(f.runtime.write(scope, 'calendar.appointment.cancel', { actor: manager, id: booking.id, requestId: 'bypass', expectedRevision: 2, confirmed: true, reason: 'Rejected' }, 'bypass', guard))
      .rejects.toMatchObject({ code: 'CALENDAR_TRANSITION_INVALID', outcome: 'not-committed' });
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: manager, requestId: 'bypass' }, guard)).toBeNull();
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('SELECT status,reason FROM _calendar_appointment_lifecycle_history').all()).toEqual([{ status: 'no-show', reason: transition.reason }]);
      expect(database.query('SELECT active FROM _calendar_reservations').all()).toEqual([{ active: 1 }]);
      expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  } finally { await f.close(); }
}, 120_000);

test('native visit bindings retain original location history and transfer holds across complete actor/SYSTEM restart', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), manager = actor(scope), now = Date.now();
  const instant = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
  try {
    const provider = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', provider, provider.requestId, guard);
    const location = { actor: manager, id: 'visit-location', requestId: 'visit-location', label: 'PRIVATE_SYNTHETIC_VISIT_LOCATION', region: 'US-IN' };
    await f.runtime.write(scope, 'calendar.location.create', location, location.requestId, guard);
    await f.runtime.write(scope, 'calendar.resource.locations', { actor: manager, id: provider.id, requestId: 'visit-assign', expectedRevision: 1, locationIds: [location.id] }, 'visit-assign', guard);
    const visit = { mode: 'in-person', location: { id: location.id, revision: 1 } };
    const booking = { actor: manager, id: 'visit-booking', requestId: 'visit-booking', resourceIds: [provider.id], title: 'PRIVATE_SYNTHETIC_VISIT',
      startAt: instant(60), endAt: instant(90), timeZone: 'UTC', visit };
    const created = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', booking, booking.requestId, guard);
    const hold = { actor: manager, id: 'visit-hold', requestId: 'visit-hold', resourceIds: [provider.id], startAt: instant(120), endAt: instant(150), timeZone: 'UTC', ttlSeconds: 900, visit };
    await f.runtime.write(scope, 'calendar.hold.acquire', hold, hold.requestId, guard);
    await f.runtime.write(scope, 'calendar.location.replace', { actor: manager, id: location.id, requestId: 'visit-rename', expectedRevision: 1,
      label: 'PRIVATE_SYNTHETIC_NEW_LABEL', region: 'US-GA', active: false }, 'visit-rename', guard);
    await f.restart(false);
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: manager, id: booking.id }, guard))
      .toMatchObject({ revision: 1, visit: { mode: 'in-person', location: { id: location.id, revision: 1, label: location.label, region: 'US-IN' } } });
    expect(await f.runtime.read<CalendarHoldView>(scope, 'calendar.hold', { actor: manager, id: hold.id }, guard))
      .toMatchObject({ status: 'held', visit: { mode: 'in-person', location: { id: location.id, revision: 1, label: location.label } } });
    await expect(f.runtime.write(scope, 'calendar.hold.confirm', { actor: manager, id: hold.id, appointmentId: 'visit-rejected', requestId: 'visit-stale-confirm',
      expectedRevision: 1, title: 'Rejected' }, 'visit-stale-confirm', guard)).rejects.toMatchObject({ code: 'CALENDAR_VISIT_STALE', outcome: 'not-committed' });
    const changed = { actor: manager, id: booking.id, requestId: 'visit-phone', expectedRevision: 1, startAt: booking.startAt, endAt: booking.endAt,
      timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0, visit: { mode: 'phone' } };
    const updated = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.reschedule', changed, changed.requestId, guard);
    const videoHold = { actor: manager, id: 'video-hold', requestId: 'video-hold', resourceIds: [provider.id], startAt: instant(180), endAt: instant(210), timeZone: 'UTC', ttlSeconds: 900, visit: { mode: 'video' } };
    await f.runtime.write(scope, 'calendar.hold.acquire', videoHold, videoHold.requestId, guard);
    const confirmation = { actor: manager, id: videoHold.id, appointmentId: 'video-booking', requestId: 'video-confirm', expectedRevision: 1, title: 'PRIVATE_SYNTHETIC_VIDEO' };
    const confirmed = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.confirm', confirmation, confirmation.requestId, guard);
    await f.restart(false);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', booking, booking.requestId, guard)).toEqual(created);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.reschedule', changed, changed.requestId, guard)).toEqual(updated);
    expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.hold.confirm', confirmation, confirmation.requestId, guard)).toEqual(confirmed);
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: manager, id: booking.id }, guard)).toMatchObject({ revision: 2, visit: { mode: 'phone' } });
    expect(await f.runtime.read<CalendarAppointmentView>(scope, 'calendar.appointment', { actor: manager, id: confirmed.id }, guard)).toMatchObject({ visit: { mode: 'video' } });
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('SELECT visit_mode,location_revision FROM _calendar_appointment_visit_bindings WHERE appointment_id=? ORDER BY appointment_revision').all(booking.id))
        .toEqual([{ visit_mode: 'in-person', location_revision: 1 }, { visit_mode: 'phone', location_revision: null }]);
      expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  } finally { await f.close(); }
}, 120_000);

test('native location/assignment history, current facets and original receipts survive full scope-owner restart', async () => {
  const f = await fixture(), scope = applicationServiceDataScope(), manager = actor(scope);
  try {
    expect(await f.runtime.read<CalendarLocationPage>(scope, 'calendar.locations', { actor: manager }, guard))
      .toEqual({ items: [], truncated: false, nextAfter: null });
    const location = { actor: manager, id: 'location', requestId: 'location', label: 'PRIVATE_SYNTHETIC_LOCATION', region: 'US-IN' };
    await expect(f.runtime.write(scope, 'calendar.location.create', { ...location, actor: { ...manager, manageAll: false } }, location.requestId, guard))
      .rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    expect(f.actors).toHaveLength(0);
    const created = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.location.create', location, location.requestId, guard);
    const provider = resource(scope); await f.runtime.write(scope, 'calendar.resource.create', provider, provider.requestId, guard);
    const assign = { actor: manager, id: provider.id, requestId: 'assign-location', expectedRevision: 1, locationIds: [location.id] };
    const assigned = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.resource.locations', assign, assign.requestId, guard);
    const replace = { actor: manager, id: location.id, requestId: 'replace-location', expectedRevision: 1,
      label: 'PRIVATE_SYNTHETIC_RENAMED', region: 'US-IN', active: false };
    const replaced = await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.location.replace', replace, replace.requestId, guard);
    await f.restart(false);
    for (const [name, command, receipt] of [['calendar.location.create', location, created], ['calendar.resource.locations', assign, assigned],
      ['calendar.location.replace', replace, replaced]] as const) {
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: manager, requestId: command.requestId }, guard)).toEqual(receipt);
      expect(await f.runtime.write<CalendarCommandReceipt>(scope, name, command, command.requestId, guard)).toEqual(receipt);
    }
    expect(await f.runtime.read<CalendarLocationView>(scope, 'calendar.location', { actor: manager, id: location.id }, guard))
      .toMatchObject({ id: location.id, revision: 2, active: false, label: replace.label });
    expect(await f.runtime.read<CalendarResourceLocationsView>(scope, 'calendar.resourceLocations', { actor: manager, id: provider.id }, guard))
      .toEqual({ resourceId: provider.id, resourceRevision: 2, locationIds: [location.id] });
    const page = await f.runtime.read<CalendarResourcePage>(scope, 'calendar.resources', { actor: manager, locationIds: [location.id], regions: ['US-IN'] }, guard);
    expect(page.items.map(item => item.id)).toEqual([provider.id]);
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('SELECT label FROM _calendar_location_history ORDER BY location_revision').all())
        .toEqual([{ label: location.label }, { label: replace.label }]);
      expect(database.query('SELECT resource_revision,location_id FROM _calendar_resource_location_current').all())
        .toEqual([{ resource_revision: 2, location_id: location.id }]);
      expect(database.query('PRAGMA foreign_key_check').all()).toEqual([]);
    });
  } finally { await f.close(); }
}, 120_000);

test('real dedicated actor loads the matching realm with an empty inherited environment', async () => {
  const name = 'ZERO_CALENDAR_FILE_RUNTIME_PARENT_SECRET', previous = process.env[name];
  process.env[name] = 'synthetic-parent-only-no-real-secret';
  let f: Awaited<ReturnType<typeof fixture>> | null = null;
  try {
    f = await fixture((defaults, root, config) => {
      const launch = databaseActorFactoryLaunch(defaults.createExecutor)!;
      const prefix = [launch.prefix[0]!, '--no-env-file', '--preload',
        fileURLToPath(new URL('./test-support/file-runtime-actor-preload.ts', import.meta.url)),
        defaults.defaultActorEntrypoint!, '--synthetic-calendar-environment-proof=' + join(root, 'environment-proof')] as const;
      // Only this additional probe uses a trusted launch override. It preserves
      // the default fixed actor entry, no-env-file and empty explicit env; all
      // other tests exercise the untouched default factory.
      return resolveCalendarPersistenceConfig(config, root, { launch: { kind: 'command-prefix', commandPrefix: prefix }, env: launch.env });
    });
    const scope = applicationServiceDataScope(), input = resource(scope);
    await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
    expect((await f.runtime.read<CalendarResourcePage>(scope, 'calendar.resources', { actor: actor(scope) }, guard)).items).toMatchObject([{ id: input.id }]);
    const proofs = (await readdir(f.root)).filter(name => name.startsWith('environment-proof-'));
    expect(proofs.some(name => name.includes('-writer-'))).toBe(true);
    expect(proofs.some(name => name.includes('-reader-'))).toBe(true);
    for (const proof of proofs) expect(await readFile(join(f.root, proof), 'utf8')).toBe('synthetic parent environment absent\n');
  } finally {
    try { await f?.close(); }
    finally { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; }
  }
}, 120_000);

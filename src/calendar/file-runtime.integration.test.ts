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
import type { CalendarActor, CalendarAppointmentPage, CalendarAppointmentView, CalendarBusyPage, CalendarCommandReceipt, CalendarResourcePage } from './contracts';
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
    for (const name of ['calendar.busy', 'calendar.appointments']) {
      expect(await f.runtime.read<CalendarBusyPage | CalendarAppointmentPage>(scope, name, { actor: user, resourceIds: [], ...range }, guard)).toEqual({ items: [], truncated: false });
    }
    expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: user, requestId: 'missing' }, guard)).toBeNull();
    await expect(f.runtime.read(scope, 'calendar.appointment', { actor: user, id: 'missing' }, guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
    await expect(f.runtime.write(scope, 'calendar.appointment.create', appointment(scope, 'missing'), 'book-missing', guard)).rejects.toMatchObject({ code: 'CALENDAR_NOT_FOUND' });
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

test('native calendar actors persist separate scope files and exact safe receipts across full SYSTEM restart', async () => {
  const f = await fixture(), scopes = [applicationServiceDataScope(), trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'synthetic-tenant' })];
  try {
    const receipts = await Promise.all(scopes.map(async scope => {
      for (const id of ['person', 'room']) {
        const input = resource(scope, id, id === 'room' ? 'room' : 'person');
        await f.runtime.write(scope, 'calendar.resource.create', input, input.requestId, guard);
      }
      const input = appointment(scope, 'same-id');
      return f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', input, input.requestId, guard);
    }));
    expect(f.system.prepare('SELECT count(*) AS n FROM _calendar_owners WHERE established=1').get()).toEqual({ n: 2 });
    const files = await Promise.all(scopes.map(async scope => ({ path: f.path(scope), identity: await lstat(f.path(scope)) })));
    expect(files[0]!.path).not.toBe(files[1]!.path);
    expect(f.actors.some(entry => entry.context.role === 'writer' && entry.executor.diagnostics().state === 'ready')).toBe(true);
    expect(f.actors.some(entry => entry.context.role === 'reader' && entry.executor.diagnostics().state === 'ready')).toBe(true);
    await f.restart(false);
    for (const [index, scope] of scopes.entries()) {
      const input = appointment(scope, 'same-id');
      expect(await f.runtime.read<CalendarCommandReceipt | null>(scope, 'calendar.receipt', { actor: actor(scope), requestId: input.requestId }, guard)).toEqual(receipts[index]);
      expect(await f.runtime.write<CalendarCommandReceipt>(scope, 'calendar.appointment.create', input, input.requestId, guard)).toEqual(receipts[index]);
      expect((await f.runtime.read<CalendarAppointmentPage>(scope, 'calendar.appointments', { actor: actor(scope), resourceIds: ['person'], ...range }, guard)).items)
        .toMatchObject([{ id: 'same-id', revision: 1, resourceIds: ['person', 'room'] }]);
      expect((await lstat(files[index]!.path)).ino).toBe(files[index]!.identity.ino);
    }
    await expect(f.runtime.read(scopes[0]!, 'calendar.resources', { actor: actor(scopes[1]!) }, guard)).rejects.toMatchObject({ code: 'CALENDAR_FORBIDDEN' });
    await f.stop();
    for (const scope of scopes) inspect(f.path(scope), database => {
      expect(database.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      expect(database.query('SELECT count(*) AS n FROM calendar_appointments').get()).toEqual({ n: 1 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE active=1').get()).toEqual({ n: 2 });
      const retained = f.system.prepare('SELECT owner_id,scope_id FROM _calendar_owners WHERE id=?').get(calendarDatabaseId(serviceDataScopeKey(scope)));
      expect(database.query('SELECT owner_id,scope_id FROM _calendar_owner').get()).toEqual(retained);
    });
  } finally { await f.close(); }
}, 120_000);

test('native multi-resource booking races, intent conflicts and stale revisions roll back every reservation', async () => {
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
    await f.stop();
    inspect(f.path(scope), database => {
      expect(database.query('SELECT count(*) AS n FROM calendar_appointments').get()).toEqual({ n: 2 });
      expect(database.query('SELECT count(*) AS n FROM _calendar_reservations WHERE active=1').get()).toEqual({ n: 2 });
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

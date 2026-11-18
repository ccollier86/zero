/** Private, bounded Fabric owner. Request code receives only the scoped service, never this setup broker. */
import { existsSync, lstatSync } from 'node:fs';
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { DatabaseCoordinator, type DatabaseCoordinatorLease } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import type { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { canonicalDatabaseRootIdentity, createDatabaseRef, resolveDatabaseFile } from '../databases/database-file';
import { DatabaseError } from '../databases/database-error';
import { observeDatabaseCoordinatorCommits } from '../databases/database-coordinator-commit-notifications';
import { createDatabaseObservability } from '../databases/database-observability';
import type { AsyncDatabaseOperationExecutor, DatabaseSerializableValue } from '../databases/database-operations';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { ResolvedCalendarConfig } from './config';
import type { CalendarActor, CalendarCommandReceipt } from './contracts';
import { CalendarError, readCalendarRejection } from './error';
import { installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';
import type { ResolvedCalendarPersistenceConfig } from './persistence-config';
import { calendarRealm } from './realm';
import { calendarActor, calendarSelection, CALENDAR_LIMITS } from './realm-model';
import { CALENDAR_DEFAULT_LIFECYCLE_POLICY, calendarLifecyclePolicyFields, requireCalendarLifecycleManager } from './lifecycle-model';
import type { CalendarServiceBroker } from './service';
import { calendarAppointmentTypeInput, calendarAppointmentTypePageQuery, calendarLocationInput, calendarPageQuery, calendarRange, calendarResourcePageQuery, calendarVisitLocationQuery } from './service-validation';
import { normalizeCalendarInstant, normalizeCalendarTimeZone } from './time';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarScope, calendarText, calendarValue } from './validation';

export interface CalendarRuntimeSource {
  prepare(owner: CalendarOwnerRecord): void;
  wake(ref: string): void;
  close(): Promise<void>;
}
export interface CalendarRuntimeOptions {
  readonly config: ResolvedCalendarConfig;
  readonly persistence: ResolvedCalendarPersistenceConfig;
  readonly system: ReactiveDB;
  readonly installAllowed: boolean;
  readonly authority: { coordinator: AuthorityCommitCoordinator; actorContext: DatabaseActorAuthorityContext | null };
  readonly observability?: PlatformObservabilityRuntime;
  readonly source?: (coordinator: DatabaseCoordinator) => CalendarRuntimeSource;
}
const QUERIES = new Set(['calendar.resources', 'calendar.busy', 'calendar.appointments', 'calendar.appointment',
  'calendar.locations', 'calendar.location', 'calendar.resourceLocations', 'calendar.locationAssignmentWitnesses', 'calendar.visitLocations',
  'calendar.types', 'calendar.type', 'calendar.resourceTypes', 'calendar.lifecycle', 'calendar.appointmentTransitions',
  'calendar.availability', 'calendar.blocks', 'calendar.block', 'calendar.holds', 'calendar.hold', 'calendar.receipt']);
const COMMANDS = new Set(['calendar.resource.create', 'calendar.resource.grant', 'calendar.resource.availability',
  'calendar.location.create', 'calendar.location.replace', 'calendar.resource.locations',
  'calendar.type.create', 'calendar.type.replace', 'calendar.resource.types', 'calendar.lifecycle.replace', 'calendar.appointment.transition',
  'calendar.block.create', 'calendar.block.reschedule', 'calendar.block.cancel',
  'calendar.hold.acquire', 'calendar.hold.release', 'calendar.hold.confirm',
  'calendar.appointment.create', 'calendar.appointment.reschedule', 'calendar.appointment.cancel']);

export class CalendarRuntime implements CalendarServiceBroker {
  private state: 'ready' | 'closing' | 'closed' | 'close-failed' = 'ready';
  private closeTask: Promise<void> | null = null;
  private readonly stop = new AbortController();
  private readonly initializers = new Map<string, Promise<CalendarOwnerRecord>>();
  private readonly bindingRefs = new Set<string>();
  private readonly active = new Set<Promise<unknown>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pendingHints = new Set<string>();
  private hintQueued = false;
  private source: CalendarRuntimeSource | null = null;
  private removeCommit: (() => void) | null = null;
  private readonly rootHash: string;
  private constructor(private readonly options: CalendarRuntimeOptions, private readonly owner: DatabaseCoordinator) {
    this.rootHash = calendarHash(canonicalDatabaseRootIdentity(options.config.rootDirectory));
  }

  static async open(options: CalendarRuntimeOptions): Promise<CalendarRuntime> {
    if (options.persistence.defaultActorEntrypoint && !existsSync(options.persistence.defaultActorEntrypoint)) throw new CalendarError('CALENDAR_NOT_READY');
    if (!installCalendarOwnerSchema(options.system, options.installAllowed)) throw new CalendarError('CALENDAR_NOT_READY');
    const owner = new DatabaseCoordinator({
      rootDirectory: options.config.rootDirectory, realm: calendarRealm, createExecutor: options.persistence.createExecutor,
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true,
      maxDatabases: options.config.maxActiveDatabases, maxDatabaseFiles: options.config.maxDatabaseFiles,
      maxQueuedPerDatabase: 64, maxQueuedTotal: 256, queueTimeoutMs: 5000, operationTimeoutMs: 15000, sweepIntervalMs: false,
      authorityCommitCoordinator: options.authority.coordinator, requireCommitAuthority: true,
      ...(options.authority.actorContext ? { actorAuthorityContext: options.authority.actorContext } : {}),
      ...(options.observability ? { observability: createDatabaseObservability(options.observability) } : {}),
    });
    const runtime = new CalendarRuntime(options, owner);
    try {
      const records = runtime.records();
      for (const record of records) runtime.assertRetained(record);
      runtime.source = options.source?.(owner) ?? null;
      for (const record of records) runtime.source?.prepare(record);
      // The native owner alone announces actual commits, including commits whose
      // caller loses authority before acknowledgment. Replays produce no hint.
      runtime.removeCommit = observeDatabaseCoordinatorCommits(owner, ref => {
        try { runtime.source?.wake(ref); } catch { /* Durable source recovery is independent of advisory wake. */ }
        // Binding/migration is internal ownership work, not a domain change.
        // In particular do not wake an empty-scope watch before its SYSTEM
        // established fence exists. The subsequent domain commit has its own hint.
        if (!runtime.bindingRefs.has(ref)) runtime.queueHint(ref);
      });
      owner.start();
      return runtime;
    } catch (error) {
      try { await runtime.close(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Calendar startup and cleanup failed.'); }
      throw error;
    }
  }

  read<T>(scope: ServiceDataScope, name: string, input: unknown, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    return this.track(async () => {
      const operationSignal = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
      const guard = this.guard(assertCurrent, operationSignal); guard();
      const scopeId = calendarScope(serviceDataScopeKey(scope)), body = this.input(scopeId, name, input, false);
      const id = calendarDatabaseId(scopeId);
      const initializing = this.initializers.get(id);
      if (initializing) { await initializing; guard(); }
      const record = this.record(id);
      if (!record) {
        // A never-owned scope is genuinely empty; an orphan file is not.
        if (this.filePresent(id)) throw new CalendarError('CALENDAR_STATE_INVALID');
        const result = emptyCalendarRead(name, body); guard(); return result as T;
      }
      this.assertRetained(record);
      if (record.established !== 1 || record.realm_fingerprint !== calendarRealm.fingerprint) throw new CalendarError('CALENDAR_NOT_READY');
      const result = await this.execute<T>(record, 'query', name, body, guard, undefined, false, operationSignal);
      guard(); return result;
    });
  }

  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    return this.track(async () => {
      const operationSignal = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
      const guard = this.guard(assertCurrent, operationSignal); guard();
      const scopeId = calendarScope(serviceDataScopeKey(scope)), key = calendarKey(requestId), body = this.input(scopeId, name, input, true);
      if (body.requestId !== key) throw new CalendarError('CALENDAR_INPUT_INVALID');
      const id = calendarDatabaseId(scopeId), existing = this.record(id);
      if (!existing || existing.established === 0 && !this.filePresent(id)) assertCalendarProvisionAllowed(name, body);
      const record = await this.ensure(id, scopeId, guard, operationSignal); guard();
      const actor = calendarActor(body.actor);
      // Fabric transport receipts are separate from the stable domain identity.
      // Changed actor capabilities must re-enter calendarIntent with current rights.
      // A reviewed realm upgrade gets a new native transport namespace, while
      // the domain receipt remains bound to the original principal/request.
      // Otherwise a retained native receipt's old realm fingerprint would
      // falsely reject reconciliation after a legitimate migration.
      // An assignment's live visibility proof may change during reconciliation.
      // It selects a native transport attempt, not a new logical domain intent;
      // calendarIntent still compares the original scope/principal/key digest.
      const transportKey = 'calendar-command:' + calendarHash([calendarRealm.fingerprint, actor, key, name,
        ...(name === 'calendar.resource.locations' ? [body.locationWitnesses ?? null] : [])]);
      const result = await this.execute<CalendarCommandReceipt>(record, 'command', name, body, guard, transportKey, false, operationSignal);
      try {
        guard();
        // Native exact replay does not rerun a command handler. Reauthorize the
        // immutable receipt against CURRENT object grants before returning it.
        const current = await this.execute<CalendarCommandReceipt | null>(record, 'query', 'calendar.receipt', { actor, requestId: key }, guard, undefined, false, operationSignal);
        guard();
        if (current === null || calendarHash(current) !== calendarHash(result)) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
      } catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
      return result as T;
    });
  }

  /** Payload-free invalidation only. Consumers must requery and fence authority before delivery. */
  subscribe(scope: ServiceDataScope, listener: () => void): () => void {
    this.assertReady();
    if (typeof listener !== 'function') throw new CalendarError('CALENDAR_INPUT_INVALID');
    if ([...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0) >= 1024) throw new CalendarError('CALENDAR_CAPACITY');
    const ref = createDatabaseRef(calendarDatabaseId(serviceDataScopeKey(scope)));
    let entries = this.listeners.get(ref); if (!entries) this.listeners.set(ref, entries = new Set());
    entries.add(listener);
    return () => { entries!.delete(listener); if (!entries!.size && this.listeners.get(ref) === entries) this.listeners.delete(ref); };
  }

  diagnostics() { return { state: this.state, activeOperations: this.active.size, initializingScopes: this.initializers.size, fabric: this.owner.diagnostics() }; }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'closing'; this.listeners.clear(); this.pendingHints.clear();
    const task = (async () => {
      // Cancellation removes queued admission, not an already-dispatched actor
      // effect. Keep its lease/occupancy until the bounded native operation has
      // actually settled; a caller-side race is not proof of physical drainage.
      await Promise.allSettled([...this.active]);
      this.removeCommit?.(); this.removeCommit = null;
      const failures: unknown[] = [];
      try { await this.source?.close(); } catch (error) { failures.push(error); }
      try { await this.owner.close(); } catch (error) { failures.push(error); }
      this.state = failures.length ? 'close-failed' : 'closed';
      if (failures.length) throw new AggregateError(failures, 'Calendar shutdown failed.');
    })();
    this.closeTask = task;
    // Native shutdown can quarantine an actor whose physical settlement is not
    // yet confirmed. Preserve the failed state, but permit a later close retry
    // to finish releasing that same owner after settlement; never reopen intake.
    void task.catch(() => { if (this.closeTask === task) this.closeTask = null; });
    this.stop.abort(new CalendarError('CALENDAR_NOT_READY'));
    return task;
  }

  private records(): CalendarOwnerRecord[] {
    const records = this.options.system.prepare('SELECT * FROM _calendar_owners ORDER BY id LIMIT ?').all(this.options.config.maxDatabaseFiles + 1) as CalendarOwnerRecord[];
    if (records.length > this.options.config.maxDatabaseFiles) throw new CalendarError('CALENDAR_CAPACITY');
    return records;
  }
  private record(id: string): CalendarOwnerRecord | null {
    return this.options.system.prepare('SELECT * FROM _calendar_owners WHERE id=?').get(id) as CalendarOwnerRecord | null;
  }
  private filePresent(id: string): boolean { return calendarFileIsPresent(this.options.config.rootDirectory, id); }
  private assertRetained(record: CalendarOwnerRecord): void {
    assertCalendarOwnerRecord(record, this.rootHash, calendarRealm.fingerprint, this.options.installAllowed);
    if (record.established === 1 && !this.filePresent(record.id)) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  private input(scopeId: string, name: string, input: unknown, write: boolean): Record<string, unknown> {
    if (!(write ? COMMANDS : QUERIES).has(name)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const body = calendarRecord(calendarValue(input));
    const actor = calendarActor(body.actor);
    if (actor.scopeId !== scopeId) throw new CalendarError('CALENDAR_FORBIDDEN');
    const { actor: _actor, ...query } = body;
    if (name === 'calendar.resources') return { ...calendarResourcePageQuery(query, this.options.config), actor };
    if (name === 'calendar.locations') return { ...calendarPageQuery(query, this.options.config), actor };
    if (name === 'calendar.visitLocations') return { ...calendarVisitLocationQuery(query, this.options.config), actor };
    if (name === 'calendar.types') return { ...calendarAppointmentTypePageQuery(query, this.options.config), actor };
    if (name === 'calendar.busy' || name === 'calendar.appointments' || name === 'calendar.blocks' || name === 'calendar.holds') return { ...calendarRange(query, this.options.config), actor };
    if ((name === 'calendar.appointment.create' || name === 'calendar.block.create' || name === 'calendar.hold.acquire')
      && (!Array.isArray(body.resourceIds) || body.resourceIds.length > this.options.config.maxResources)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    return body;
  }
  private async ensure(id: string, scopeId: string, guard: () => void, signal?: AbortSignal): Promise<CalendarOwnerRecord> {
    const retained = this.record(id);
    if (retained?.established === 1 && retained.realm_fingerprint === calendarRealm.fingerprint) {
      this.assertRetained(retained);
      if (retained.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
      return retained;
    }
    let task = this.initializers.get(id);
    if (!task) {
      const ref = createDatabaseRef(id); this.bindingRefs.add(ref);
      task = this.bind(id, scopeId, guard, signal).finally(() => { this.bindingRefs.delete(ref); }); this.initializers.set(id, task);
      void task.finally(() => { if (this.initializers.get(id) === task) this.initializers.delete(id); }).catch(() => {});
    }
    const record = await task; guard(); return record;
  }
  private async bind(id: string, scopeId: string, guard: () => void, signal?: AbortSignal): Promise<CalendarOwnerRecord> {
    let record!: CalendarOwnerRecord;
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); const prior = this.record(id);
      if (prior) { this.assertRetained(prior); if (prior.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID'); record = prior; return; }
      if (this.filePresent(id)) throw new CalendarError('CALENDAR_STATE_INVALID');
      if (this.records().length >= this.options.config.maxDatabaseFiles) throw new CalendarError('CALENDAR_CAPACITY');
      record = { id, scope_id: scopeId, owner_id: 'cal_' + crypto.randomUUID(), root_hash: this.rootHash, realm_fingerprint: calendarRealm.fingerprint, established: 0 };
      this.options.system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,0)')
        .run(id, scopeId, record.owner_id, this.rootHash, calendarRealm.fingerprint);
    }), signal ? { signal } : {});
    guard(); this.source?.prepare(record);
    await this.execute(record, 'command', 'calendar.owner.bind', { ownerId: record.owner_id, scopeId }, guard,
      'calendar-owner:' + record.owner_id + ':' + calendarRealm.fingerprint, record.established === 0, signal);
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); const current = this.record(id);
      if (!current || current.owner_id !== record.owner_id || current.scope_id !== scopeId || current.root_hash !== this.rootHash) throw new CalendarError('CALENDAR_STATE_INVALID');
      this.options.system.prepare('UPDATE _calendar_owners SET established=1,realm_fingerprint=? WHERE id=? AND owner_id=?').run(calendarRealm.fingerprint, id, record.owner_id);
    }), signal ? { signal } : {});
    guard(); const established = { ...record, established: 1, realm_fingerprint: calendarRealm.fingerprint };
    this.source?.prepare(established); return established;
  }

  private async execute<T>(record: CalendarOwnerRecord, kind: 'query' | 'command', name: string, input: unknown,
    guard: () => void, requestId?: string, provision = false, signal?: AbortSignal): Promise<T> {
    guard();
    const authority = createDatabaseCommitAuthority(this.options.authority.coordinator, record.id, () => { guard(); return undefined; });
    // Existing-only admission closes the check/open race: established storage
    // can NEVER be replaced with a newly allocated empty file.
    const lease = provision ? await this.owner.acquire(record.id, { commitAuthority: authority })
      : await this.owner.acquireExisting(record.id, { commitAuthority: authority });
    if (!lease) throw new CalendarError('CALENDAR_STATE_INVALID');
    let accepted = false;
    try {
      guard();
      const data = createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor, assertReadAuthority: () => { guard(); return undefined; } });
      if (!provision) await this.verifyOwner(lease, record, guard, signal);
      guard();
      const result = kind === 'query'
        ? await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' }, ...(signal ? { signal } : {}) })
        : await data.command(name, input as DatabaseSerializableValue, { idempotencyKey: requestId!, ...(signal ? { signal } : {}) });
      accepted = kind === 'command';
      guard();
      if (kind === 'query') return result.value as T;
      const command = result.value as { kind?: string; name?: string; output?: unknown } | null;
      const envelope = command?.output as { ok?: boolean; value?: unknown } | null;
      if (command?.kind !== 'command' || command.name !== name || envelope?.ok !== true || !Object.hasOwn(envelope, 'value')) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
      return envelope.value as T;
    } catch (error) {
      if (kind === 'command' && (accepted || error instanceof DatabaseError && error.outcome === 'unknown')) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
      const rejection = readCalendarRejection(error); if (rejection) throw rejection;
      if (error instanceof DatabaseError && error.code === 'DATABASE_CONFLICT' && error.outcome === 'not-committed'
        && error.details.conflictType === 'idempotency-key-reused') throw new CalendarError('CALENDAR_INTENT_CONFLICT', 'not-committed');
      throw error;
    } finally { lease.release(); }
  }
  private async verifyOwner(lease: DatabaseCoordinatorLease, record: CalendarOwnerRecord, guard: () => void, signal?: AbortSignal): Promise<void> {
    const data = createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor, assertReadAuthority: () => { guard(); return undefined; } });
    const result = await data.get('_calendar_owner', 'application', { consistency: { mode: 'strong' }, ...(signal ? { signal } : {}) }); guard();
    if (!result.value || result.value.owner_id !== record.owner_id || result.value.scope_id !== record.scope_id) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  private guard(assertCurrent: () => void, signal?: AbortSignal): () => void {
    return () => {
      if (this.state !== 'ready') throw new CalendarError('CALENDAR_NOT_READY');
      signal?.throwIfAborted();
      const result: unknown = assertCurrent();
      if (result !== undefined) { void Promise.resolve(result).catch(() => {}); throw new CalendarError('CALENDAR_CONFIG_INVALID'); }
    };
  }
  private assertReady(): void { if (this.state !== 'ready') throw new CalendarError('CALENDAR_NOT_READY'); }
  private track<T>(run: () => Promise<T>): Promise<T> {
    try { this.assertReady(); } catch (error) { return Promise.reject(error); }
    const pending = run(); this.active.add(pending);
    return pending.finally(() => { this.active.delete(pending); });
  }
  private queueHint(ref: string): void {
    if (this.state !== 'ready' || !this.listeners.has(ref)) return;
    this.pendingHints.add(ref); if (this.hintQueued) return; this.hintQueued = true;
    queueMicrotask(() => {
      this.hintQueued = false; const refs = [...this.pendingHints]; this.pendingHints.clear();
      if (this.state !== 'ready') return;
      for (const ref of refs) for (const listener of [...this.listeners.get(ref) ?? []]) try { listener(); } catch { /* Advisory only. */ }
    });
  }
}

/** Pure identity admission, shared by the bounded in-memory contract tests. */
export function calendarDatabaseId(scopeId: string): string { return 'calendar:' + calendarHash(calendarScope(scopeId)); }
function calendarFileIsPresent(root: string, id: string): boolean {
  try { lstatSync(resolveDatabaseFile(root, id).path); return true; }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false;
    throw new CalendarError('CALENDAR_STATE_INVALID');
  }
}
export function assertCalendarOwnerRecord(record: CalendarOwnerRecord, rootHash: string, fingerprint: string, installAllowed: boolean): void {
  try { calendarScope(record.scope_id); } catch { throw new CalendarError('CALENDAR_STATE_INVALID'); }
  if (record.id !== calendarDatabaseId(record.scope_id) || !/^cal_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(record.owner_id)
    || ![0, 1].includes(record.established) || !/^sha256:[a-f0-9]{64}$/.test(record.realm_fingerprint) || record.root_hash !== rootHash) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (!installAllowed && record.realm_fingerprint !== fingerprint) throw new CalendarError('CALENDAR_NOT_READY');
}
/** Never-owned scopes need no SQLite file. Mirror canonical query admission, not an error-to-empty fallback. */
export function emptyCalendarRead(name: string, input: unknown): unknown {
  const fields = name === 'calendar.resources' ? ['actor', 'limit', 'after', 'locationIds', 'regions']
    : name === 'calendar.locations' ? ['actor', 'limit', 'after']
    : name === 'calendar.types' ? ['actor', 'limit', 'after', 'resourceIds']
    : name === 'calendar.visitLocations' ? ['actor', 'resourceIds', 'limit', 'after']
    : name === 'calendar.locationAssignmentWitnesses' ? ['actor', 'locationIds']
    : name === 'calendar.lifecycle' ? ['actor']
    : name === 'calendar.receipt' ? ['actor', 'requestId'] : ['calendar.appointment', 'calendar.appointmentTransitions', 'calendar.block', 'calendar.hold', 'calendar.availability', 'calendar.location', 'calendar.resourceLocations', 'calendar.type', 'calendar.resourceTypes'].includes(name) ? ['actor', 'id']
    : name === 'calendar.busy' || name === 'calendar.appointments' || name === 'calendar.blocks' || name === 'calendar.holds' ? ['actor', 'resourceIds', 'startAt', 'endAt', 'limit'] : null;
  if (!fields) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const r = calendarRecord(input, fields); calendarActor(r.actor);
  if (name === 'calendar.lifecycle') { requireCalendarLifecycleManager(calendarActor(r.actor)); return { ...CALENDAR_DEFAULT_LIFECYCLE_POLICY }; }
  if (name === 'calendar.visitLocations') {
    calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page); if (r.after !== undefined) calendarKey(r.after);
    if (calendarSelection(r.resourceIds).length) throw new CalendarError('CALENDAR_NOT_FOUND');
    return { items: [], truncated: false, nextAfter: null };
  }
  if (name === 'calendar.types') {
    const { actor: _actor, ...query } = r;
    const accepted = calendarAppointmentTypePageQuery(query, { maxPageSize: CALENDAR_LIMITS.page, maxResources: CALENDAR_LIMITS.selection });
    if (accepted.resourceIds?.length) throw new CalendarError('CALENDAR_NOT_FOUND');
    return { items: [], truncated: false, nextAfter: null };
  }
  if (name === 'calendar.resources' || name === 'calendar.locations') {
    calendarInteger(r.limit ?? 25, 1, CALENDAR_LIMITS.page); if (r.after !== undefined) calendarKey(r.after);
    if (name === 'calendar.resources') {
      // Pure empty-start validation matches the normal facade without creating
      // a database just to discover that there are no authorized resources.
      const { actor: _actor, ...query } = r;
      calendarResourcePageQuery(query, { maxPageSize: CALENDAR_LIMITS.page });
    }
    return { items: [], truncated: false, nextAfter: null };
  }
  if (name === 'calendar.receipt') { calendarKey(r.requestId); return null; }
  if (name === 'calendar.locationAssignmentWitnesses') {
    if (calendarSelection(r.locationIds).length) throw new CalendarError('CALENDAR_NOT_FOUND');
    return [];
  }
  if (name === 'calendar.type') {
    calendarKey(r.id);
    if (!calendarActor(r.actor).manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  if (['calendar.appointment', 'calendar.appointmentTransitions', 'calendar.block', 'calendar.hold', 'calendar.availability', 'calendar.location', 'calendar.resourceLocations', 'calendar.resourceTypes'].includes(name)) { calendarKey(r.id); throw new CalendarError('CALENDAR_NOT_FOUND'); }
  const ids = calendarSelection(r.resourceIds);
  const start = Date.parse(normalizeCalendarInstant(r.startAt)), end = Date.parse(normalizeCalendarInstant(r.endAt));
  calendarInteger(end - start, 1, CALENDAR_LIMITS.rangeMs); calendarInteger(r.limit ?? 100, 1, CALENDAR_LIMITS.page);
  if (ids.length) throw new CalendarError('CALENDAR_NOT_FOUND');
  return { items: [], truncated: false };
}
function assertCalendarProvisionAllowed(name: string, input: Record<string, unknown>): void {
  if (name === 'calendar.lifecycle.replace') {
    const r = calendarRecord(input, ['actor', 'requestId', 'expectedRevision', 'extended', 'cancellationReason', 'noShowReason']), actor = calendarActor(r.actor);
    calendarKey(r.requestId); calendarInteger(r.expectedRevision, 1);
    calendarLifecyclePolicyFields({ extended: r.extended, cancellationReason: r.cancellationReason, noShowReason: r.noShowReason });
    requireCalendarLifecycleManager(actor);
    if (r.expectedRevision !== 1) throw new CalendarError('CALENDAR_REVISION_CONFLICT');
    return;
  }
  if (name === 'calendar.type.create') {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'label', 'durationMinutes', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'colorKey', 'active']), actor = calendarActor(r.actor);
    calendarKey(r.requestId); calendarKey(r.id);
    const { actor: _actor, requestId: _requestId, id: _id, ...appointmentType } = r;
    calendarAppointmentTypeInput(appointmentType);
    if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    return;
  }
  if (name === 'calendar.location.create') {
    const r = calendarRecord(input, ['actor', 'requestId', 'id', 'label', 'region', 'active']), actor = calendarActor(r.actor);
    calendarKey(r.requestId); calendarKey(r.id);
    const { actor: _actor, requestId: _requestId, id: _id, ...location } = r;
    calendarLocationInput(location);
    if (!actor.manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    return;
  }
  if (name !== 'calendar.resource.create') throw new CalendarError('CALENDAR_NOT_FOUND');
  const r = calendarRecord(input, ['actor', 'requestId', 'id', 'label', 'kind', 'ownerId', 'timeZone']), actor = calendarActor(r.actor);
  calendarKey(r.requestId); calendarKey(r.id); calendarText(r.label, 256); normalizeCalendarTimeZone(r.timeZone);
  const ownerId = r.ownerId === null ? null : calendarKey(r.ownerId);
  if (!['person', 'room', 'equipment'].includes(r.kind as string)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  if (!actor.manageAll && !(actor.createOwn && r.kind === 'person' && ownerId === actor.userId)) throw new CalendarError('CALENDAR_FORBIDDEN');
}

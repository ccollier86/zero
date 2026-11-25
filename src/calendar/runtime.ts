/** Private, bounded Fabric owner. Request code receives only the scoped service, never this setup broker. */
import { existsSync, lstatSync } from 'node:fs';
import { serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
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
import type { DatabaseRealm } from '../databases/database-realm';
import type { CalendarSeriesNativeTransport } from './series-native-transport';
import { createCalendarSeriesNativeOwner, type CalendarSeriesNativeOwner, type CalendarSeriesNativeOwnerDependencies } from './series-runtime-owner';
import type { CalendarParticipantDirectory } from './participants-directory';
import { calendarActor, calendarSelection, CALENDAR_LIMITS } from './realm-model';
import { CALENDAR_DEFAULT_LIFECYCLE_POLICY, calendarLifecyclePolicyFields, requireCalendarLifecycleManager } from './lifecycle-model';
import type { CalendarServiceBroker } from './service';
import { calendarAppointmentTypeInput, calendarAppointmentTypePageQuery, calendarAppointmentTransportInput, calendarLocationInput, calendarPageQuery, calendarRange, calendarDateRange, calendarResourcePageQuery, calendarVisitLocationQuery } from './service-validation';
import { normalizeCalendarInstant, normalizeCalendarTimeZone } from './time';
import { calendarHash, calendarInteger, calendarKey, calendarRecord, calendarScope, calendarText, calendarValue } from './validation';
import { calendarParticipantReferences, requireCalendarParticipantManager } from './participant-bindings';
import { calendarIntegrationInput, calendarIntegrationOptions, type CalendarIntegrationCommandOptions,
  type CalendarIntegrationOwner, type CalendarIntegrationReadOptions } from './integration-runtime';
import type { CalendarIntegrationOperatorRequestReceipt } from './integration-operator-request-model';
import type { DatabaseOpenAdmission } from '../databases/database-open-admission';
import { CalendarIntegrationWakeCatalog, installCalendarIntegrationWakeCatalog, type CalendarIntegrationWakeCoverage } from './integration-wake-catalog';
import { normalizeCalendarResourceLocationPolicy } from './location-policy-model';
import { normalizeCalendarAppointmentOverride, normalizeCalendarOverrideGrant } from './override-model';

export interface CalendarRuntimeSource {
  prepare(owner: CalendarOwnerRecord): void;
  /** Optional native policy preparation. No source/SQL lease or request authority is retained across this await. */
  ready?(owner: CalendarOwnerRecord): Promise<void>;
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
  readonly source?: (coordinator: DatabaseCoordinator) => CalendarRuntimeSource | Promise<CalendarRuntimeSource>;
  /** @internal Native integrated composition only; ordinary/logging-only core stays unchanged. */
  readonly integrationWake?: true;
  /** @internal Complete private series profile. Not an authored CalendarConfig
   * field, a generic realm override or a second coordinator for the same root. */
  readonly series?: {
    readonly transport: CalendarSeriesNativeTransport;
    readonly participants?: Pick<CalendarParticipantDirectory, 'assertBindable'>;
    assertSeriesPolicyCurrent(scope: ServiceDataScope, policyGeneration: string): void;
  };
}
const QUERIES = new Set(['calendar.resources', 'calendar.busy', 'calendar.appointments', 'calendar.appointmentsByDate', 'calendar.appointment',
  'calendar.overrideGrant', 'calendar.appointmentReviewCreate', 'calendar.appointmentReviewUpdate',
  'calendar.locations', 'calendar.location', 'calendar.resourceLocations', 'calendar.resourceLocationPolicy', 'calendar.locationAssignmentWitnesses', 'calendar.visitLocations',
  'calendar.types', 'calendar.type', 'calendar.resourceTypes', 'calendar.lifecycle', 'calendar.appointmentTransitions',
  'calendar.availability', 'calendar.availabilityPolicy', 'calendar.blocks', 'calendar.block', 'calendar.holds', 'calendar.hold', 'calendar.receipt',
  'calendar.appointmentParticipants', 'calendar.holdParticipants', 'calendar.holdParticipantAdmission']);
const COMMANDS = new Set(['calendar.resource.create', 'calendar.resource.grant', 'calendar.resource.availability', 'calendar.resource.availability-policy',
  'calendar.resource.override-grant',
  'calendar.location.create', 'calendar.location.replace', 'calendar.resource.locations', 'calendar.resource.location-policy',
  'calendar.type.create', 'calendar.type.replace', 'calendar.resource.types', 'calendar.lifecycle.replace', 'calendar.appointment.transition',
  'calendar.block.create', 'calendar.block.reschedule', 'calendar.block.cancel',
  'calendar.hold.acquire', 'calendar.hold.release', 'calendar.hold.confirm',
  'calendar.appointment.create', 'calendar.appointment.reschedule', 'calendar.appointment.update', 'calendar.appointment.cancel', 'calendar.appointment.participants']);

export class CalendarRuntime implements CalendarServiceBroker {
  private state: 'ready' | 'closing' | 'closed' | 'close-failed' = 'ready';
  private closeTask: Promise<void> | null = null;
  private readonly stop = new AbortController();
  private readonly initializers = new Map<string, Promise<CalendarOwnerRecord>>();
  private readonly sourceReadiness = new Map<string, { readonly owner: CalendarOwnerRecord; readonly task: Promise<void> }>();
  private readonly bindingRefs = new Set<string>();
  private readonly active = new Set<Promise<unknown>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly pendingHints = new Set<string>();
  private hintQueued = false;
  private source: CalendarRuntimeSource | null = null;
  private removeCommit: (() => void) | null = null;
  private readonly rootHash: string;
  private readonly wakeCatalog: CalendarIntegrationWakeCatalog | null;
  private readonly wakeWrites = new Map<string, number>();
  private constructor(private readonly options: CalendarRuntimeOptions, private readonly owner: DatabaseCoordinator,
    private readonly realm: DatabaseRealm) {
    this.rootHash = calendarHash(canonicalDatabaseRootIdentity(options.config.rootDirectory));
    this.wakeCatalog = options.integrationWake ? new CalendarIntegrationWakeCatalog(options.system, this.rootHash) : null;
  }

  static async open(options: CalendarRuntimeOptions): Promise<CalendarRuntime> {
    // Do not import an unfinished candidate realm on the ordinary019 path.
    // The fixed native profile must use its matching source actor and actual
    // durable SYSTEM revision fence; a callback-only fallback is not supported.
    const realm = options.series ? (await import('./series-materialization-realm')).calendarSeriesMaterializationRealm : calendarRealm;
    if (options.series) {
      const binding = options.series.transport.writerPolicy;
      if (!options.authority.actorContext || binding.realmFingerprint !== realm.fingerprint
        || binding.rootHash !== calendarHash(canonicalDatabaseRootIdentity(options.config.rootDirectory))
        || options.persistence.defaultActorEntrypoint !== null && !options.persistence.defaultActorEntrypoint.endsWith('/series-actor-entry.ts')) {
        throw new CalendarError('CALENDAR_CONFIG_INVALID');
      }
    }
    if (options.persistence.defaultActorEntrypoint && !existsSync(options.persistence.defaultActorEntrypoint)) throw new CalendarError('CALENDAR_NOT_READY');
    if (!installCalendarOwnerSchema(options.system, options.installAllowed)) throw new CalendarError('CALENDAR_NOT_READY');
    if (options.integrationWake && !await installCalendarIntegrationWakeCatalog(options.system, options.installAllowed)) throw new CalendarError('CALENDAR_NOT_READY');
    let prepared: CalendarRuntime | undefined;
    const owner = new DatabaseCoordinator({
      rootDirectory: options.config.rootDirectory, realm, createExecutor: options.persistence.createExecutor,
      ...(options.series ? { writerPolicy: options.series.transport.writerPolicy as unknown as DatabaseSerializableValue } : {}),
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true,
      maxDatabases: options.config.maxActiveDatabases, maxDatabaseFiles: options.config.maxDatabaseFiles,
      maxQueuedPerDatabase: 64, maxQueuedTotal: 256, queueTimeoutMs: 5000, operationTimeoutMs: 15000, sweepIntervalMs: false,
      authorityCommitCoordinator: options.authority.coordinator, requireCommitAuthority: true,
      openAdmission: id => {
        if (!prepared) throw new CalendarError('CALENDAR_NOT_READY');
        return prepared.openAdmission(id);
      },
      ...(options.authority.actorContext ? { actorAuthorityContext: options.authority.actorContext } : {}),
      ...(options.observability ? { observability: createDatabaseObservability(options.observability) } : {}),
    });
    const runtime = new CalendarRuntime(options, owner, realm);
    prepared = runtime;
    try {
      const records = runtime.startupOwners();
      runtime.source = await options.source?.(owner) ?? null;
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
      if (record.established !== 1 || record.realm_fingerprint !== this.realm.fingerprint) throw new CalendarError('CALENDAR_NOT_READY');
      const result = await this.execute<T>(record, 'query', name, body, guard, undefined, false, operationSignal);
      guard(); return result;
    });
  }

  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, assertCurrent: () => void, signal?: AbortSignal,
    finalCommitGuard?: () => void): Promise<T> {
    return this.track(async () => {
      const operationSignal = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
      const guard = this.guard(assertCurrent, operationSignal); guard();
      const scopeId = calendarScope(serviceDataScopeKey(scope)), key = calendarKey(requestId), body = this.input(scopeId, name, input, true);
      if (body.requestId !== key) throw new CalendarError('CALENDAR_INPUT_INVALID');
      const id = calendarDatabaseId(scopeId), existing = this.record(id);
      if (!existing || existing.established === 0 && !this.filePresent(id)) assertCalendarProvisionAllowed(name, body);
      const record = await this.ensure(id, scopeId, guard, operationSignal); guard();
      const actor = calendarActor(body.actor);
      if (this.source?.ready) {
        // Readiness cannot hide an already accepted logical request. This is an
        // authorized receipt lookup, not a replay shortcut: the ordinary command
        // still compares its canonical digest and rechecks current object rights.
        // Logging-only sources keep their historical acquisition/query cost.
        const prior = await this.execute<CalendarCommandReceipt | null>(record, 'query', 'calendar.receipt', { actor, requestId: key }, guard, undefined, false, operationSignal);
        guard();
        if (prior === null) { await this.readySourceOwner(record); guard(); }
      }
      // Fabric transport receipts are separate from the stable domain identity.
      // Changed actor capabilities must re-enter calendarIntent with current rights.
      // A reviewed realm upgrade gets a new native transport namespace, while
      // the domain receipt remains bound to the original principal/request.
      // Otherwise a retained native receipt's old realm fingerprint would
      // falsely reject reconciliation after a legitimate migration.
      // An assignment's live visibility proof may change during reconciliation.
      // It selects a native transport attempt, not a new logical domain intent;
      // calendarIntent still compares the original scope/principal/key digest.
      const transportKey = 'calendar-command:' + calendarHash([this.realm.fingerprint, actor, key, name,
        ...(name === 'calendar.resource.locations' || name === 'calendar.resource.location-policy' ? [body.locationWitnesses ?? null] : [])]);
      const result = await this.execute<CalendarCommandReceipt>(record, 'command', name, body, guard, transportKey, false, operationSignal,
        finalCommitGuard ? this.guard(finalCommitGuard, operationSignal) : undefined);
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

  diagnostics() { return { state: this.state, activeOperations: this.active.size, initializingScopes: this.initializers.size,
    readyingOwners: this.sourceReadiness.size,
    ...(this.wakeCatalog ? { integrationWake: this.wakeCatalog.coverage(), writingOwners: this.wakeWrites.size } : {}),
    fabric: this.owner.diagnostics() }; }

  /** @internal Native SYSTEM metadata only. Not request CRUD or source authority. */
  integrationWakeCatalog(): CalendarIntegrationWakeCatalog {
    this.assertReady();
    if (!this.wakeCatalog) throw new CalendarError('CALENDAR_NOT_READY');
    return this.wakeCatalog;
  }

  /** @internal Startup metadata reconciliation only. Pages release SYSTEM
   * admission between awaits; this grants no source or physical-file authority. */
  prepareIntegrationWakes(stamp: string, now: number, assertCurrent: () => void, signal?: AbortSignal): Promise<CalendarIntegrationWakeCoverage> {
    return this.track(async () => {
      const operationSignal = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
      const guard = this.guard(assertCurrent, operationSignal), catalog = this.integrationWakeCatalog();
      const options = { assertCurrent: guard, signal: operationSignal };
      guard(); let coverage = await catalog.reconcileConfiguration(stamp, now, options); guard();
      for (let pages = 0; !coverage.complete; pages++) {
        if (pages > this.options.config.maxDatabaseFiles) throw new CalendarError('CALENDAR_STATE_INVALID');
        coverage = await catalog.seedPage({ generation: coverage.configurationGeneration, now, limit: 100 }, options); guard();
      }
      return coverage;
    });
  }

  /** @internal Only a fresh canonical query after all owner writes settle may
   * clear its dirty marker. SYSTEM and private leases never overlap. */
  refreshIntegrationWake(record: CalendarOwnerRecord,
    failure?: { readonly classification: 'retry' | 'review'; readonly nextWakeAt: number }): Promise<number | null> {
    return this.track(() => this.refreshIntegrationOwnerWake(record, failure));
  }

  private async refreshIntegrationOwnerWake(record: CalendarOwnerRecord,
    failure?: { readonly classification: 'retry' | 'review'; readonly nextWakeAt: number }): Promise<number | null> {
    this.assertReady();
    if (!this.wakeCatalog) throw new CalendarError('CALENDAR_NOT_READY');
    // A held physical write is not quiet, but it also must not turn the global
    // absolute wake into an immediate retry loop. Retry publication preserves
    // dirty evidence and can safely occur before that write settles.
    const deferred = failure ?? (this.wakeWrites.has(record.id) ? { classification: 'retry' as const, nextWakeAt: Date.now() + 1000 } : undefined);
    const checkpoint = this.wakeCatalog.sample(record);
    if (deferred) {
      const nextWakeAt = calendarInteger(deferred.nextWakeAt, 0, 8_640_000_000_000_000);
      // Retry metadata is not a physical-readiness certificate. A missing or
      // rejected private owner must remain durably visible for investigation.
      const published = await this.wakeCatalog.publish(record, checkpoint, { classification: deferred.classification, nextWakeAt }, {
        signal: this.stop.signal, assertCurrent: () => this.assertReady(),
      });
      return published ? nextWakeAt : 0;
    }
    this.assertIntegrationOwner(record);
    const owner = this.forIntegrationOwner(record);
    const result = await owner.read<{ nextWakeAt: number | null }>('calendar.integration.nextWake', {});
    owner.assertCurrent();
    if (!result || result.nextWakeAt !== null && !Number.isSafeInteger(result.nextWakeAt)) throw new CalendarError('CALENDAR_STATE_INVALID');
    const nextWakeAt = result.nextWakeAt === null ? null : calendarInteger(result.nextWakeAt, 0, 8_640_000_000_000_000);
    if (this.wakeWrites.has(record.id)) return this.refreshIntegrationOwnerWake(record, { classification: 'retry', nextWakeAt: Date.now() + 1000 });
    const published = await this.wakeCatalog.publish(record, checkpoint, { classification: 'ready', nextWakeAt }, {
      signal: this.stop.signal,
      assertCurrent: () => {
        this.assertIntegrationOwner(record);
        if (this.wakeWrites.has(record.id)) throw new CalendarError('CALENDAR_NOT_READY');
      },
    });
    return published ? nextWakeAt : 0;
  }

  /** @internal Actor-facing operator reads have a separate strict registry and
   * cannot be reached through the native owner or ordinary Calendar request API.
   * An absent owner stays absent; these are never provisioning/adoption methods.
   */
  integrationOperatorReceipt(scope: ServiceDataScope, input: unknown, assertCurrent: () => void,
    signal?: AbortSignal): Promise<CalendarIntegrationOperatorRequestReceipt | null> {
    return this.track(async () => {
      const operationSignal = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
      const guard = this.guard(assertCurrent, operationSignal); guard();
      const r = calendarRecord(calendarValue(input), ['actor', 'requestId']), actor = calendarActor(r.actor);
      if (!actor.manageAll || actor.scopeId !== serviceDataScopeKey(scope)) throw new CalendarError('CALENDAR_FORBIDDEN');
      const requestId = calendarKey(r.requestId), owner = this.integrationOwnerForScope(scope);
      if (!owner) return null;
      const ownerGuard = () => { guard(); this.assertIntegrationOwner(owner); };
      const value = await this.execute<CalendarIntegrationOperatorRequestReceipt | null>(owner, 'query', 'calendar.integration.operator.receipt',
        { actor, expectedOwnerId: owner.owner_id, requestId }, ownerGuard, undefined, false, operationSignal);
      ownerGuard(); return value;
    });
  }

  /** @internal Existing-only human acceptance, not a native control invocation.
   * Bypass readySourceOwner: retirement is precisely why normal readiness may
   * refuse. Retain the same physical proof, revocation and final writer fences.
   */
  integrationOperatorRequest(scope: ServiceDataScope, input: unknown, assertCurrent: () => void,
    signal?: AbortSignal, finalCommitGuard?: () => void): Promise<CalendarIntegrationOperatorRequestReceipt> {
    return this.track(async () => {
      const operationSignal = signal ? AbortSignal.any([this.stop.signal, signal]) : this.stop.signal;
      const guard = this.guard(assertCurrent, operationSignal); guard();
      const r = calendarRecord(calendarValue(input), ['actor', 'requestId', 'action', 'ruleId', 'expected', 'desired']);
      const actor = calendarActor(r.actor), requestId = calendarKey(r.requestId);
      if (!actor.manageAll || actor.scopeId !== serviceDataScopeKey(scope)) throw new CalendarError('CALENDAR_FORBIDDEN');
      const owner = this.integrationOwnerForScope(scope);
      if (!owner) throw new CalendarError('CALENDAR_NOT_FOUND');
      const ownerGuard = () => { guard(); this.assertIntegrationOwner(owner); };
      const identity = { actor, expectedOwnerId: owner.owner_id, requestId };
      const prior = await this.execute<CalendarIntegrationOperatorRequestReceipt | null>(owner, 'query', 'calendar.integration.operator.receipt',
        identity, ownerGuard, undefined, false, operationSignal); ownerGuard();
      const { desired: _desired, ...authored } = r;
      const body: Record<string, unknown> = { ...authored, ...identity };
      // Receipt-first source replay must survive config/pin/realm movement. A
      // fresh installation alone must match CURRENT physical owner and realm.
      if (prior === null && Object.hasOwn(r, 'desired')) body.desired = calendarIntegrationInput(owner, scope, 'command',
        'calendar.integration.policy.install', { policy: r.desired, expectedEpoch: 0 }, 'operator-owner-proof').policy;
      const result = await this.execute<CalendarIntegrationOperatorRequestReceipt>(owner, 'command', 'calendar.integration.operator.request', body, ownerGuard,
        'calendar-operator-command:' + calendarHash([this.realm.fingerprint, body]), false, operationSignal,
        prior === null && finalCommitGuard ? this.guard(finalCommitGuard, operationSignal) : undefined);
      try {
        ownerGuard();
        const accepted = await this.execute<CalendarIntegrationOperatorRequestReceipt | null>(owner, 'query', 'calendar.integration.operator.receipt',
          identity, ownerGuard, undefined, false, operationSignal); ownerGuard();
        if (accepted === null || calendarHash(accepted) !== calendarHash(result)) throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN');
      } catch { throw new CalendarError('CALENDAR_OUTCOME_UNKNOWN'); }
      return result;
    });
  }

  /** @internal Detached metadata only. Enumeration never provisions a file, binds an owner or acquires an actor. */
  integrationOwners(): readonly CalendarOwnerRecord[] {
    this.assertReady();
    const owners: CalendarOwnerRecord[] = [];
    for (const record of this.records()) {
      this.assertRetained(record);
      if (record.established !== 1) continue;
      this.assertIntegrationOwner(record);
      owners.push(Object.freeze({ ...record }));
    }
    return Object.freeze(owners);
  }

  /** @internal Bounded indexed SYSTEM metadata only. Physical owner admission
   * and file proof belong to forIntegrationOwner()/verify(), never discovery.
   */
  integrationOwnerPage(input: { readonly after?: string; readonly limit?: number } = {}): { readonly owners: readonly CalendarOwnerRecord[]; readonly nextCursor: string | null } {
    this.assertReady();
    const r = calendarRecord(input, ['after', 'limit']), limit = calendarInteger(r.limit ?? 25, 1, 100);
    const after = r.after === undefined ? null : calendarKey(r.after, 128);
    const rows = this.options.system.prepare(`SELECT * FROM _calendar_owners INDEXED BY calendar_owners_established
      WHERE established=1 ${after === null ? '' : 'AND id>?'} ORDER BY id LIMIT ?`).all(...(after === null ? [] : [after]), limit + 1) as CalendarOwnerRecord[];
    const owners = rows.slice(0, limit).map(record => {
      assertCalendarOwnerRecord(record, this.rootHash, this.realm.fingerprint, false);
      return Object.freeze({ ...record });
    });
    return Object.freeze({ owners: Object.freeze(owners), nextCursor: rows.length > limit ? owners.at(-1)!.id : null });
  }

  /** @internal Canonical scope lookup for recovered effects before discovery.
   * No actor/file is provisioned and an unestablished record is not an owner.
   */
  integrationOwnerForScope(scope: ServiceDataScope): CalendarOwnerRecord | null {
    this.assertReady(); const scopeId = serviceDataScopeKey(scope), record = this.record(calendarDatabaseId(scopeId));
    if (!record || record.established !== 1) return null;
    assertCalendarOwnerRecord(record, this.rootHash, this.realm.fingerprint, false);
    if (record.scope_id !== scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
    return Object.freeze({ ...record });
  }

  /** @internal Native lifecycle only; this capability is never projected through CalendarService. */
  forIntegrationOwner(input: CalendarOwnerRecord): CalendarIntegrationOwner {
    const owner = Object.freeze({ ...calendarRecord(calendarValue(input), ['id', 'scope_id', 'owner_id', 'root_hash', 'realm_fingerprint', 'established']) }) as unknown as CalendarOwnerRecord;
    this.assertIntegrationOwner(owner);
    const scope = trustedSystemServiceDataScope(owner.scope_id === 'application' ? { scopeKind: 'application' }
      : { scopeKind: 'tenant', tenantId: owner.scope_id.slice('tenant:'.length) });
    const run = <T>(kind: 'verify' | 'query' | 'command', name: string, input: unknown,
      options?: CalendarIntegrationReadOptions | CalendarIntegrationCommandOptions): Promise<T> => this.track(async () => {
      const opts = calendarIntegrationOptions(options, kind === 'command');
      const signal = opts.signal ? AbortSignal.any([this.stop.signal, opts.signal]) : this.stop.signal;
      const guard = this.guard(() => { this.assertIntegrationOwner(owner); return opts.assertCurrent(); }, signal);
      guard();
      const body = kind === 'verify' ? null : calendarIntegrationInput(owner, scope, kind, name, input, opts.key);
      // Existing-only is not a migration API: the native cold-open contract
      // proves physical owner and current ledger/schema before writable open.
      // Retain same-lease owner/current-authority proof below as a distinct
      // operation fence; a cold-generation check is never request authority.
      // Actual file/actor ordering still needs physical qualification.
      if (kind !== 'verify') return await this.execute<T>(owner, kind, name, body, guard,
        kind === 'command' ? 'calendar-integration:' + calendarHash([this.realm.fingerprint, owner.id, owner.owner_id, name, opts.key!]) : undefined,
        false, signal);
      const authority = createDatabaseCommitAuthority(this.options.authority.coordinator, owner.id, () => { guard(); return undefined; });
      const lease = await this.owner.acquireExisting(owner.id, { commitAuthority: authority });
      if (!lease) throw new CalendarError('CALENDAR_STATE_INVALID');
      try { guard(); await this.verifyOwner(lease, owner, guard, signal); guard(); return undefined as T; }
      finally { lease.release(); }
    });
    return Object.freeze({ owner, scope: Object.freeze(scope), signal: this.stop.signal,
      assertCurrent: () => { this.assertIntegrationOwner(owner); },
      verify: options => run<void>('verify', '', null, options),
      read: (name, input, options) => run('query', name, input, options),
      command: (name, input, options) => run('command', name, input, options),
    } satisfies CalendarIntegrationOwner);
  }

  /** @internal Native series only. The facade is never returned by the request
   * Calendar service. Reuses this provider's exact physical coordinator/root. */
  forSeriesOwner(owner: CalendarOwnerRecord): CalendarSeriesNativeOwner {
    const setup = this.options.series;
    if (!setup || !this.options.authority.actorContext) throw new CalendarError('CALENDAR_NOT_READY');
    this.assertIntegrationOwner(owner);
    const selected = Object.freeze({ ...owner });
    const execute = <T>(...args: Parameters<CalendarSeriesNativeOwnerDependencies['execute']>): Promise<T> => this.track(async () => {
      const [kind, name, input, operation] = args;
      const signal = AbortSignal.any([this.stop.signal, operation.signal]);
      const guard = this.guard(() => { this.assertIntegrationOwner(selected); operation.guard(); }, signal);
      guard();
      return this.executePrivate<T>(selected, kind, name, input, guard, operation.requestId, false, signal,
        operation.finalCommitGuard ? this.guard(operation.finalCommitGuard, signal) : undefined);
    });
    return createCalendarSeriesNativeOwner({ owner: selected, transport: setup.transport, signal: this.stop.signal,
      ...(setup.participants ? { participants: setup.participants } : {}),
      assertOwnerCurrent: value => { this.assertIntegrationOwner(value); },
      assertSeriesPolicyCurrent: (scope, generation) => setup.assertSeriesPolicyCurrent(scope, generation),
      execute,
    });
  }

  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'closing'; this.listeners.clear(); this.pendingHints.clear();
    this.options.series?.transport.close();
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
  /** Integrated discovery admits exact SYSTEM ownership metadata only. One
   * missing private file must become that owner's durable review obligation,
   * not prevent other owners from starting. Staged source/query admission
   * still performs the unchanged existing-only physical proof. */
  private startupOwners(): CalendarOwnerRecord[] {
    const records = this.records();
    for (const record of records) {
      if (this.wakeCatalog) assertCalendarOwnerRecord(record, this.rootHash, this.realm.fingerprint, this.options.installAllowed);
      else this.assertRetained(record);
    }
    return records;
  }
  private record(id: string): CalendarOwnerRecord | null {
    return this.options.system.prepare('SELECT * FROM _calendar_owners WHERE id=?').get(id) as CalendarOwnerRecord | null;
  }
  private filePresent(id: string): boolean { return calendarFileIsPresent(this.options.config.rootDirectory, id); }
  private assertRetained(record: CalendarOwnerRecord): void {
    assertCalendarOwnerRecord(record, this.rootHash, this.realm.fingerprint, this.options.installAllowed);
    if (record.established === 1 && !this.filePresent(record.id)) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  private assertIntegrationOwner(owner: CalendarOwnerRecord): void {
    this.assertReady();
    if (calendarHash(canonicalDatabaseRootIdentity(this.options.config.rootDirectory)) !== this.rootHash) throw new CalendarError('CALENDAR_STATE_INVALID');
    assertCalendarOwnerRecord(owner, this.rootHash, this.realm.fingerprint, false);
    if (owner.established !== 1) throw new CalendarError('CALENDAR_NOT_READY');
    const current = this.record(owner.id);
    if (!current || current.id !== owner.id || current.scope_id !== owner.scope_id || current.owner_id !== owner.owner_id
      || current.root_hash !== owner.root_hash || current.realm_fingerprint !== owner.realm_fingerprint || current.established !== 1
      || !this.filePresent(owner.id)) throw new CalendarError('CALENDAR_STATE_INVALID');
  }
  /** Native cold-generation policy, never authored request data. Existing
   * current metadata must NOT authorize automatic physical schema repair.
   * Staged creation alone permits an absent owner; any present row must match.
   */
  private openAdmission(id: string): DatabaseOpenAdmission {
    this.assertReady();
    const record = this.record(id);
    if (!record) throw new CalendarError('CALENDAR_STATE_INVALID');
    this.assertRetained(record);
    return Object.freeze({ schema: record.established === 1 && record.realm_fingerprint === this.realm.fingerprint ? 'current' : 'prepare',
      row: Object.freeze({ table: '_calendar_owner', id: 'application',
        equals: Object.freeze({ owner_id: record.owner_id, scope_id: record.scope_id }),
        ...(record.established === 1 ? {} : { allowMissing: true as const }) }) });
  }
  private readySourceOwner(record: CalendarOwnerRecord): Promise<void> {
    try {
      this.assertIntegrationOwner(record);
      const source = this.source;
      if (!source?.ready) return Promise.resolve();
      const prior = this.sourceReadiness.get(record.id);
      if (prior) {
        if (calendarHash(prior.owner) !== calendarHash(record)) throw new CalendarError('CALENDAR_NOT_READY');
        return prior.task;
      }
      if (this.sourceReadiness.size >= this.options.config.maxActiveDatabases) throw new CalendarError('CALENDAR_NOT_READY');
      const owner = Object.freeze({ ...record });
      // Defer execution until its exact entry is installed. Shared work belongs
      // to the owner/runtime, never the first caller's session or abort signal.
      const task = Promise.resolve().then(async () => {
        const native = this.forIntegrationOwner(owner);
        await native.verify(); // The existing-only proof lease is released before the source hook.
        native.assertCurrent();
        await source.ready!(owner);
        native.assertCurrent();
      }).catch(() => {
        // A separate policy command may be uncertain, but the requested business
        // command has NOT started. Its public result must not claim otherwise.
        throw new CalendarError('CALENDAR_NOT_READY', 'not-started');
      });
      const entry = { owner, task };
      this.sourceReadiness.set(owner.id, entry); this.active.add(task);
      const settled = () => {
        if (this.sourceReadiness.get(owner.id) === entry) this.sourceReadiness.delete(owner.id);
        this.active.delete(task);
      };
      // Track physical hook settlement separately from every waiting request.
      // There is deliberately no successful/failed readiness cache after it.
      void task.then(settled, settled);
      return task;
    } catch { return Promise.reject(new CalendarError('CALENDAR_NOT_READY', 'not-started')); }
  }
  private input(scopeId: string, name: string, input: unknown, write: boolean): Record<string, unknown> {
    if (!(write ? COMMANDS : QUERIES).has(name)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    const body = calendarRecord(calendarValue(input));
    const actor = calendarActor(body.actor);
    if (actor.scopeId !== scopeId) throw new CalendarError('CALENDAR_FORBIDDEN');
    const { actor: _actor, ...query } = body;
    if (name === 'calendar.appointment.update') {
      const { requestId, id, expectedRevision, override, ...patch } = query;
      calendarKey(requestId); calendarKey(id); calendarInteger(expectedRevision, 1);
      Object.assign(body, calendarAppointmentTransportInput(patch, this.options.config, true));
      if (Object.hasOwn(query, 'override')) body.override = normalizeCalendarAppointmentOverride(override);
    }
    if (name === 'calendar.appointment.create') {
      const { requestId, id, override, ...intent } = query;
      calendarKey(requestId); calendarKey(id);
      Object.assign(body, calendarAppointmentTransportInput(intent, this.options.config));
      if (Object.hasOwn(query, 'override')) body.override = normalizeCalendarAppointmentOverride(override);
    }
    if (name === 'calendar.appointmentReviewCreate' || name === 'calendar.appointmentReviewUpdate') {
      const update = name === 'calendar.appointmentReviewUpdate';
      const { requestId, id } = query;
      calendarKey(requestId); calendarKey(id);
      const intent = { ...query }; delete intent.requestId; delete intent.id;
      if (update) { calendarInteger(intent.expectedRevision, 1); delete intent.expectedRevision; }
      Object.assign(body, calendarAppointmentTransportInput(intent, this.options.config, update));
    }
    if (name === 'calendar.resource.override-grant') {
      const { requestId, id, userId, expectedRevision, ...grant } = query;
      calendarKey(requestId); calendarKey(id); calendarKey(userId); calendarInteger(expectedRevision, 1);
      Object.assign(body, normalizeCalendarOverrideGrant(grant));
    }
    if (name === 'calendar.overrideGrant') {
      const selected = calendarRecord(query, ['id', 'userId']);
      return { actor, id: calendarKey(selected.id), userId: calendarKey(selected.userId) };
    }
    if (name === 'calendar.resource.location-policy') {
      const { requestId, id, expectedRevision, locationWitnesses: _witnesses, ...policy } = query;
      calendarKey(requestId); calendarKey(id); calendarInteger(expectedRevision, 1);
      Object.assign(body, normalizeCalendarResourceLocationPolicy(policy));
    }
    if (name === 'calendar.resourceLocationPolicy') {
      const selected = calendarRecord(query, ['id']);
      return { actor, id: calendarKey(selected.id) };
    }
    if (name === 'calendar.resources') return { ...calendarResourcePageQuery(query, this.options.config), actor };
    if (name === 'calendar.locations') return { ...calendarPageQuery(query, this.options.config), actor };
    if (name === 'calendar.visitLocations') return { ...calendarVisitLocationQuery(query, this.options.config), actor };
    if (name === 'calendar.types') return { ...calendarAppointmentTypePageQuery(query, this.options.config), actor };
    if (name === 'calendar.appointmentsByDate') return { ...calendarDateRange(query, this.options.config), actor };
    if (name === 'calendar.busy' || name === 'calendar.appointments' || name === 'calendar.blocks' || name === 'calendar.holds') return { ...calendarRange(query, this.options.config), actor };
    if ((name === 'calendar.appointment.create' || name === 'calendar.block.create' || name === 'calendar.hold.acquire')
      && (!Array.isArray(body.resourceIds) || body.resourceIds.length > this.options.config.maxResources)) throw new CalendarError('CALENDAR_INPUT_INVALID');
    if (name === 'calendar.appointment.participants' || (name === 'calendar.appointment.create' || name === 'calendar.appointment.update'
      || name === 'calendar.appointmentReviewCreate' || name === 'calendar.appointmentReviewUpdate' || name === 'calendar.hold.acquire') && Object.hasOwn(body, 'participants')) {
      requireCalendarParticipantManager(actor);
      const references = calendarParticipantReferences(name === 'calendar.appointment.participants' ? body.references : body.participants);
      if (references.length > this.options.config.maxParticipants) throw new CalendarError('CALENDAR_INPUT_INVALID');
      body[name === 'calendar.appointment.participants' ? 'references' : 'participants'] = references;
    }
    return body;
  }
  private async ensure(id: string, scopeId: string, guard: () => void, signal?: AbortSignal): Promise<CalendarOwnerRecord> {
    const retained = this.record(id);
    if (retained?.established === 1 && retained.realm_fingerprint === this.realm.fingerprint) {
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
      record = { id, scope_id: scopeId, owner_id: 'cal_' + crypto.randomUUID(), root_hash: this.rootHash, realm_fingerprint: this.realm.fingerprint, established: 0 };
      this.options.system.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,0)')
        .run(id, scopeId, record.owner_id, this.rootHash, this.realm.fingerprint);
    }), signal ? { signal } : {});
    guard(); this.source?.prepare(record);
    await this.execute(record, 'command', 'calendar.owner.bind', { ownerId: record.owner_id, scopeId }, guard,
      'calendar-owner:' + record.owner_id + ':' + this.realm.fingerprint, record.established === 0, signal);
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); const current = this.record(id);
      if (!current || current.owner_id !== record.owner_id || current.scope_id !== scopeId || current.root_hash !== this.rootHash) throw new CalendarError('CALENDAR_STATE_INVALID');
      this.options.system.prepare('UPDATE _calendar_owners SET established=1,realm_fingerprint=? WHERE id=? AND owner_id=?').run(this.realm.fingerprint, id, record.owner_id);
      this.wakeCatalog?.seedEstablishedInTransaction({ ...record, established: 1, realm_fingerprint: this.realm.fingerprint }, Date.now());
    }), signal ? { signal } : {});
    guard(); const established = { ...record, established: 1, realm_fingerprint: this.realm.fingerprint };
    this.source?.prepare(established); return established;
  }

  private async execute<T>(record: CalendarOwnerRecord, kind: 'query' | 'command', name: string, input: unknown,
    guard: () => void, requestId?: string, provision = false, signal?: AbortSignal, finalCommitGuard?: () => void): Promise<T> {
    guard();
    if (!this.wakeCatalog || kind !== 'command' || name === 'calendar.owner.bind') return this.executePrivate(record, kind, name, input, guard, requestId, provision, signal, finalCommitGuard);
    this.wakeWrites.set(record.id, (this.wakeWrites.get(record.id) ?? 0) + 1);
    try {
      // This short SYSTEM transaction must succeed before acquiring a private
      // writer lease. A process death after the later private commit therefore
      // leaves a due marker, not a falsely quiet retained owner.
      try { await this.wakeCatalog.markDirty(record, Date.now(), { assertCurrent: guard, ...(signal ? { signal } : {}) }); }
      catch (error) {
        guard();
        if (error instanceof CalendarError) throw error;
        // This required metadata admission failed before the private command
        // acquired any lease. Do not leak SQL or claim an uncertain domain write.
        throw new CalendarError('CALENDAR_NOT_READY', 'not-started');
      }
      guard();
      try { this.source?.wake(createDatabaseRef(record.id)); } catch { /* Durable marker, not the hint, owns recovery. */ }
      return await this.executePrivate(record, kind, name, input, guard, requestId, provision, signal, finalCommitGuard);
    } finally {
      const count = (this.wakeWrites.get(record.id) ?? 1) - 1;
      if (count) this.wakeWrites.set(record.id, count); else this.wakeWrites.delete(record.id);
      // The native coordinator refreshes once after its complete owner turn,
      // not with an extra canonical query after every individual command. Until
      // then the durable dirty marker remains due. No receipt outcome depends
      // on successful wake publication.
    }
  }

  private async executePrivate<T>(record: CalendarOwnerRecord, kind: 'query' | 'command', name: string, input: unknown,
    guard: () => void, requestId?: string, provision = false, signal?: AbortSignal, finalCommitGuard?: () => void): Promise<T> {
    guard();
    // Target eligibility authorizes this commit, not the immutable historical
    // receipt. Later target changes cannot retroactively revoke accepted work;
    // ordinary viewer authority still fences every wait and result settlement.
    const authority = createDatabaseCommitAuthority(this.options.authority.coordinator, record.id, () => {
      guard(); finalCommitGuard?.(); return undefined;
    });
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
      // A proven final-edge refusal is not an uncertain provider/write outcome.
      // Do not expose the private guard cause or promise a replay is safe after
      // unknown settlement. The caller must obtain current calendar authority.
      if (error instanceof DatabaseError && error.code === 'DATABASE_AUTHORITY_CHANGED'
        && (error.outcome === 'not-started' || error.outcome === 'not-committed')) throw new CalendarError('CALENDAR_FORBIDDEN', error.outcome);
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
  if (name === 'calendar.appointmentReviewCreate' || name === 'calendar.appointmentReviewUpdate') {
    const r = calendarRecord(input); calendarActor(r.actor); calendarKey(r.requestId); calendarKey(r.id);
    if (name === 'calendar.appointmentReviewCreate' && calendarSelection(r.resourceIds).length === 0) throw new CalendarError('CALENDAR_INPUT_INVALID');
    // Review must never provision a source or issue a proof for nonexistent resources.
    throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  const fields = name === 'calendar.resources' ? ['actor', 'limit', 'after', 'locationIds', 'regions']
    : name === 'calendar.overrideGrant' ? ['actor', 'id', 'userId']
    : name === 'calendar.locations' ? ['actor', 'limit', 'after']
    : name === 'calendar.types' ? ['actor', 'limit', 'after', 'resourceIds']
    : name === 'calendar.visitLocations' ? ['actor', 'resourceIds', 'limit', 'after', 'interval']
    : name === 'calendar.locationAssignmentWitnesses' ? ['actor', 'locationIds']
    : name === 'calendar.lifecycle' ? ['actor']
    : name === 'calendar.receipt' ? ['actor', 'requestId'] : ['calendar.appointment', 'calendar.appointmentTransitions', 'calendar.appointmentParticipants', 'calendar.holdParticipants', 'calendar.holdParticipantAdmission', 'calendar.block', 'calendar.hold', 'calendar.availability', 'calendar.availabilityPolicy', 'calendar.location', 'calendar.resourceLocations', 'calendar.resourceLocationPolicy', 'calendar.type', 'calendar.resourceTypes'].includes(name) ? ['actor', 'id']
    : name === 'calendar.appointmentsByDate' ? ['actor', 'resourceIds', 'startDate', 'endDate', 'limit']
    : name === 'calendar.busy' || name === 'calendar.appointments' || name === 'calendar.blocks' || name === 'calendar.holds' ? ['actor', 'resourceIds', 'startAt', 'endAt', 'limit'] : null;
  if (!fields) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const r = calendarRecord(input, fields); calendarActor(r.actor);
  if (name === 'calendar.overrideGrant') { calendarKey(r.id); calendarKey(r.userId); throw new CalendarError('CALENDAR_NOT_FOUND'); }
  if (name === 'calendar.appointmentParticipants' || name === 'calendar.holdParticipants') {
    calendarKey(r.id); requireCalendarParticipantManager(calendarActor(r.actor)); throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  if (name === 'calendar.lifecycle') { requireCalendarLifecycleManager(calendarActor(r.actor)); return { ...CALENDAR_DEFAULT_LIFECYCLE_POLICY }; }
  if (name === 'calendar.visitLocations') {
    const { actor: _actor, ...query } = r;
    const accepted = calendarVisitLocationQuery(query, { maxPageSize: CALENDAR_LIMITS.page, maxResources: CALENDAR_LIMITS.selection });
    if (accepted.resourceIds.length) throw new CalendarError('CALENDAR_NOT_FOUND');
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
  if (name === 'calendar.appointmentsByDate') {
    const { actor: _actor, ...query } = r;
    const accepted = calendarDateRange(query, { maxRangeDays: 31, maxPageSize: CALENDAR_LIMITS.page, maxResources: CALENDAR_LIMITS.selection });
    if (accepted.resourceIds.length) throw new CalendarError('CALENDAR_NOT_FOUND');
    return { items: [], truncated: false };
  }
  if (name === 'calendar.type') {
    calendarKey(r.id);
    if (!calendarActor(r.actor).manageAll) throw new CalendarError('CALENDAR_FORBIDDEN');
    throw new CalendarError('CALENDAR_NOT_FOUND');
  }
  if (['calendar.appointment', 'calendar.appointmentTransitions', 'calendar.holdParticipantAdmission', 'calendar.block', 'calendar.hold', 'calendar.availability', 'calendar.availabilityPolicy', 'calendar.location', 'calendar.resourceLocations', 'calendar.resourceLocationPolicy', 'calendar.resourceTypes'].includes(name)) { calendarKey(r.id); throw new CalendarError('CALENDAR_NOT_FOUND'); }
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

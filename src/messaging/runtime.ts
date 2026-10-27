/** Private Fabric lifecycle. Each admitted organization owns its own canonical file and fixed audit scope. */
import { existsSync } from 'node:fs';
import { AuthError } from '../auth/types';
import { serviceDataScopeKey, trustedSystemServiceDataScope, type ServiceDataScope } from '../auth/service-data-scope';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor, DatabaseSerializableValue } from '../databases/database-operations';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import type { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { canonicalDatabaseRootIdentity, createDatabaseRef, resolveDatabaseFile } from '../databases/database-file';
import { DatabaseError } from '../databases/database-error';
import { createDatabaseObservability } from '../databases/database-observability';
import { observeDatabaseCoordinatorCommits } from '../databases/database-coordinator-commit-notifications';
import type { PlatformObservabilityRuntime } from '../observability/types';
import { emitPlatformCodeTo } from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { ResolvedMessagingConfig } from './config';
import { messagingRealm } from './realm';
import { messagingHash } from './validation';
import { installMessagingOwnerSchema } from './owner-schema';
import { MESSAGING_CODES, readMessagingActorRejection } from './realm-errors';
import { readMessagingCommitHint, messagingHintMatches, type MessagingSubscription } from './commit-hints';

export interface MessagingOwnerRecord { id: string; scope_id: string; owner_id: string; root_hash: string; realm_fingerprint: string; established: number }
export interface MessagingSourceOwner { prepare(owner: MessagingOwnerRecord): void; wake(ref: string): void; close(): Promise<void> }
export interface MessagingRuntimeOptions {
  config: ResolvedMessagingConfig; system: ReactiveDB; installAllowed: boolean;
  authority: { coordinator: AuthorityCommitCoordinator; actorContext: DatabaseActorAuthorityContext | null };
  observability: PlatformObservabilityRuntime;
  source?: (coordinator: DatabaseCoordinator) => MessagingSourceOwner;
}
/** Setup infrastructure only; request code receives the service's closed, current-authority facade. */
export class MessagingRuntime {
  private state: 'ready' | 'closing' | 'closed' = 'ready';
  private closeTask: Promise<void> | null = null;
  private readonly initializers = new Map<string, Promise<void>>();
  private readonly bound = new Set<string>();
  private readonly active = new Set<Promise<unknown>>();
  private readonly listeners = new Map<string, Set<{ listener(): void; filter?: MessagingSubscription }>>();
  private source: MessagingSourceOwner | null = null;
  private removeCommit: (() => void) | null = null;
  private readonly rootHash: string;
  private constructor(private readonly options: MessagingRuntimeOptions, private readonly owner: DatabaseCoordinator) {
    this.rootHash = messagingHash(canonicalDatabaseRootIdentity(options.config.rootDirectory));
  }
  static async open(options: MessagingRuntimeOptions): Promise<MessagingRuntime> {
    if (options.config.defaultActorEntrypoint && !existsSync(options.config.defaultActorEntrypoint)) throw unavailable('The retained messaging actor is missing.');
    if (!installMessagingOwnerSchema(options.system, options.installAllowed)) throw unavailable('Messaging requires its additive SYSTEM migration.');
    const coordinator = new DatabaseCoordinator({ rootDirectory: options.config.rootDirectory, realm: messagingRealm, createExecutor: options.config.createExecutor,
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true,
      maxDatabases: options.config.maxActiveDatabases, maxDatabaseFiles: options.config.maxDatabaseFiles,
      maxQueuedPerDatabase: 64, maxQueuedTotal: 256, queueTimeoutMs: 5000, operationTimeoutMs: 15000, sweepIntervalMs: false,
      authorityCommitCoordinator: options.authority.coordinator, requireCommitAuthority: true,
      ...(options.authority.actorContext ? { actorAuthorityContext: options.authority.actorContext } : {}), observability: createDatabaseObservability(options.observability) });
    const runtime = new MessagingRuntime(options, coordinator);
    try {
      const records = options.system.prepare('SELECT * FROM _messaging_owners ORDER BY id LIMIT ?').all(options.config.maxDatabaseFiles + 1) as MessagingOwnerRecord[];
      if (records.length > options.config.maxDatabaseFiles || records.some(row => row.root_hash !== runtime.rootHash)) throw unavailable('The retained messaging owner catalog does not match this configuration.');
      runtime.source = options.source?.(coordinator) ?? null;
      for (const record of records) { runtime.assertRetained(record); runtime.source?.prepare(record); }
      // Internal source acknowledgments are not new conversation content.
      runtime.removeCommit = observeDatabaseCoordinatorCommits(coordinator, ref => { runtime.source?.wake(ref); });
      coordinator.start(); return runtime;
    } catch (error) { try { await runtime.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Messaging startup and cleanup failed.'); } throw error; }
  }
  read<T>(scope: ServiceDataScope, name: string, input: unknown, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    const guard = synchronousGuard(assertCurrent);
    return this.track(async () => { guard(); const id = await this.ensure(scope, guard); return this.execute(id, 'query', name, input, undefined, guard, signal); });
  }
  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    const guard = synchronousGuard(assertCurrent);
    return this.track(async () => { guard(); const id = await this.ensure(scope, guard); return this.execute(id, 'command', name, input, requestId, guard, signal); });
  }
  /** Payload-free commit hints; subscribers re-read with their own live authorization before receiving data. */
  subscribe(scope: ServiceDataScope, listener: () => void, filter?: MessagingSubscription): () => void {
    this.assertReady(); const count = [...this.listeners.values()].reduce((total, entries) => total + entries.size, 0);
    if (count >= 1024) throw new AuthError('Messaging subscription capacity is exhausted.', 'MESSAGING_CAPACITY', 429);
    const ref = createDatabaseRef(databaseId(scope)), entry = { listener, ...(filter ? { filter: Object.freeze({ ...filter }) } : {}) };
    let entries = this.listeners.get(ref); if (!entries) this.listeners.set(ref, entries = new Set()); entries.add(entry);
    return () => { entries!.delete(entry); if (!entries!.size) this.listeners.delete(ref); };
  }
  diagnostics() { return { state: this.state, filesBound: this.bound.size, activeOperations: this.active.size, fabric: this.owner.diagnostics() }; }
  /** @internal Validated established catalog scopes for bounded retained-stage recovery, never HTTP-selected tenant IDs. */
  retainedScopes(): readonly ServiceDataScope[] {
    this.assertReady();
    const records = this.options.system.prepare('SELECT * FROM _messaging_owners WHERE established=1 ORDER BY id LIMIT ?').all(this.options.config.maxDatabaseFiles + 1) as MessagingOwnerRecord[];
    if (records.length > this.options.config.maxDatabaseFiles) throw unavailable('Messaging owner capacity changed.');
    return records.map(record => { this.assertRetained(record); return record.scope_id === 'application' ? trustedSystemServiceDataScope({ scopeKind: 'application' }) : trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: record.scope_id.slice('tenant:'.length) }); });
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'closing'; this.removeCommit?.(); this.removeCommit = null;
    for (const entries of this.listeners.values()) for (const entry of entries) try { entry.listener(); } catch { /* Advisory only. */ } this.listeners.clear();
    this.closeTask = (async () => {
      await Promise.allSettled([...this.active]);
      try { await this.source?.close(); } finally { await this.owner.close(); this.state = 'closed'; }
    })(); return this.closeTask;
  }
  private async ensure(scope: ServiceDataScope, assertCurrent: () => void): Promise<string> {
    const id = databaseId(scope); if (this.bound.has(id)) return id;
    let task = this.initializers.get(id);
    if (!task) {
      task = this.bind(id, serviceDataScopeKey(scope), assertCurrent); this.initializers.set(id, task);
      void task.finally(() => { if (this.initializers.get(id) === task) this.initializers.delete(id); }).catch(() => {});
    }
    await task; assertCurrent(); return id;
  }
  private async bind(id: string, scopeId: string, assertCurrent: () => void): Promise<void> {
    let record!: MessagingOwnerRecord;
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      assertCurrent(); const prior = this.options.system.prepare('SELECT * FROM _messaging_owners WHERE id=?').get(id) as MessagingOwnerRecord | null;
      if (prior) { this.assertRetained(prior); if (prior.scope_id !== scopeId) throw unavailable('Messaging scope ownership changed.'); record = prior; return; }
      if (existsSync(resolveDatabaseFile(this.options.config.rootDirectory, id).path)) throw unavailable('An existing messaging file has no matching retained owner.');
      const count = this.options.system.prepare('SELECT count(*) AS count FROM _messaging_owners').get() as { count: number };
      if (count.count >= this.options.config.maxDatabaseFiles) throw new AuthError('Messaging database capacity is exhausted.', 'MESSAGING_CAPACITY', 429);
      record = { id, scope_id: scopeId, owner_id: 'msg_' + crypto.randomUUID(), root_hash: this.rootHash, realm_fingerprint: messagingRealm.fingerprint, established: 0 };
      this.options.system.prepare('INSERT INTO _messaging_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,0)').run(id, scopeId, record.owner_id, this.rootHash, messagingRealm.fingerprint);
    }));
    this.source?.prepare(record);
    await this.execute(id, 'command', 'messaging.owner.bind', { ownerId: record.owner_id }, `messaging-owner:${record.owner_id}:${messagingRealm.fingerprint}`, assertCurrent);
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => { assertCurrent(); this.options.system.prepare('UPDATE _messaging_owners SET established=1,realm_fingerprint=? WHERE id=? AND owner_id=?').run(messagingRealm.fingerprint, id, record.owner_id); }));
    this.source?.prepare({ ...record, established: 1 });
    this.bound.add(id);
  }
  private assertRetained(record: MessagingOwnerRecord): void {
    if (!record || !['application'].includes(record.scope_id) && !(typeof record.scope_id === 'string' && record.scope_id.startsWith('tenant:') && record.scope_id.length > 7 && record.scope_id.length <= 263)
      || record.id !== 'messaging:' + messagingHash(record.scope_id) || typeof record.owner_id !== 'string' || !/^msg_[a-f0-9-]{36}$/.test(record.owner_id)
      || ![0, 1].includes(record.established) || !/^sha256:[a-f0-9]{64}$/.test(record.realm_fingerprint)) throw unavailable('Retained messaging ownership metadata is invalid.');
    if (record.root_hash !== this.rootHash || record.established && !existsSync(resolveDatabaseFile(this.options.config.rootDirectory, record.id).path)) throw unavailable('Retained messaging storage is missing or its root changed; restore it instead of creating an empty replacement.');
    if (!this.options.installAllowed && record.realm_fingerprint !== messagingRealm.fingerprint) throw unavailable('Retained messaging requires a reviewed realm migration.');
  }
  private async execute<T>(id: string, kind: 'query' | 'command', name: string, input: unknown, requestId: string | undefined, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    const check = () => { if (this.state === 'closed') throw unavailable('Messaging is closed.'); assertCurrent(); };
    check(); const commitAuthority = createDatabaseCommitAuthority(this.options.authority.coordinator, id, () => { check(); return undefined; });
    const lease = await this.owner.acquire(id, { commitAuthority });
    try {
      check(); signal?.throwIfAborted(); const data = createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor, assertReadAuthority: () => { check(); return undefined; } });
      const result = kind === 'query' ? await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' }, ...(signal ? { signal } : {}) })
        : await data.command(name, input as DatabaseSerializableValue, { idempotencyKey: requestId!, ...(signal ? { signal } : {}) });
      try { check(); } catch (error) { if (kind === 'command') throw new DatabaseError('DATABASE_OUTCOME_UNKNOWN', 'The messaging mutation may have committed; reconcile its original request identity.', { outcome: 'unknown', retryable: false }); throw error; }
      const command = result.value as { kind?: string; name?: string; output?: unknown };
      if (kind === 'command' && (command?.kind !== 'command' || command.name !== name)) throw unavailable('The messaging commit acknowledgment is invalid.');
      const envelope = kind === 'query' ? result.value : command.output;
      const value = envelope as { ok?: boolean; value?: unknown; code?: string; status?: number; hint?: unknown } | null;
      if (value?.ok === false && MESSAGING_CODES.includes(value.code as typeof MESSAGING_CODES[number]) && [403, 404, 409, 422, 429].includes(value.status!)) throw new AuthError('The messaging request was not accepted.', value.code!, value.status!);
      if (value?.ok !== true || !Object.hasOwn(value, 'value')) throw unavailable('The messaging acknowledgment is invalid.');
      if (kind === 'command' && !('replayed' in result && result.replayed) && value.hint !== undefined) {
        let hint: ReturnType<typeof readMessagingCommitHint> | null = null;
        try { hint = readMessagingCommitHint(value.hint); } catch { /* Incompatible advisory metadata requests safe revalidation, never a guessed row result or changed commit outcome. */ }
        for (const entry of this.listeners.get(createDatabaseRef(id)) ?? []) if (hint === null || messagingHintMatches(hint, entry.filter)) try { entry.listener(); } catch { /* Advisory only; projections still reauthorize. */ }
      }
      return value.value as T;
    } catch (error) {
      const rejected = readMessagingActorRejection(error);
      if (!rejected && error instanceof DatabaseError) {
        try { emitPlatformCodeTo(this.options.observability, OBS_CODES.MESSAGING_OPERATION_REJECTED, { metadata: { operation: name, failureCode: error.code, outcome: error.outcome } }); } catch { /* Diagnostics never change the domain outcome. */ }
      }
      throw rejected ?? error;
    } finally { lease.release(); }
  }
  private assertReady(): void { if (this.state !== 'ready') throw unavailable('Messaging is unavailable.'); }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    try { this.assertReady(); } catch (error) { return Promise.reject(error); }
    const pending = operation(); this.active.add(pending); return pending.finally(() => { this.active.delete(pending); });
  }
}
function databaseId(scope: ServiceDataScope): string { return 'messaging:' + messagingHash(serviceDataScopeKey(scope)); }
function unavailable(message: string) { return new AuthError(message, 'MESSAGING_NOT_READY', 503); }
function synchronousGuard(callback: () => void): () => void {
  return () => { invokeSynchronousAuthCallback(callback, { component: 'messaging', invariant: 'current-authority-is-synchronous',
    message: 'Messaging authority checks must not yield.', createError: () => new AuthError('Messaging authority checks must not yield.', 'MESSAGING_CONFIG_INVALID', 500) }); };
}

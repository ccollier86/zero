/** Private, app-local Fabric lifecycle. Public callers must use the admitted jobs service, never this broker. */
import { existsSync } from 'node:fs';
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
import type { ReactiveDB } from '../sync/reactive-db';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { ResolvedJobsPersistenceConfig } from './persistence-config';
import { jobsRealm } from './realm';
import { jobHash, jobInteger, jobText, jobTime } from './validation';
import { jobScope } from './realm-model';
import { installJobsOwnerSchema } from './owner-schema';
import { JobsError, JOBS_REJECTIONS, readJobRejection } from './error';
import { readJobCommitHint, type JobCommitHint } from './commit-hints';
import type { JobsLoggingSource } from './logging';

export interface JobsOwnerRecord { id: string; scope_id: string; owner_id: string; root_hash: string; realm_fingerprint: string; established: number; wake_at: number | null; wake_generation: number }
export interface JobsDueCursor { readonly wakeAt: number; readonly id: string }
export interface JobsDueScope { readonly scope: ServiceDataScope; readonly cursor: JobsDueCursor }
export interface JobsRuntimeOptions {
  config: ResolvedJobsPersistenceConfig; system: ReactiveDB; installAllowed: boolean;
  authority: { coordinator: AuthorityCommitCoordinator; actorContext: DatabaseActorAuthorityContext | null };
  source?: (coordinator: DatabaseCoordinator) => JobsLoggingSource;
}
export interface JobsSubscription { readonly ownerId?: string; readonly scheduleId?: string }
export class JobsRuntime {
  private state: 'ready' | 'closing' | 'closed' = 'ready';
  private closeTask: Promise<void> | null = null;
  private readonly initializers = new Map<string, Promise<void>>();
  private readonly bound = new Set<string>();
  private readonly active = new Set<Promise<unknown>>();
  private readonly scopeWrites = new Map<string, number>();
  private readonly listeners = new Map<string, Set<{ listener(): void; filter: JobsSubscription }>>();
  private readonly pendingHints = new Map<string, Map<string, JobCommitHint>>();
  private hintQueued = false;
  private readonly rootHash: string;
  private source: JobsLoggingSource | null = null;
  private constructor(private readonly options: JobsRuntimeOptions, private readonly owner: DatabaseCoordinator) {
    this.rootHash = jobHash(canonicalDatabaseRootIdentity(options.config.rootDirectory));
  }
  static async open(options: JobsRuntimeOptions): Promise<JobsRuntime> {
    if (options.config.defaultActorEntrypoint && !existsSync(options.config.defaultActorEntrypoint)) throw new JobsError('JOBS_NOT_READY');
    if (!installJobsOwnerSchema(options.system, options.installAllowed)) throw new JobsError('JOBS_NOT_READY');
    const concurrency = options.config.concurrency;
    const owner = new DatabaseCoordinator({ rootDirectory: options.config.rootDirectory, realm: jobsRealm, createExecutor: options.config.createExecutor,
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true,
      maxDatabases: options.config.maxActiveDatabases, maxDatabaseFiles: options.config.maxDatabaseFiles,
      maxQueuedPerDatabase: Math.max(64, concurrency * 3), maxQueuedTotal: Math.max(256, concurrency * 4),
      queueTimeoutMs: 5000, operationTimeoutMs: 15000, sweepIntervalMs: false,
      authorityCommitCoordinator: options.authority.coordinator, requireCommitAuthority: true,
      ...(options.authority.actorContext ? { actorAuthorityContext: options.authority.actorContext } : {}) });
    const runtime = new JobsRuntime(options, owner);
    try {
      runtime.source = options.source?.(owner) ?? null;
      for (const record of runtime.records()) { runtime.assertRetained(record); runtime.prepareSource(record); }
      owner.start(); return runtime;
    } catch (error) { try { await runtime.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Jobs startup and cleanup failed.'); } throw error; }
  }
  read<T>(scope: ServiceDataScope, name: string, input: unknown, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    const guard = synchronousGuard(assertCurrent);
    return this.track(async () => { guard(); const id = await this.ensure(scope, guard); return this.execute(id, 'query', name, input, undefined, guard, signal); });
  }
  write<T>(scope: ServiceDataScope, name: string, input: unknown, requestId: string, assertCurrent: () => void, signal?: AbortSignal): Promise<T> {
    const guard = synchronousGuard(assertCurrent);
    return this.track(async () => {
      guard(); const id = await this.ensure(scope, guard);
      this.scopeWrites.set(id, (this.scopeWrites.get(id) ?? 0) + 1);
      let accepted = false;
      try {
        // Dirty-before-write survives parent death between private commit and
        // SYSTEM wake publication. No SQL lease survives this short admission.
        await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
          guard(); const row = this.options.system.prepare('SELECT wake_generation FROM _jobs_owners WHERE id=?').get(id) as { wake_generation: number } | null;
          if (!row || row.wake_generation >= Number.MAX_SAFE_INTEGER) throw new JobsError('JOBS_STATE_INVALID');
          this.options.system.prepare('UPDATE _jobs_owners SET wake_at=0,wake_generation=wake_generation+1 WHERE id=?').run(id);
        }));
        const result = await this.execute<T>(id, 'command', name, input, requestId, guard, signal); accepted = true; return result;
      } finally {
        const count = (this.scopeWrites.get(id) ?? 1) - 1; if (count) this.scopeWrites.set(id, count); else this.scopeWrites.delete(id);
        if (!count) try { await this.refreshWake(scope, Date.now(), guard); } catch { /* Durable dirty marker remains due; never rewrite a committed command's outcome. */ }
        if (accepted) try { guard(); } catch { throw new JobsError('JOBS_OUTCOME_UNKNOWN'); }
      }
    });
  }
  dueScopes(now: number, limit: number): readonly ServiceDataScope[] {
    return this.dueScopePage(now, limit).map(entry => entry.scope);
  }
  /** Private indexed keyset discovery; backed-off roots must not hide later due files. */
  dueScopePage(now: number, limit: number, after?: JobsDueCursor): readonly JobsDueScope[] {
    this.assertReady(); jobTime(now); jobInteger(limit, 1, 100);
    if (after) { jobTime(after.wakeAt); jobText(after.id, 128); }
    const records = after
      ? this.options.system.prepare('SELECT * FROM _jobs_owners WHERE established=1 AND wake_at<=? AND (wake_at,id)>(?,?) ORDER BY wake_at,id LIMIT ?').all(now, after.wakeAt, after.id, limit) as JobsOwnerRecord[]
      : this.options.system.prepare('SELECT * FROM _jobs_owners WHERE established=1 AND wake_at<=? ORDER BY wake_at,id LIMIT ?').all(now, limit) as JobsOwnerRecord[];
    return records.map(record => { this.assertRetained(record); return { scope: scopeOf(record), cursor: { wakeAt: record.wake_at!, id: record.id } }; });
  }
  /** Refresh only after every in-process scope write settled. CAS fences a concurrent new dirty generation. */
  refreshWake(scope: ServiceDataScope, now: number, assertCurrent: () => void): Promise<void> {
    return this.track(() => this.refreshScopeWake(scope, now, assertCurrent));
  }
  private async refreshScopeWake(scope: ServiceDataScope, now: number, assertCurrent: () => void): Promise<void> {
    const guard = synchronousGuard(assertCurrent), id = databaseId(scope); guard(); jobTime(now);
    if (this.scopeWrites.has(id)) return;
    const record = this.options.system.prepare('SELECT wake_generation FROM _jobs_owners WHERE id=? AND established=1').get(id) as { wake_generation: number } | null;
    if (!record) return;
    const next = await this.execute<number | null>(id, 'query', 'jobs.wake', { scopeId: serviceDataScopeKey(scope), now }, undefined, guard);
    if (next !== null) jobTime(next);
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); if (this.scopeWrites.has(id)) return;
      this.options.system.prepare('UPDATE _jobs_owners SET wake_at=? WHERE id=? AND wake_generation=? AND established=1').run(next, id, record.wake_generation);
    }));
  }
  deferWake(scope: ServiceDataScope, at: number, assertCurrent: () => void): Promise<void> {
    return this.track(async () => {
    const guard = synchronousGuard(assertCurrent), id = databaseId(scope); jobTime(at);
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); if (this.scopeWrites.has(id)) return;
      this.options.system.prepare('UPDATE _jobs_owners SET wake_at=? WHERE id=? AND established=1').run(at, id);
    }));
    });
  }
  /** Advisory only. The outer adapter must reauthorize/requery; no row data or private input is broadcast. */
  subscribe(scope: ServiceDataScope, listener: () => void, filter: JobsSubscription): () => void {
    this.assertReady(); const total = [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0);
    if (total >= 1024) throw new JobsError('JOBS_CAPACITY');
    const ref = createDatabaseRef(databaseId(scope));
    const entry = { listener, filter: Object.freeze({ ...(filter.ownerId === undefined ? {} : { ownerId: jobText(filter.ownerId, 128) }),
      ...(filter.scheduleId === undefined ? {} : { scheduleId: jobText(filter.scheduleId, 96) }) }) };
    let entries = this.listeners.get(ref); if (!entries) this.listeners.set(ref, entries = new Set()); entries.add(entry);
    return () => { entries!.delete(entry); if (!entries!.size) this.listeners.delete(ref); };
  }
  diagnostics() { return { state: this.state, filesBound: this.bound.size, activeOperations: this.active.size, fabric: this.owner.diagnostics() }; }
  retainedScopes(): readonly ServiceDataScope[] {
    this.assertReady(); return this.records().filter(record => record.established === 1).map(record => {
      this.assertRetained(record); return scopeOf(record);
    });
  }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.state = 'closing'; this.listeners.clear(); this.pendingHints.clear();
    this.closeTask = (async () => { await Promise.allSettled([...this.active]); try { await this.source?.close(); } finally { await this.owner.close(); this.state = 'closed'; } })();
    return this.closeTask;
  }
  private records(): JobsOwnerRecord[] {
    const rows = this.options.system.prepare('SELECT * FROM _jobs_owners ORDER BY id LIMIT ?').all(this.options.config.maxDatabaseFiles + 1) as JobsOwnerRecord[];
    if (rows.length > this.options.config.maxDatabaseFiles) throw new JobsError('JOBS_STATE_INVALID'); return rows;
  }
  private async ensure(scope: ServiceDataScope, guard: () => void): Promise<string> {
    const id = databaseId(scope); if (this.bound.has(id)) return id;
    let task = this.initializers.get(id);
    if (!task) {
      task = this.bind(id, serviceDataScopeKey(scope), guard); this.initializers.set(id, task);
      void task.finally(() => { if (this.initializers.get(id) === task) this.initializers.delete(id); }).catch(() => {});
    }
    await task; guard(); return id;
  }
  private async bind(id: string, scopeId: string, guard: () => void): Promise<void> {
    let record!: JobsOwnerRecord;
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); const prior = this.options.system.prepare('SELECT * FROM _jobs_owners WHERE id=?').get(id) as JobsOwnerRecord | null;
      if (prior) { this.assertRetained(prior); if (prior.scope_id !== scopeId) throw new JobsError('JOBS_STATE_INVALID'); record = prior; return; }
      if (existsSync(resolveDatabaseFile(this.options.config.rootDirectory, id).path)) throw new JobsError('JOBS_STATE_INVALID');
      if (this.records().length >= this.options.config.maxDatabaseFiles) throw new JobsError('JOBS_CAPACITY');
      record = { id, scope_id: scopeId, owner_id: 'job_' + crypto.randomUUID(), root_hash: this.rootHash, realm_fingerprint: jobsRealm.fingerprint, established: 0, wake_at: 0, wake_generation: 0 };
      this.options.system.prepare('INSERT INTO _jobs_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established,wake_at,wake_generation) VALUES(?,?,?,?,?,0,0,0)').run(id, scopeId, record.owner_id, this.rootHash, jobsRealm.fingerprint);
    }));
    this.prepareSource(record);
    await this.execute(id, 'command', 'jobs.owner.bind', { ownerId: record.owner_id, scopeId }, 'jobs-owner:' + record.owner_id + ':' + jobsRealm.fingerprint, guard);
    await withReactiveDBCommitAdmission(this.options.system, () => this.options.system.transaction(() => {
      guard(); this.options.system.prepare('UPDATE _jobs_owners SET established=1,realm_fingerprint=? WHERE id=? AND owner_id=?').run(jobsRealm.fingerprint, id, record.owner_id);
    }));
    this.bound.add(id);
  }
  private assertRetained(record: JobsOwnerRecord): void {
    try { jobScope(record.scope_id); } catch { throw new JobsError('JOBS_STATE_INVALID'); }
    if (record.id !== 'jobs:' + jobHash(record.scope_id) || !/^job_[a-f0-9-]{36}$/.test(record.owner_id)
      || ![0, 1].includes(record.established) || !/^sha256:[a-f0-9]{64}$/.test(record.realm_fingerprint)
      || !Number.isSafeInteger(record.wake_generation) || record.wake_generation < 0 || record.wake_at !== null && (!Number.isSafeInteger(record.wake_at) || record.wake_at < 0)
      || record.root_hash !== this.rootHash || record.established === 1 && !existsSync(resolveDatabaseFile(this.options.config.rootDirectory, record.id).path)) throw new JobsError('JOBS_STATE_INVALID');
    if (!this.options.installAllowed && record.realm_fingerprint !== jobsRealm.fingerprint) throw new JobsError('JOBS_NOT_READY');
  }
  private prepareSource(record: JobsOwnerRecord): void {
    this.source?.prepare(record.id, scopeOf(record), () => {
      const current = this.options.system.prepare('SELECT established FROM _jobs_owners WHERE id=? AND owner_id=?').get(record.id, record.owner_id) as { established: number } | null;
      if (!current) throw new JobsError('JOBS_STATE_INVALID'); return current.established === 1;
    });
  }
  private async execute<T>(id: string, kind: 'query' | 'command', name: string, input: unknown, requestId: string | undefined, guard: () => void, signal?: AbortSignal): Promise<T> {
    const check = () => { if (this.state === 'closed') throw new JobsError('JOBS_NOT_READY'); guard(); };
    check(); const commitAuthority = createDatabaseCommitAuthority(this.options.authority.coordinator, id, () => { check(); return undefined; });
    const lease = await this.owner.acquire(id, { commitAuthority });
    try {
      check(); signal?.throwIfAborted();
      const data = createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor, assertReadAuthority: () => { check(); return undefined; } });
      const result = kind === 'query' ? await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' }, ...(signal ? { signal } : {}) })
        : await data.command(name, input as DatabaseSerializableValue, { idempotencyKey: requestId!, ...(signal ? { signal } : {}) });
      try { check(); } catch (error) { if (kind === 'command') throw new JobsError('JOBS_OUTCOME_UNKNOWN'); throw error; }
      const command = result.value as { kind?: string; name?: string; output?: unknown };
      if (kind === 'command' && (command?.kind !== 'command' || command.name !== name)) throw new JobsError('JOBS_OUTCOME_UNKNOWN');
      const envelope = (kind === 'query' ? result.value : command.output) as { ok?: boolean; value?: unknown; code?: string; hint?: unknown } | null;
      if (envelope?.ok === false && JOBS_REJECTIONS.includes(envelope.code as typeof JOBS_REJECTIONS[number])) throw new JobsError(envelope.code as typeof JOBS_REJECTIONS[number]);
      if (envelope?.ok !== true || !Object.hasOwn(envelope, 'value')) throw new JobsError(kind === 'command' ? 'JOBS_OUTCOME_UNKNOWN' : 'JOBS_NOT_READY');
      if (kind === 'command' && !('replayed' in result && result.replayed) && envelope.hint !== undefined) {
        // Malformed advisory metadata must not rewrite an acknowledged mutation's accepted outcome.
        try { this.queueHint(createDatabaseRef(id), readJobCommitHint(envelope.hint)); } catch { /* Retained reads still reauthorize; no guessed row events. */ }
        if (name === 'jobs.schedule.create' || name === 'jobs.schedule.change') {
          try { this.source?.wake(id); } catch { /* Durable source recovery, not a notification, owns delivery. */ }
        }
      }
      return envelope.value as T;
    } catch (error) {
      const rejected = readJobRejection(error); if (rejected) throw rejected;
      if (kind === 'command' && error instanceof DatabaseError && error.outcome === 'unknown') throw new JobsError('JOBS_OUTCOME_UNKNOWN');
      throw error;
    } finally { lease.release(); }
  }
  private queueHint(ref: string, hint: JobCommitHint): void {
    if (this.state !== 'ready' || !this.listeners.has(ref)) return;
    let hints = this.pendingHints.get(ref); if (!hints) this.pendingHints.set(ref, hints = new Map()); hints.set(hint.scheduleId, hint);
    if (this.hintQueued) return; this.hintQueued = true;
    queueMicrotask(() => {
      this.hintQueued = false; const batches = [...this.pendingHints]; this.pendingHints.clear(); if (this.state !== 'ready') return;
      for (const [scope, changes] of batches) for (const entry of this.listeners.get(scope) ?? []) {
        if (![...changes.values()].some(change => (entry.filter.ownerId === undefined || entry.filter.ownerId === change.ownerId)
          && (entry.filter.scheduleId === undefined || entry.filter.scheduleId === change.scheduleId))) continue;
        try { entry.listener(); } catch { /* Hints never change commit outcome. */ }
      }
    });
  }
  private assertReady(): void { if (this.state !== 'ready') throw new JobsError('JOBS_NOT_READY'); }
  private track<T>(run: () => Promise<T>): Promise<T> {
    try { this.assertReady(); } catch (error) { return Promise.reject(error); }
    const pending = run(); this.active.add(pending); return pending.finally(() => { this.active.delete(pending); });
  }
}
function databaseId(scope: ServiceDataScope): string { return 'jobs:' + jobHash(serviceDataScopeKey(scope)); }
function scopeOf(record: JobsOwnerRecord): ServiceDataScope { return record.scope_id === 'application' ? trustedSystemServiceDataScope({ scopeKind: 'application' }) : trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: record.scope_id.slice(7) }); }
function synchronousGuard(callback: () => void): () => void {
  return () => { invokeSynchronousAuthCallback(callback, { component: 'jobs', invariant: 'current-authority-is-synchronous',
    message: 'Job authority checks must not yield.', createError: () => new JobsError('JOBS_CONFIG_INVALID') }); };
}

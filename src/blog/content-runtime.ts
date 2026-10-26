/** Lifecycle owner for exactly one private Fabric blog database. It never grants request permissions or performs media I/O. */
import { existsSync } from 'node:fs';
import { DatabaseCoordinator } from '../databases/database-coordinator';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { DatabaseSerializableValue, AsyncDatabaseOperationExecutor } from '../databases/database-operations';
import { createDatabaseCommitAuthority } from '../databases/database-commit-authority';
import type { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import type { DatabaseActorAuthorityContext } from '../databases/database-actor-authority-context';
import { canonicalDatabaseRootIdentity, resolveDatabaseFile } from '../databases/database-file';
import { createDatabaseObservability } from '../databases/database-observability';
import { observeDatabaseCoordinatorCommits } from '../databases/database-coordinator-commit-notifications';
import type { PlatformObservabilityRuntime } from '../observability/types';
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from '../auth/types';
import { DatabaseError } from '../databases/database-error';
import type { ResolvedBlogContentConfig } from './content-config';
import { blogContentRealm } from './content-realm';
import { contentHash } from './content-rows';
import { readBlogActorRejection } from './content-errors';
import { installBlogContentOwnerSchema } from './content-owner-schema';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';

export const BLOG_CONTENT_DATABASE = 'blog:content';
export interface BlogContentRuntimeOptions {
  config: ResolvedBlogContentConfig;
  system: ReactiveDB;
  authority: { coordinator: AuthorityCommitCoordinator; actorContext: DatabaseActorAuthorityContext | null };
  observability: PlatformObservabilityRuntime;
  installAllowed: boolean;
  /** Framework-private source installation happens before Fabric starts admitting files. */
  source?: (coordinator: DatabaseCoordinator) => { close(): Promise<void>; wake(): void };
}
/** All content calls use the same one-file actor owner and the existing Guardian final-edge coordinator. */
export class BlogContentRuntime {
  private state: 'opening' | 'ready' | 'closing' | 'closed' = 'opening';
  private closing: Promise<void> | null = null;
  private source: ReturnType<NonNullable<BlogContentRuntimeOptions['source']>> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly active = new Set<Promise<unknown>>();
  private removeCommit: (() => void) | null = null;
  private constructor(private readonly options: BlogContentRuntimeOptions, private readonly owner: DatabaseCoordinator) {}
  /** Missing retained content is never silently recreated, and changing its root requires deliberate recovery. */
  static async open(options: BlogContentRuntimeOptions): Promise<BlogContentRuntime> {
    const { config, system, authority } = options;
    if (config.defaultActorEntrypoint && !existsSync(config.defaultActorEntrypoint)) throw unavailable('The packaged blog actor is missing; configure an explicit actor launch.');
    if (!installBlogContentOwnerSchema(system, options.installAllowed)) throw unavailable('The blog content owner needs a SYSTEM migration.');
    const rootHash = contentHash(canonicalDatabaseRootIdentity(config.rootDirectory));
    const prior = system.prepare('SELECT owner_id,root_hash,realm_fingerprint,established FROM _blog_content_owner WHERE id=?').get(BLOG_CONTENT_DATABASE) as { owner_id: string; root_hash: string; realm_fingerprint: string; established: number } | null;
    if (prior && prior.root_hash !== rootHash) throw unavailable('The retained blog content root changed; explicit recovery is required.');
    const exists = existsSync(resolveDatabaseFile(config.rootDirectory, BLOG_CONTENT_DATABASE).path);
    if (!prior && exists) throw unavailable('An existing blog database has no matching SYSTEM owner; explicit recovery is required.');
    if (prior?.established && !exists) throw unavailable('Retained blog content is missing; restore it instead of recreating an empty blog.');
    if (!options.installAllowed && (!exists || prior?.realm_fingerprint !== blogContentRealm.fingerprint)) throw unavailable('The blog content plane requires an explicit migration.');
    const ownerId = prior?.owner_id ?? `bln_${crypto.randomUUID()}`;
    if (!prior) await withReactiveDBCommitAdmission(system, () => system.transaction(() => system.prepare('INSERT INTO _blog_content_owner(id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,0)').run(BLOG_CONTENT_DATABASE, ownerId, rootHash, blogContentRealm.fingerprint)));
    const coordinator = new DatabaseCoordinator({ rootDirectory: config.rootDirectory, realm: blogContentRealm, createExecutor: config.createExecutor,
      placement: { default: 'file', hot: null }, sqlite: { synchronous: 'FULL' }, readers: true, maxDatabases: 1, maxDatabaseFiles: 1,
      maxQueuedPerDatabase: 64, maxQueuedTotal: 64, queueTimeoutMs: 5000, operationTimeoutMs: 15000, sweepIntervalMs: false,
      authorityCommitCoordinator: authority.coordinator, requireCommitAuthority: true,
      ...(authority.actorContext ? { actorAuthorityContext: authority.actorContext } : {}), observability: createDatabaseObservability(options.observability) });
    const runtime = new BlogContentRuntime(options, coordinator);
    try {
      runtime.source = options.source?.(coordinator) ?? null;
      runtime.removeCommit = observeDatabaseCoordinatorCommits(coordinator, () => { runtime.source?.wake(); for (const listener of runtime.listeners) try { listener(); } catch { /* Hints do not change durable outcomes. */ } });
      coordinator.start();
      await runtime.write('blog.owner.bind', { ownerId }, `blog-owner:${ownerId}:${blogContentRealm.fingerprint}`, () => {}, undefined, true);
      await runtime.read('blog.terms', { siteId: 'application', limit: 1 }, () => {}, undefined, true);
      await withReactiveDBCommitAdmission(system, () => system.transaction(() => system.prepare('UPDATE _blog_content_owner SET established=1,realm_fingerprint=? WHERE id=?').run(blogContentRealm.fingerprint, BLOG_CONTENT_DATABASE)));
      runtime.state = 'ready';
      return runtime;
    } catch (error) { try { await runtime.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Blog content startup and cleanup failed.'); } throw error; }
  }
  /** Read admission rechecks live authority after actor acquisition and after the exact returned snapshot. */
  read<T>(name: string, input: unknown, assertCurrent: () => void, signal?: AbortSignal, opening = false): Promise<T> {
    return this.track(opening, async () => {
    assertCurrent();
    const commitAuthority = createDatabaseCommitAuthority(this.options.authority.coordinator, BLOG_CONTENT_DATABASE, () => { this.assertOperation(opening); assertCurrent(); return undefined; });
    const lease = await this.owner.acquire(BLOG_CONTENT_DATABASE, { commitAuthority });
    try {
      signal?.throwIfAborted(); assertCurrent();
      const data = createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor, assertReadAuthority: () => { this.assertOperation(opening); assertCurrent(); return undefined; } });
      const result = await data.query(name, input as DatabaseSerializableValue, { consistency: { mode: 'strong' }, ...(signal ? { signal } : {}) });
      this.assertOperation(opening); assertCurrent(); return unwrap<T>(result.value);
    } catch (error) { throw readBlogActorRejection(error) ?? error; }
    finally { lease.release(); }
    });
  }
  /** A request identity is stable across uncertain retries; authorization is rechecked at the head of the writer FIFO. */
  write<T>(name: string, input: unknown, requestId: string, assertCurrent: () => void, signal?: AbortSignal, opening = false): Promise<T> {
    return this.track(opening, async () => {
    assertCurrent();
    const commitAuthority = createDatabaseCommitAuthority(this.options.authority.coordinator, BLOG_CONTENT_DATABASE, () => { this.assertOperation(opening); assertCurrent(); return undefined; });
    const lease = await this.owner.acquire(BLOG_CONTENT_DATABASE, { commitAuthority });
    try {
      signal?.throwIfAborted(); assertCurrent();
      const result = await createAsyncDatabaseClient({ executor: lease as AsyncDatabaseOperationExecutor }).command(name, input as DatabaseSerializableValue, { idempotencyKey: requestId, ...(signal ? { signal } : {}) });
      // A post-commit revocation must not fabricate an uncommitted outcome.
      try { this.assertOperation(opening); assertCurrent(); }
      catch { throw new DatabaseError('DATABASE_OUTCOME_UNKNOWN', 'The blog mutation may have committed; reconcile using its original request identity.', { outcome: 'unknown', retryable: false }); }
      const envelope = result.value as { kind?: string; name?: string; output?: unknown };
      if (envelope?.kind !== 'command' || envelope.name !== name) throw unavailable('The blog commit acknowledgment is invalid.');
      return unwrap<T>(envelope.output);
    } catch (error) { throw readBlogActorRejection(error) ?? error; }
    finally { lease.release(); }
    });
  }
  /** Payload-free changes only; a subscriber must re-read through its own current authorized facade. */
  subscribe(listener: () => void): () => void {
    this.assertReady(); if (this.listeners.size >= 128) throw new AuthError('Blog subscription capacity is exhausted.', 'BLOG_CAPACITY', 429);
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  diagnostics() { return { state: this.state, fabric: this.owner.diagnostics() }; }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.state = 'closing'; this.removeCommit?.(); this.removeCommit = null;
    for (const listener of this.listeners) try { listener(); } catch { /* Subscribers observe closure on their re-read. */ }
    this.listeners.clear();
    this.closing = (async () => {
      await Promise.allSettled([...this.active]);
      try { await this.source?.close(); } finally { await this.owner.close(); this.state = 'closed'; }
    })();
    return this.closing;
  }
  private assertReady(opening = false): void { if (this.state !== 'ready' && !(opening && this.state === 'opening')) throw unavailable('Blog content is unavailable.'); }
  /** An admitted operation may drain during shutdown; new operations are already rejected by track(). */
  private assertOperation(opening: boolean): void { if (this.state !== 'closing') this.assertReady(opening); }
  private track<T>(opening: boolean, operation: () => Promise<T>): Promise<T> {
    try { this.assertReady(opening); } catch (error) { return Promise.reject(error); }
    const active = operation(); this.active.add(active);
    return active.finally(() => { this.active.delete(active); });
  }
}
function unwrap<T>(value: unknown): T {
  if (!value || typeof value !== 'object') throw unavailable('The blog response is invalid.');
  const result = value as { ok?: boolean; value?: unknown; code?: string; status?: number };
  if (result.ok === false && typeof result.code === 'string' && /^BLOG_[A-Z_]+$/.test(result.code) && [403, 404, 409, 422, 429].includes(result.status!)) throw new AuthError('The blog request was not accepted.', result.code, result.status!);
  if (result.ok !== true || !Object.hasOwn(result, 'value')) throw unavailable('The blog response is invalid.');
  return result.value as T;
}
function unavailable(message: string) { return new AuthError(message, 'BLOG_NOT_READY', 503); }

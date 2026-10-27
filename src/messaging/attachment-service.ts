/** Private Storage/CAS orchestration. Fabric owns associations, short SYSTEM leases fence I/O, and no generic drive grant bypasses membership. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { StorageService } from '../storage/storage-service';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import { withoutLoggingAttribution } from '../logging/logging-attribution';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { ResolvedMessagingConfig } from './config';
import type { MessagingRuntime } from './runtime';
import type { MessagingActor } from './realm-model';
import type { MessagingMutationOptions } from './contracts';
import type { MessagingAttachment, ServerMessagingAttachmentsApi } from './attachment-contracts';
import { captureMessagingAttachment } from './attachment-validation';
import { installMessagingLeases, withMessagingAttachmentLease } from './attachment-leases';
import { messagingHash, messagingId } from './validation';
import { projectMessagingCommit } from './mutation-projection';

const NAMESPACE = 'zero.messaging.attachments';
export interface MessagingAttachmentAuthority {
  readonly scope: ServiceDataScope;
  capture(write?: boolean): { readonly actor: MessagingActor; check(): void };
  options(options: MessagingMutationOptions): MessagingMutationOptions;
  read<T>(name: string, input: object, signal?: AbortSignal): Promise<T>;
  write<T>(name: string, input: object, options: MessagingMutationOptions, fence: () => void): Promise<T>;
  run<T>(options: MessagingMutationOptions, operation: () => Promise<T>): Promise<T>;
}
/** Streamed file declarations are not a malware verdict. Content is always downloaded as an attachment, never executable inline HTML. */
export class MessagingAttachmentService {
  private stopped = false;
  private active = new Map<Promise<unknown>, AbortController>();
  private readonly streams = new Set<AbortController>();
  private readonly pending = new Map<string, { scope: ServiceDataScope; due: number }>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cleanup: Promise<void> | null = null;
  constructor(private readonly deps: { db: ReactiveDB; storage: StorageService; runtime: MessagingRuntime; config: ResolvedMessagingConfig; installAllowed: boolean; cleanupFailed(): void }) {}
  async initialize(): Promise<void> {
    await withReactiveDBCommitAdmission(this.deps.db, () => this.deps.db.transaction(() => {
      // The committed foundation reserved this receipt but never created a
      // drive-backed attachment service. Unknown experimental data is recovery
      // work, not permission to silently substitute a new empty namespace.
      if (this.deps.db.prepare('SELECT drive_id FROM _messaging_storage WHERE id=1').get()) throw new AuthError('An unqualified retained messaging Storage namespace requires explicit recovery.', 'MESSAGING_STATE_INVALID', 500);
      installMessagingLeases(this.deps.db, this.deps.installAllowed);
    }));
    for (const scope of this.deps.runtime.retainedScopes()) this.schedule(scope, 0);
  }
  forAuthority(authority: MessagingAttachmentAuthority): ServerMessagingAttachmentsApi {
    const read = async (conversationId: string, id: string, signal?: AbortSignal, upload = false) => { this.assertOpen();
      const result = await authority.read<MessagingAttachment>('messaging.attachment', { conversationId: messagingId(conversationId), id: messagingId(id), ...(upload ? { upload: true } : {}) }, signal); this.assertOpen(); return result; };
    const capture = (write: boolean, signal?: AbortSignal) => { const admitted = authority.capture(write); return { actor: admitted.actor, check: () => { this.assertOpen(); admitted.check(); signal?.throwIfAborted(); } }; };
    const key = (id: string) => messagingHash([serviceDataScopeKey(authority.scope), messagingId(id)]);
    return Object.freeze<ServerMessagingAttachmentsApi>({
      allocate: async (conversationId, input, options) => {
        const admitted = captureMessagingAttachment(input, this.deps.config.maxUploadBytes), opts = authority.options(options), { actor, check } = capture(true, opts.signal);
        const id = 'attachment_' + messagingHash([actor.scopeId, actor.kind, actor.id, opts.requestId]).slice(0, 40);
        const asset = await projectMessagingCommit(authority.write<MessagingAttachment>('messaging.attachment.allocate', { conversationId: messagingId(conversationId), id, input: admitted, maxUploadBytes: this.deps.config.maxUploadBytes }, opts, check), () => read(conversationId, id, opts.signal));
        this.schedule(authority.scope, Math.max(0, asset.expiresAt - Date.now() + 100)); return asset;
      },
      get: (conversationId, id, options) => read(conversationId, id, options?.signal),
      upload: (conversationId, id, body, options) => this.track(async owned => {
        const opts = authority.options(options), signal = AbortSignal.any([owned, AbortSignal.timeout(10 * 60000), ...(opts.signal ? [opts.signal] : [])]);
        const { check } = capture(true, signal), objectId = key(id);
        return authority.run(opts, () => withMessagingAttachmentLease(this.deps.db, objectId, check, async fence => {
          const asset = await read(conversationId, id, signal, true); fence();
          if (asset.state === 'ready') { if (body instanceof ReadableStream) await body.cancel().catch(() => {}); return asset; }
          const stored = await this.deps.storage.privateObjects.putStream(NAMESPACE, objectId, boundedBody(body, asset.sizeBytes, signal, fence), asset.mimeType,
            { sizeBytes: asset.sizeBytes, checksum: asset.checksum, maxBytes: Math.min(this.deps.config.maxUploadBytes, asset.sizeBytes) }, fence);
          fence();
          return projectMessagingCommit(authority.write<MessagingAttachment>('messaging.attachment.accept', { conversationId, id, checksum: stored.checksum, sizeBytes: stored.sizeBytes, mimeType: stored.mimeType }, opts, fence), () => read(conversationId, id, signal));
        }, this.deps.cleanupFailed));
      }).finally(() => this.schedule(authority.scope, 50)),
      remove: (conversationId, id, options) => this.track(async owned => {
        const opts = authority.options(options), signal = AbortSignal.any([owned, ...(opts.signal ? [opts.signal] : [])]), { check } = capture(true, signal);
        return authority.run(opts, () => withMessagingAttachmentLease(this.deps.db, key(id), check, async fence => {
          await authority.write('messaging.attachment.retire', { conversationId: messagingId(conversationId), id: messagingId(id) }, { ...opts, requestId: 'attachment-begin:' + messagingHash(opts.requestId) }, fence);
          await this.deps.storage.privateObjects.delete(NAMESPACE, key(id), fence); fence();
          return authority.write<{ removed: true }>('messaging.attachment.retire', { conversationId, id, finish: true }, opts, fence);
        }, this.deps.cleanupFailed));
      }).finally(() => this.schedule(authority.scope, 50)),
      open: async (conversationId, id, options) => {
        if (this.streams.size >= 32) throw new AuthError('Attachment stream capacity is exhausted.', 'MESSAGING_CAPACITY', 429);
        const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60000), ...(options?.signal ? [options.signal] : [])]);
        this.streams.add(controller);
        try {
          const { check } = capture(false, signal), asset = await read(conversationId, id, signal); check();
          if (asset.state !== 'ready' || !asset.messageId && asset.expiresAt <= Date.now()) throw unavailable();
          const value = await this.deps.storage.privateObjects.get(NAMESPACE, key(id), check); check();
          if (!value || value.object.checksum !== asset.checksum || value.object.sizeBytes !== asset.sizeBytes || value.object.mimeType !== asset.mimeType) { await value?.stream.cancel().catch(() => {}); throw unavailable(); }
          const reauthorize = async () => { const current = await read(conversationId, id, signal); check(); if (current.state !== 'ready' || current.checksum !== asset.checksum || asset.messageId !== null && current.messageId !== asset.messageId || !current.messageId && current.expiresAt <= Date.now()) throw unavailable(); };
          try { await reauthorize(); } catch (error) { await value.stream.cancel().catch(() => {}); throw error; }
          return { attachment: asset, stream: guardedDownload(value.stream, asset.sizeBytes, signal, reauthorize, () => { this.streams.delete(controller); controller.abort(); }) };
        } catch (error) { this.streams.delete(controller); controller.abort(); throw error; }
      },
    });
  }
  async close(): Promise<void> {
    this.stopped = true; clearTimeout(this.timer); this.pending.clear();
    for (const controller of this.streams) controller.abort(); this.streams.clear();
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled([...this.active.keys()]); await this.cleanup?.catch(() => {});
  }
  /** Recovery visits only known scopes, at most one bounded page at a time, then sleeps until the next actual expiry. */
  private schedule(scope: ServiceDataScope, delay: number): void {
    if (this.stopped) return;
    const key = serviceDataScopeKey(scope), due = Date.now() + delay, prior = this.pending.get(key);
    if (!prior || prior.due > due) this.pending.set(key, { scope, due });
    this.arm();
  }
  private arm(): void {
    clearTimeout(this.timer); if (this.stopped || this.cleanup || !this.pending.size) return;
    const due = Math.min(...[...this.pending.values()].map(value => value.due));
    this.timer = withoutLoggingAttribution(() => setTimeout(() => { this.timer = undefined; void this.reconcile(); }, Math.min(2 ** 31 - 1, Math.max(0, due - Date.now())))); this.timer.unref?.();
  }
  private reconcile(): Promise<void> {
    if (this.cleanup || this.stopped) return this.cleanup ?? Promise.resolve();
    const entry = [...this.pending.entries()].find(([, value]) => value.due <= Date.now()); if (!entry) { this.arm(); return Promise.resolve(); }
    const [scopeId, { scope }] = entry; this.pending.delete(scopeId);
    this.cleanup = withoutLoggingAttribution(async () => {
      const check = () => this.assertOpen();
      try {
        const page = await this.deps.runtime.read<{ items: { id: string }[]; nextExpiry: number | null }>(scope, 'messaging.attachments.pending', { scopeId }, check);
        for (const asset of page.items) {
          if (this.stopped) break;
          try {
            const objectId = messagingHash([scopeId, asset.id]);
            await withMessagingAttachmentLease(this.deps.db, objectId, check, async fence => {
              const input = { id: asset.id, scopeId, recovery: true };
              await this.deps.runtime.write(scope, 'messaging.attachment.retire', input, 'attachment-expire:' + objectId + ':begin', fence);
              await this.deps.storage.privateObjects.delete(NAMESPACE, objectId, fence); fence();
              await this.deps.runtime.write(scope, 'messaging.attachment.retire', { ...input, finish: true }, 'attachment-expire:' + objectId + ':finish', fence);
            }, this.deps.cleanupFailed);
          } catch { if (!this.stopped) this.deps.cleanupFailed(); }
        }
        if (page.items.length) this.schedule(scope, 60000);
        else if (page.nextExpiry !== null) this.schedule(scope, Math.max(0, page.nextExpiry - Date.now() + 100));
      } catch { if (!this.stopped) { this.deps.cleanupFailed(); this.schedule(scope, 60000); } }
    }).finally(() => { this.cleanup = null; this.arm(); });
    return this.cleanup;
  }
  private assertOpen(): void { if (this.stopped) throw unavailable(); }
  private track<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(unavailable());
    if (this.active.size >= 8) return Promise.reject(new AuthError('Attachment operation capacity is exhausted.', 'MESSAGING_CAPACITY', 429));
    const controller = new AbortController(), task = work(controller.signal); this.active.set(task, controller);
    // Retire owned readers even when provider admission fails before it starts
    // consuming the bounded body. The request's own controller is never aborted.
    return task.finally(() => { this.active.delete(task); controller.abort(); });
  }
}
function unavailable(): AuthError { return new AuthError('The private attachment is unavailable.', 'MESSAGING_ATTACHMENT_UNAVAILABLE', 422); }
/** Abort/cap before accepting each streamed chunk, including a stalled disconnected uploader. */
function boundedBody(body: Blob | Uint8Array | ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal, check: () => void): ReadableStream<Uint8Array> {
  const source = body instanceof ReadableStream ? body : body instanceof Blob ? body.stream() : new Blob([Uint8Array.from(body).buffer]).stream(), reader = source.getReader();
  let total = 0, done = false;
  const release = () => { if (done) return; done = true; signal.removeEventListener('abort', abort); };
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  return new ReadableStream({ async pull(controller) {
    try { signal.throwIfAborted(); check(); const chunk = await reader.read(); signal.throwIfAborted(); check();
      if (chunk.done) { release(); controller.close(); return; } total += chunk.value.byteLength;
      if (total > maximum) throw unavailable(); controller.enqueue(chunk.value);
    } catch (error) { release(); await reader.cancel().catch(() => {}); controller.error(error); }
  }, async cancel() { release(); await reader.cancel().catch(() => {}); } });
}
/** Canonical membership/history is rechecked before releasing every chunk; buffered bytes are not proof of continuing authorization. */
function guardedDownload(stream: ReadableStream<Uint8Array>, maximum: number, signal: AbortSignal, check: () => Promise<void>, release: () => void): ReadableStream<Uint8Array> {
  const reader = stream.getReader(); let total = 0, done = false;
  const finish = () => { if (done) return; done = true; signal.removeEventListener('abort', abort); release(); };
  const abort = () => { void reader.cancel().catch(() => {}); finish(); }; signal.addEventListener('abort', abort, { once: true });
  return new ReadableStream({ async pull(controller) {
    try { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); await check(); signal.throwIfAborted();
      if (next.done) { if (total !== maximum) throw unavailable(); finish(); controller.close(); return; }
      total += next.value.byteLength; if (total > maximum) throw unavailable(); controller.enqueue(next.value);
    } catch (error) { finish(); await reader.cancel().catch(() => {}); controller.error(error); }
  }, async cancel() { finish(); await reader.cancel().catch(() => {}); } });
}

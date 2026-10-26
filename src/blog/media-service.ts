/** Private Storage-backed blog media orchestration. Fabric owns manifests; short SYSTEM leases fence external I/O, never hold a SQL transaction across it. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { StorageService } from '../storage/storage-service';
import type { FileInfo } from '../storage/types';
import { trustedSystemServiceDataScope } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import { withReactiveDBCommitAdmission } from '../sync/reactive-db-commit-admission';
import type { BlogContentRuntime } from './content-runtime';
import type { ContentActor } from './content-rows';
import { contentHash } from './content-rows';
import { blogId } from './content-validation';
import { captureBlogMediaInput, BLOG_MEDIA_MIMES } from './media-validation';
import type { BlogMediaApi, BlogMediaAsset } from './media-types';
import type { BlogMutationOptions } from './content-types';
import type { ResolvedBlogContentConfig } from './content-config';
import { withBlogMediaLease } from './media-leases';
import type { Row } from '../sync/types';
import { withoutLoggingAttribution } from '../logging/logging-attribution';
import { BlogImageProcessor } from './media-image-processor';

const GLOBAL = trustedSystemServiceDataScope({ scopeKind: 'application' });
type RequestOptions = { requestId: string; signal?: AbortSignal };
export interface BlogMediaAuthority {
  actor(write?: boolean): ContentActor;
  options(options: BlogMutationOptions): RequestOptions;
  write<T>(name: string, input: unknown, options: RequestOptions, check: () => void): Promise<T>;
}
export interface BlogMediaSnapshot { asset: BlogMediaAsset; checksum: string | null }
export interface BlogMediaDownload { stream: ReadableStream<Uint8Array>; asset: BlogMediaAsset; start: number; end: number; partial: boolean }
export interface BlogServerMediaApi extends BlogMediaApi { open(id: string, range?: string | null, signal?: AbortSignal): Promise<BlogMediaDownload> }

/** Server-owned paths are independent of filenames, account data and browser-selected Storage drives. */
export class BlogMediaService {
  private driveId: string | null = null;
  private stopped = false;
  private active = new Set<Promise<unknown>>();
  private cleanup: Promise<void> | null = null;
  private cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  private cleanupDue = Infinity;
  private readonly images: BlogImageProcessor;
  constructor(private readonly deps: { db: ReactiveDB; storage: StorageService; content: BlogContentRuntime; config: ResolvedBlogContentConfig; installAllowed: boolean; cleanupFailed(): void }) {
    this.images = new BlogImageProcessor({ maxInput: Math.min(20 * 1024 * 1024, deps.config.maxUploadBytes), maxPixels: deps.config.maxImagePixels, maxOutput: deps.config.maxUploadBytes });
  }
  /** A missing retained namespace is an explicit recovery error, never an invitation to recreate a drive. */
  async initialize(): Promise<void> {
    await withReactiveDBCommitAdmission(this.deps.db, () => this.deps.db.transaction(() => {
      const row = this.deps.db.prepare('SELECT drive_id FROM _blog_media_namespace WHERE id=1').get() as { drive_id: string } | null;
      if (row) { this.driveId = row.drive_id; this.namespace(); return; }
      if (!this.deps.installAllowed) throw unavailable();
      const driveId = `drv_${crypto.randomUUID()}`;
      this.deps.storage.createDriveRecord({ driveId, ownerId: null, scope: GLOBAL,
        params: { name: 'Blog private media', public: false, maxFileSize: 1024 * 1024 * 1024, allowedMimeTypes: Object.values(BLOG_MEDIA_MIMES).flat() } });
      this.deps.db.prepare('INSERT INTO _blog_media_namespace(id,drive_id) VALUES(1,?)').run(driveId); this.driveId = driveId;
    }));
    await this.reconcile();
  }
  /** Author/library authority is current on both sides of every asynchronous operation. */
  forAuthority(authority: BlogMediaAuthority): BlogServerMediaApi {
    const capture = (write = false) => {
      const actor = authority.actor(write);
      const check = () => {
        const current = authority.actor(write);
        if (contentHash(current) !== contentHash(actor)) throw new AuthError('Blog media authority changed.', 'AUTH_STATE_CHANGED', 409);
      };
      return { actor, check };
    };
    const read = (id: string, write = false, signal?: AbortSignal) => {
      const { actor, check } = capture(write);
      return this.deps.content.read<BlogMediaSnapshot>('blog.media', { actor, id: blogId(id) }, check, signal);
    };
    return Object.freeze<BlogServerMediaApi>({
      list: (query = {}, options) => { const { actor, check } = capture(); return this.deps.content.read('blog.media.list', { actor, query }, check, options?.signal); },
      get: async (id, options) => (await read(id, false, options?.signal)).asset,
      allocate: (input, options) => {
        const admitted = captureBlogMediaInput(input), { actor, check } = capture(true), opts = authority.options(options);
        const id = `bma_${contentHash([actor.siteId, actor.actorId, options.requestId]).slice(0, 40)}`;
        return authority.write<BlogMediaAsset>('blog.media.allocate', { actor, id, input: admitted }, opts, check).then(asset => {
          this.requestCleanup(Math.max(0, asset.expiresAt - Date.now() + 100)); return asset;
        });
      },
      upload: (id, body, options) => this.track(async () => {
        blogId(id); const { actor, check } = capture(true), opts = authority.options(options);
        opts.signal?.throwIfAborted();
        return withBlogMediaLease(this.deps.db, id, () => { check(); opts.signal?.throwIfAborted(); }, async fence => {
          const snapshot = await read(id, true, opts.signal); fence();
          if (snapshot.asset.state === 'ready') { if (body instanceof ReadableStream) await body.cancel(); return snapshot.asset; }
          if (snapshot.asset.state !== 'allocated' || snapshot.asset.expiresAt <= Date.now()) throw unavailable();
          const drive = this.namespace(), stagingPath = this.staging(id), assetPath = this.path(id);
          let staged = this.deps.storage.objects.get(drive, stagingPath);
          if (!staged) staged = await this.deps.storage.objects.upload(drive, stagingPath, body, snapshot.asset.fileName, actor.actorId,
            { public: false, overwrite: false, maxSize: snapshot.asset.kind === 'image' ? Math.min(20 * 1024 * 1024, this.deps.config.maxUploadBytes) : this.deps.config.maxUploadBytes,
              allowedMimeTypes: [snapshot.asset.mimeType] }, GLOBAL, async () => { fence(); }, undefined, fence);
          else if (body instanceof ReadableStream) await body.cancel();
          fence(); this.assertFile(staged, snapshot.asset.mimeType);
          let stored = this.deps.storage.objects.get(drive, assetPath), width: number | null = null, height: number | null = null;
          if (snapshot.asset.kind === 'image') {
            const normalized = await this.images.normalize(async () => {
              const loaded = await this.deps.storage.objects.download(drive, stagingPath, fence); fence();
              if (!loaded) throw unavailable();
              return readImageBytes(loaded.stream, Math.min(20 * 1024 * 1024, this.deps.config.maxUploadBytes), fence);
            }, fence, opts.signal); fence();
            width = normalized.width; height = normalized.height;
            if (!stored) stored = await this.deps.storage.objects.upload(drive, assetPath, normalized.bytes, 'blog-image.webp', actor.actorId,
              { public: false, overwrite: false, allowedMimeTypes: ['image/webp'], maxSize: this.deps.config.maxUploadBytes }, GLOBAL, async () => { fence(); }, undefined, fence);
            if (stored.checksum !== new Bun.CryptoHasher('sha256').update(normalized.bytes).digest('hex')) throw unavailable();
          } else {
            if (!stored) stored = await this.deps.storage.objects.copy(drive, stagingPath, assetPath, fence);
            if (stored.checksum !== staged.checksum) throw unavailable();
          }
          fence(); this.assertFile(stored!, snapshot.asset.kind === 'image' ? 'image/webp' : snapshot.asset.mimeType);
          const accepted = await authority.write<BlogMediaAsset>('blog.media.accept', { actor, id, checksum: stored!.checksum, sizeBytes: stored!.sizeBytes, mimeType: stored!.mimeType, width, height }, opts, () => {
            fence(); const current = this.deps.storage.objects.get(drive, assetPath);
            if (!current || current.checksum !== stored!.checksum || current.sizeBytes !== stored!.sizeBytes || current.isPublic) throw unavailable();
          });
          // Publication is already durable. Failed staging cleanup must not misreport the upload as uncommitted.
          try {
            await this.deps.storage.objects.delete(drive, stagingPath, fence);
            await authority.write('blog.media.clean', { actor, id }, { ...opts, requestId: opts.requestId + ':clean' }, fence);
          } catch { this.deps.cleanupFailed(); this.requestCleanup(); }
          return accepted;
        }, this.deps.cleanupFailed);
      }),
      remove: (id, options) => this.track(async () => {
        blogId(id); const { actor, check } = capture(true), opts = authority.options(options);
        return withBlogMediaLease(this.deps.db, id, check, async fence => {
          await read(id, true, opts.signal); fence();
          await authority.write('blog.media.retire', { actor, id }, { ...opts, requestId: opts.requestId + ':begin' }, fence);
          await this.deps.storage.objects.delete(this.namespace(), this.staging(id), fence); fence();
          await this.deps.storage.objects.delete(this.namespace(), this.path(id), fence); fence();
          return authority.write<{ removed: true }>('blog.media.retire', { actor, id, finish: true }, { ...opts, requestId: opts.requestId + ':finish' }, fence);
        }, this.deps.cleanupFailed);
      }).finally(() => this.requestCleanup()),
      open: async (id, range, signal) => {
        const { check } = capture(), snapshot = await read(id, false, signal); check();
        return this.open(snapshot, check, range);
      },
    });
  }
  /** Public controllers must resolve a current published association before and after Storage preparation. */
  open(snapshot: BlogMediaSnapshot, check: () => void, range?: string | null): Promise<BlogMediaDownload> {
    return this.track(async () => {
      check(); const { asset, checksum } = snapshot;
      if (asset.state !== 'ready' || !checksum || !asset.sizeBytes) throw unavailable();
      const { start, end, partial } = mediaRange(range, asset.sizeBytes);
      const result = partial ? await this.deps.storage.objects.downloadRange(this.namespace(), this.path(asset.id), start, end, check)
        : await this.deps.storage.objects.download(this.namespace(), this.path(asset.id), check);
      check();
      if (!result || result.info.checksum !== checksum || result.info.sizeBytes !== asset.sizeBytes || result.info.mimeType !== asset.mimeType || result.info.isPublic) {
        await result?.stream.cancel().catch(() => {}); throw unavailable();
      }
      return { stream: result.stream, asset, start, end, partial };
    });
  }
  async close(): Promise<void> { this.stopped = true; this.images.close(); clearTimeout(this.cleanupTimer); await Promise.allSettled([...this.active]); await this.cleanup?.catch(() => {}); }
  /** Bounded retained recovery, with no idle polling after the queue empties. Leases protect against live upload/removal work. */
  private reconcile(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    if (this.stopped) return Promise.resolve();
    const check = () => { if (this.stopped) throw unavailable(); this.namespace(); };
    this.cleanup = withoutLoggingAttribution(async () => {
      try {
        const pending = await this.deps.content.read<Row[]>('blog.media.pending', {}, check);
        for (const row of pending) {
          if (this.stopped) break;
          const id = blogId(row.id), actor: ContentActor = { siteId: String(row.site_id), actorId: String(row.owner_id), manage: true, publish: false };
          try {
            await withBlogMediaLease(this.deps.db, id, check, async fence => {
              if (row.state === 'ready') {
                await this.deps.storage.objects.delete(this.namespace(), this.staging(id), fence);
                await this.deps.content.write('blog.media.clean', { actor, id }, `blog-media-clean:${id}:${row.checksum}`, fence);
              } else {
                await this.deps.content.write('blog.media.retire', { actor, id }, `blog-media-retire:${id}:begin`, fence);
                await this.deps.storage.objects.delete(this.namespace(), this.staging(id), fence);
                await this.deps.storage.objects.delete(this.namespace(), this.path(id), fence);
                await this.deps.content.write('blog.media.retire', { actor, id, finish: true }, `blog-media-retire:${id}:finish`, fence);
              }
            }, this.deps.cleanupFailed);
          } catch (error) { if (!this.stopped && !(error instanceof AuthError && error.code === 'BLOG_MEDIA_BUSY')) this.deps.cleanupFailed(); }
        }
        if (pending.length) this.requestCleanup(60000);
        else {
          const next = await this.deps.content.read<{ expiresAt: number } | null>('blog.media.next-expiry', {}, check);
          if (next) this.requestCleanup(Math.max(0, next.expiresAt - Date.now() + 100));
        }
      } catch { if (!this.stopped) { this.deps.cleanupFailed(); this.requestCleanup(60000); } }
    }).finally(() => { this.cleanup = null; });
    return this.cleanup;
  }
  private requestCleanup(delay = 50): void {
    const due = Date.now() + delay;
    if (this.stopped || this.cleanupTimer && this.cleanupDue <= due) return;
    clearTimeout(this.cleanupTimer); this.cleanupDue = due;
    this.cleanupTimer = withoutLoggingAttribution(() => setTimeout(() => { this.cleanupTimer = undefined; this.cleanupDue = Infinity; void this.reconcile(); }, delay)); this.cleanupTimer.unref?.();
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopped) return Promise.reject(unavailable());
    const active = operation(); this.active.add(active); return active.finally(() => { this.active.delete(active); });
  }
  private namespace(): string {
    const drive = this.driveId ? this.deps.storage.drives.get(this.driveId) : null;
    if (!drive || drive.public !== 0 || drive.tenant_id !== null || drive.owner_id !== null) throw unavailable();
    return this.driveId!;
  }
  private staging(id: string) { return `/blog/staging/${blogId(id)}`; }
  private path(id: string) { return `/blog/assets/${blogId(id)}`; }
  private assertFile(info: FileInfo, mime: string) {
    if (!info.checksum || info.isPublic || info.mimeType !== mime || info.sizeBytes < 1 || info.sizeBytes > this.deps.config.maxUploadBytes) throw unavailable();
  }
}
/** One byte range only; malformed and unsatisfiable ranges never become an unbounded full response. */
export function mediaRange(range: string | null | undefined, size: number) {
  if (!range) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || !match[1] && !match[2]) throw new AuthError('The requested media range is unavailable.', 'BLOG_MEDIA_RANGE_INVALID', 416);
  let start: number, end: number;
  if (!match[1]) { const suffix = Number(match[2]); if (!Number.isSafeInteger(suffix) || suffix < 1) throw new AuthError('The requested media range is unavailable.', 'BLOG_MEDIA_RANGE_INVALID', 416); start = Math.max(0, size - suffix); end = size - 1; }
  else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new AuthError('The requested media range is unavailable.', 'BLOG_MEDIA_RANGE_INVALID', 416);
  return { start, end: Math.min(end, size - 1), partial: true };
}
async function readImageBytes(stream: ReadableStream<Uint8Array>, maximum: number, check: () => void) {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) { check(); const next = await reader.read(); check(); if (next.done) break; length += next.value.byteLength; if (length > maximum) throw unavailable(); chunks.push(next.value); }
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
  } finally { await reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Native-reader cleanup is best effort. */ } }
}
function unavailable() { return new AuthError('The blog media asset is unavailable.', 'BLOG_MEDIA_UNAVAILABLE', 422); }

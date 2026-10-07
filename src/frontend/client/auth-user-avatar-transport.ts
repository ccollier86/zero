/** Guardian avatar HTTP/storage protocol. One captured identity fences all stage, upload, commit and private-delivery awaits. */
import type { UserAvatarAsset, UserAvatarSnapshot, UserAvatarStage } from '../../auth/auth-user-avatar-types';
import { AuthClientError, createAuthClientError } from './auth-errors';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';
import { isUserAvatarAsset, isUserAvatarDirectoryEntry, isUserAvatarSnapshot, isUserAvatarStage } from './auth-user-avatar-parser';

export interface UserAvatarRequestScope { readonly userId: string; readonly signal: AbortSignal; assertCurrent(): void }
export interface AuthUserAvatarTransportOptions {
  baseUrl: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  assertResponseCurrent(response: Response): void;
  runScoped<T>(operation: (scope: UserAvatarRequestScope) => Promise<T>, signal?: AbortSignal): Promise<T>;
  requestTimeoutMs?: number;
}
/** Exact public avatar routes. Stages are receipt-bearing capabilities bound to the browser scope that allocated them. */
export class AuthUserAvatarTransport {
  private readonly stages = new WeakMap<UserAvatarStage, { assertCurrent(): void; deadline: number }>();
  constructor(private readonly options: AuthUserAvatarTransportOptions) {}
  get(signal?: AbortSignal) { return this.options.runScoped(scope => this.snapshot('', { signal: scope.signal }, scope), signal); }
  directory(userId: string, signal?: AbortSignal) {
    return this.options.runScoped(async scope => {
      if (!userId || userId.length > 256) throw invalidAvatar();
      const body = await this.json(`/users/${encodeURIComponent(userId)}`, { signal: scope.signal }, scope);
      if (!isUserAvatarDirectoryEntry(body) || body.userId !== userId) throw invalidAvatar();
      return body;
    }, signal);
  }
  stage(expectedRevision: number, signal?: AbortSignal) {
    return this.options.runScoped(scope => this.allocate(expectedRevision, scope), signal);
  }
  upload(stage: UserAvatarStage, image: Blob, signal?: AbortSignal): Promise<void> {
    return this.options.runScoped(scope => this.uploadImage(stage, image, scope), signal);
  }
  finalize(stage: UserAvatarStage, signal?: AbortSignal) {
    return this.options.runScoped(scope => this.commit(stage, scope), signal);
  }
  cancel(stage: UserAvatarStage, signal?: AbortSignal): Promise<void> {
    return this.options.runScoped(async scope => {
      this.assertStage(stage, scope, false);
      const body = await this.json(`/stages/${stage.id}`, this.body('DELETE', { receipt: stage.receipt }, scope.signal), scope);
      if (!body || typeof body !== 'object' || !('cancelled' in body) || body.cancelled !== true) throw invalidAvatar();
    }, signal);
  }
  remove(expectedRevision: number, signal?: AbortSignal) {
    return this.options.runScoped(scope => this.snapshot('', this.body('DELETE', { expectedRevision }, scope.signal), scope), signal);
  }
  /** Allocate, upload and finalize under one unchanged identity. No optimistic receipt becomes a saved avatar. */
  replace(image: Blob, expectedRevision: number, signal?: AbortSignal): Promise<UserAvatarSnapshot> {
    return this.options.runScoped(async scope => {
      const stage = await this.allocate(expectedRevision, scope); scope.assertCurrent();
      await this.uploadImage(stage, image, scope); scope.assertCurrent();
      return this.commit(stage, scope);
    }, signal);
  }
  /** Read private bytes through the authenticated SDK; consumers create/revoke their own short-lived object URL. */
  deliver(asset: UserAvatarAsset, signal?: AbortSignal): Promise<Blob> {
    return this.options.runScoped(async scope => {
      if (!isUserAvatarAsset(asset)) throw invalidAvatar();
      const exact = structuredClone(asset);
      return this.bounded(scope, async signal => {
        const response = await this.options.authenticatedFetch(`${this.options.baseUrl}${exact.deliveryPath}`, { signal, cache: 'no-store' });
        this.assert(response, scope, signal);
        if (!response.ok) throw createAuthClientError(response, await response.json().catch(() => null), 'Avatar could not be loaded.');
        if (response.headers.get('Content-Type')?.split(';')[0]?.trim() !== 'image/webp' || !response.body) throw invalidAvatar();
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        const abortRead = () => { void reader.cancel(signal.reason).catch(() => {}); };
        signal.addEventListener('abort', abortRead, { once: true });
        try {
          for (;;) {
            scope.assertCurrent(); signal.throwIfAborted();
            const chunk = await reader.read(); this.assert(response, scope, signal);
            if (chunk.done) break;
            size += chunk.value.byteLength;
            if (size > exact.byteLength) throw invalidAvatar();
            chunks.push(Uint8Array.from(chunk.value));
          }
          if (size !== exact.byteLength) throw invalidAvatar();
          return new Blob(chunks.map(chunk => Uint8Array.from(chunk).buffer), { type: 'image/webp' });
        } finally { signal.removeEventListener('abort', abortRead); void reader.cancel().catch(() => {}); reader.releaseLock(); }
      });
    }, signal);
  }
  private async allocate(expectedRevision: number, scope: UserAvatarRequestScope): Promise<UserAvatarStage> {
    const body = await this.json('/stages', this.body('POST', { expectedRevision }, scope.signal), scope);
    if (!isUserAvatarStage(body) || body.expectedRevision !== expectedRevision) throw invalidAvatar();
    const stage = freezeStage(structuredClone(body));
    // This is only a local retention bound. Unix expiry is server-owned;
    // browser wall-clock skew must not reject a valid freshly issued grant.
    this.stages.set(stage, { assertCurrent: scope.assertCurrent, deadline: performance.now() + stage.upload.expiresIn * 1000 }); return stage;
  }
  private async uploadImage(stage: UserAvatarStage, image: Blob, scope: UserAvatarRequestScope): Promise<void> {
    this.assertStage(stage, scope);
    if (!(image instanceof Blob) || !image.size || image.size > stage.upload.maxSize!
      || !stage.upload.contentTypes!.includes(image.type)) throw invalidImage();
    await this.bounded(scope, async signal => {
      this.assertStage(stage, scope);
      const response = await this.options.authenticatedFetch(`${this.options.baseUrl}/storage/upload-grants/${encodeURIComponent(stage.upload.token)}`,
        { method: 'PUT', headers: { 'Content-Type': image.type }, body: image, cache: 'no-store', signal });
      const body: unknown = await response.json().catch(() => null); this.assert(response, scope, signal); this.assertStage(stage, scope);
      if (!response.ok) throw createAuthClientError(response, body, 'Avatar upload could not be completed.');
    });
  }
  private async commit(stage: UserAvatarStage, scope: UserAvatarRequestScope) {
    this.assertStage(stage, scope);
    return this.snapshot(`/stages/${stage.id}/finalize`, this.body('POST', { receipt: stage.receipt }, scope.signal), scope);
  }
  private assertStage(stage: UserAvatarStage, scope: UserAvatarRequestScope, checkExpiry = true) {
    scope.assertCurrent(); scope.signal.throwIfAborted();
    const origin = this.stages.get(stage);
    if (!origin) throw new DOMException('This avatar stage does not belong to the current request scope.', 'AbortError');
    origin.assertCurrent();
    if (checkExpiry && performance.now() >= origin.deadline) throw invalidAvatar();
  }
  private async snapshot(path: string, init: RequestInit, scope: UserAvatarRequestScope): Promise<UserAvatarSnapshot> {
    const body = await this.json(path, init, scope);
    if (!isUserAvatarSnapshot(body) || body.userId !== scope.userId) throw invalidAvatar();
    return body;
  }
  private json(path: string, init: RequestInit, scope: UserAvatarRequestScope): Promise<unknown> {
    return this.bounded(scope, async signal => {
      const response = await this.options.authenticatedFetch(`${this.options.baseUrl}/auth/profile/avatar${path}`, { ...init, signal, cache: 'no-store' });
      const body: unknown = await response.json().catch(() => null); this.assert(response, scope, signal);
      if (!response.ok) throw createAuthClientError(response, body, 'Avatar could not be loaded or saved.');
      return body;
    });
  }
  private async bounded<T>(scope: UserAvatarRequestScope, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    scope.assertCurrent(); scope.signal.throwIfAborted();
    const request = new AuthSessionRecoveryRequest(this.options.requestTimeoutMs ?? 30_000), abort = () => request.cancel();
    scope.signal.addEventListener('abort', abort, { once: true });
    try { const result = await request.run(operation); scope.assertCurrent(); scope.signal.throwIfAborted(); return result; }
    finally { scope.signal.removeEventListener('abort', abort); }
  }
  private assert(response: Response, scope: UserAvatarRequestScope, signal: AbortSignal) {
    scope.assertCurrent(); signal.throwIfAborted(); this.options.assertResponseCurrent(response);
  }
  private body(method: string, body: unknown, signal: AbortSignal): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
  }
}
function freezeStage(stage: UserAvatarStage): UserAvatarStage {
  Object.freeze(stage.upload.contentTypes); Object.freeze(stage.upload.resource); Object.freeze(stage.upload.metadata);
  Object.freeze(stage.upload); return Object.freeze(stage);
}
function invalidAvatar() { return new AuthClientError('Avatar response was invalid. Please reload and try again.', 422, 'AUTH_AVATAR_RESPONSE_INVALID', null); }
function invalidImage() { return new AuthClientError('Choose a JPEG, PNG or WebP image within the configured size limit.', 422, 'AUTH_AVATAR_IMAGE_INVALID', null); }

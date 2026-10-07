/** Avatar domain orchestration: existing Storage transport + private receipts + final live Guardian CAS. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { StorageService } from '../storage/storage-service';
import type { UserStore } from './user-store';
import type { TokenService } from './token-service';
import type { TenancyService } from './tenancy/tenancy-service';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { createZeroRuntimeServiceKey } from '../runtime/zero-app-runtime';
import { trustedSystemServiceDataScope } from './service-data-scope';
import { snapshotAuthContextAuthorityReference } from './auth-context-authority';
import { AuthError, type AuthContext } from './types';
import { AuthUserAvatarStore, retiredStage, type AvatarAssetRow, type AvatarStageRow } from './auth-user-avatar-store';
import { inspectUserAvatarSchema, reconcileUserAvatarSchema } from './auth-user-avatar-schema';
import { normalizeUserAvatarImage } from './auth-user-avatar-image';
import { normalizeStoragePath } from '../storage/storage-input';
import { isUserProfilePolicyReady } from './auth-user-profile-policy';
import type { ResolvedAuthUserAvatarConfig, UserAvatarCapabilities, UserAvatarSnapshot, UserAvatarStage } from './auth-user-avatar-types';

const STAGE_TTL = 5 * 60_000;
const GLOBAL_MEDIA_SCOPE = trustedSystemServiceDataScope({ scopeKind: 'application' });
export const ZERO_GUARDIAN_AVATARS = createZeroRuntimeServiceKey<AuthUserAvatarService>('Guardian user avatars');

export interface AuthUserAvatarDependencies {
  db: ReactiveDB; users: UserStore; tokens: TokenService; storage: StorageService;
  tenancy?: TenancyService | null; policy: ResolvedAuthUserAvatarConfig; installAllowed: boolean;
  emitCode?: AuthPlatformCodeEmitter; now?: () => number;
}
export class AuthUserAvatarService {
  private readonly store: AuthUserAvatarStore;
  private readonly now: () => number;
  private readonly emit: AuthPlatformCodeEmitter;
  private stopping = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cleaning: Promise<void> | null = null;
  private readonly operations = new Set<Promise<unknown>>();
  private readonly readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  constructor(private readonly deps: AuthUserAvatarDependencies) {
    if (deps.db.getTransactionDomain() !== deps.storage.getTransactionDomain()) throw new AuthError('Avatar storage must share the SYSTEM transaction domain', 'AUTH_STATE_INVARIANT_FAILED', 500);
    this.now = deps.now ?? Date.now; this.emit = deps.emitCode ?? emitPlatformCode;
    this.store = new AuthUserAvatarStore(deps.db, deps.users, this.now);
  }
  /** Called after the existing Storage provider starts; disabling does not delete retained assets. */
  initialize(): void {
    if (!this.deps.policy.enabled || this.stopping) return;
    if (!isUserProfilePolicyReady(this.deps.users)) return;
    if (reconcileUserAvatarSchema(this.deps.db, this.deps.installAllowed) !== 'ready') return;
    this.deps.users.transaction(() => {
      if (this.store.namespace()) return;
      if (!this.deps.installAllowed) return;
      const driveId = `drv_${crypto.randomUUID()}`;
      this.deps.storage.createDriveRecord({ driveId, ownerId: null, scope: GLOBAL_MEDIA_SCOPE,
        params: { name: 'Guardian profile media', public: false, maxFileSize: 20 * 1024 * 1024,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] } });
      this.store.installNamespace(driveId);
    });
    if (this.capabilities().state !== 'ready') return;
    void this.cleanup();
    if (this.timer === null) this.timer = setInterval(() => { void this.cleanup(); }, 60_000);
  }
  capabilities(auth?: AuthContext): UserAvatarCapabilities {
    const policy = this.deps.policy;
    const state = !policy.enabled || this.stopping ? 'disabled'
      : isUserProfilePolicyReady(this.deps.users) && inspectUserAvatarSchema(this.deps.db) === 'ready'
        && this.namespaceIsPrivate() ? 'ready' : 'blocked';
    return { ...policy, state, editable: state === 'ready' && policy.editable
      && (!auth || auth.sessionKind !== 'native' || Boolean(auth.scope?.includes('profile:write'))) };
  }
  read(auth: AuthContext): UserAvatarSnapshot {
    const admit = this.capture(auth, false); admit(); this.assertReady();
    return this.snapshot(auth.userId, auth);
  }
  /** Minimal same-organization directory entry, never global private profile/contact fields. */
  directory(auth: AuthContext, userId: string): { userId: string; displayName: string; asset: UserAvatarSnapshot['asset'] } {
    const admit = this.capture(auth, false); admit(); this.assertReady(); this.assertDirectorySubject(auth, userId);
    const displayName = this.store.directoryDisplayName(userId);
    const asset = this.assetProjection(this.store.current(userId));
    admit(); this.assertDirectorySubject(auth, userId); return { userId, displayName, asset };
  }
  stage(auth: AuthContext, expectedRevision: number): Promise<UserAvatarStage> {
    return this.track(async () => {
      validRevision(expectedRevision); const admit = this.capture(auth, true); admit(); this.assertReady();
      const authority = this.deps.tokens.captureAuthContextAuthority(auth)!;
      const id = `avs_${crypto.randomUUID()}`, receipt = receiptToken(), expiresAt = this.now() + STAGE_TTL;
      const row = this.store.allocate({ id, userId: auth.userId, expectedRevision, authority, receiptHash: hashReceipt(receipt),
        path: `/avatars/stages/${id}`, expiresAt }, admit);
      try {
        const upload = await this.deps.storage.uploads.create(this.namespace(), { path: row.path, expiresIn: STAGE_TTL / 1000,
          maxSize: this.deps.policy.maxUploadBytes, contentTypes: ['image/jpeg', 'image/png', 'image/webp'],
          overwrite: false, public: false, flow: 'guardian-avatar', resource: { type: 'guardian-avatar-stage', id } });
        admit();
        if (this.store.stage(id)?.state !== 'allocated' || expiresAt <= this.now()) throw retiredStage();
        return { id, receipt, expiresAt, expectedRevision, upload };
      } catch (cause) { this.store.retireStage(id); throw cause; }
    });
  }
  finalize(auth: AuthContext, stageId: string, receipt: string): Promise<UserAvatarSnapshot> {
    return this.track(async () => {
      validateStageProof(stageId, receipt); const admit = this.capture(auth, true); admit(); this.assertReady();
      const stage = this.store.stage(stageId); this.assertReceipt(auth, stage, receipt);
      if (stage!.state === 'consumed') {
        if (stage!.asset_id !== this.store.current(auth.userId)?.asset_id) throw retiredStage();
        return this.snapshot(auth.userId, auth);
      }
      const lease = crypto.randomUUID(); this.store.claim(stage!, lease, admit);
      const fence = () => { admit(); this.assertReady(); this.store.assertStageLease(stageId, lease); };
      let pendingAsset: AvatarAssetRow | null = null;
      try {
        const staged = await this.deps.storage.objects.download(this.namespace(), stage!.path, fence);
        fence();
        if (!staged || staged.info.isPublic || staged.info.sizeBytes > this.deps.policy.maxUploadBytes) throw imageUnavailable();
        const input = await this.readBounded(staged.stream, this.deps.policy.maxUploadBytes, fence);
        const image = await normalizeUserAvatarImage(input, this.deps.policy); fence();
        pendingAsset = this.store.allocateAsset(stageId, lease, `ava_${crypto.randomUUID()}`, fence);
        const immutableAsset = pendingAsset;
        const publishFence = () => { fence(); this.store.assertPendingAsset(immutableAsset.asset_id, lease); };
        const stored = await this.deps.storage.objects.upload(this.namespace(), immutableAsset.path, image.bytes, 'avatar.webp',
          auth.userId, { overwrite: false, public: false, allowedMimeTypes: ['image/webp'] }, GLOBAL_MEDIA_SCOPE,
          async () => { publishFence(); }, undefined, publishFence);
        publishFence();
        if (!stored.checksum || stored.isPublic || stored.mimeType !== 'image/webp' || stored.sizeBytes !== image.bytes.byteLength) throw imageUnavailable();
        this.store.accept(stageId, lease, { checksum: stored.checksum, byteLength: stored.sizeBytes, width: image.width, height: image.height },
          () => { admit(); this.assertReady(); });
        this.emit(OBS_CODES.AUTH_USER_AVATAR_UPDATED, { metadata: { operation: 'replace' } });
        return this.snapshot(auth.userId, auth);
      } catch (cause) {
        this.store.retireStage(stageId, lease);
        // Keep any provider publication recoverable; only the leased cleanup
        // worker may remove an unreferenced asset, never a newly current image.
        if (pendingAsset) void this.cleanup();
        throw cause;
      }
    });
  }
  cancel(auth: AuthContext, stageId: string, receipt: string): void {
    validateStageProof(stageId, receipt); const admit = this.capture(auth, true); admit(); this.assertReady();
    const stage = this.store.stage(stageId); this.assertReceipt(auth, stage, receipt);
    if (stage?.state === 'consumed') throw retiredStage();
    this.deps.users.transaction(() => { admit(); this.store.retireStage(stageId); admit(); });
    void this.cleanup();
  }
  /** A Storage grant is only byte transport; its private avatar receipt must still be live at final commit. */
  captureUploadGrantCommitFence(grant: Readonly<import('../storage/upload-grant').VerifiedUploadGrant>): (() => void) | undefined {
    if (grant.flow !== 'guardian-avatar') {
      if (inspectUserAvatarSchema(this.deps.db) === 'ready' && grant.driveId === this.store.namespace()) throw retiredStage();
      return undefined;
    }
    if (grant.flow !== 'guardian-avatar' || grant.resource?.type !== 'guardian-avatar-stage' || grant.public || grant.overwrite) throw retiredStage();
    const id = grant.resource.id;
    const fence = () => {
      this.assertReady();
      const stage = this.store.stage(id);
      if (!stage || stage.state !== 'allocated' || normalizeStoragePath(stage.path) !== grant.path || grant.driveId !== this.namespace()
        || stage.expires_at <= this.now() || grant.expiresAt <= this.now()) throw retiredStage();
      let reference;
      try { reference = snapshotAuthContextAuthorityReference(JSON.parse(stage.authority_json)); } catch { throw retiredStage(); }
      if (!reference || !this.deps.tokens.resolveAuthContextAuthority(reference)) throw expiredAuthority();
    };
    fence(); return fence;
  }
  remove(auth: AuthContext, expectedRevision: number): UserAvatarSnapshot {
    validRevision(expectedRevision); const admit = this.capture(auth, true); admit(); this.assertReady();
    this.store.remove(auth.userId, expectedRevision, admit);
    this.emit(OBS_CODES.AUTH_USER_AVATAR_UPDATED, { metadata: { operation: 'remove' } });
    void this.cleanup(); return this.snapshot(auth.userId, auth);
  }
  download(auth: AuthContext, assetId: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
    return this.track(() => this.downloadCurrentAsset(auth, assetId));
  }
  private async downloadCurrentAsset(auth: AuthContext, assetId: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
    const admit = this.capture(auth, false); admit(); this.assertReady();
    const asset = this.store.asset(assetId);
    if (!asset || asset.state !== 'current') throw imageUnavailable();
    const fence = () => { admit(); this.assertDirectorySubject(auth, asset.user_id);
      if (this.store.current(asset.user_id)?.asset_id !== assetId) throw imageUnavailable(); };
    fence();
    const delivered = await this.deps.storage.objects.download(this.namespace(), asset.path, fence); fence();
    if (!delivered || delivered.info.checksum !== asset.checksum || delivered.info.sizeBytes !== asset.byte_length
      || delivered.info.mimeType !== 'image/webp' || delivered.info.isPublic) throw imageUnavailable();
    // Consume under live fences before returning a private body; no provider
    // read can outlive runtime drain or turn into a public cached URL.
    const bytes = await this.readBounded(delivered.stream, this.deps.policy.maxUploadBytes, fence); fence();
    return { stream: new Blob([Uint8Array.from(bytes).buffer]).stream(), size: bytes.byteLength };
  }
  async cleanup(): Promise<void> {
    if (this.cleaning) return this.cleaning;
    if (this.stopping) return;
    if (!isUserProfilePolicyReady(this.deps.users)) return;
    if (inspectUserAvatarSchema(this.deps.db) !== 'ready' || !this.namespaceIsPrivate()) return;
    const pass = async () => {
      try {
        const claimed = this.store.claimCleanup();
        for (const stage of claimed.stages) {
          await this.deps.storage.objects.delete(this.namespace(), stage.path);
          this.store.finishStageCleanup(stage.stage_id, claimed.lease);
        }
        for (const asset of claimed.assets) {
          await this.deps.storage.objects.delete(this.namespace(), asset.path, () => {
            const current = this.store.asset(asset.asset_id);
            if (!current || current.state !== 'retired' || current.lease_token !== claimed.lease) throw retiredStage();
          });
          this.store.finishAssetCleanup(asset.asset_id, claimed.lease);
        }
      } catch { this.emit(OBS_CODES.AUTH_USER_AVATAR_CLEANUP_RETRY, { metadata: { operation: 'retained-cleanup' } }); }
    };
    const work = pass(); this.cleaning = work;
    try { await work; } finally { if (this.cleaning === work) this.cleaning = null; }
  }
  /**
   * Join admitted provider work before Guardian/SYSTEM disposal. A timeout must
   * not abandon callbacks that still own a Storage/SQL mutation. App-owned
   * Storage adapters must settle their admitted read/write/delete promises;
   * the existing Storage service owns durable publication recovery.
   */
  async close(): Promise<void> {
    this.stopping = true;
    if (this.timer !== null) clearInterval(this.timer); this.timer = null;
    await Promise.allSettled([...this.readers].map(reader => reader.cancel()));
    await Promise.allSettled([...this.operations]); await this.cleaning;
  }
  private capture(auth: AuthContext, write: boolean): () => void {
    const check = (current: AuthContext) => {
      if (this.stopping || current.credentialKind === 'api-key' || !['web', 'native'].includes(current.sessionKind ?? '')
        || current.sessionKind === 'native' && (!current.scope?.includes('profile') || write && !current.scope.includes('profile:write'))) {
        throw new AuthError('A permitted account session is required', 'AUTH_AVATAR_SESSION_REQUIRED', 403);
      }
      if (write && !this.deps.policy.editable) throw new AuthError('Avatar editing is disabled', 'AUTH_AVATAR_READ_ONLY', 403);
    };
    this.deps.users.assertCurrentUserProfilePolicy();
    check(auth); const reference = this.deps.tokens.captureAuthContextAuthority(auth);
    if (!reference) throw expiredAuthority();
    return () => { if (this.stopping) throw expiredAuthority(); this.deps.users.assertCurrentProfile();
      this.deps.users.assertCurrentUserProfilePolicy(); const current = this.deps.tokens.resolveAuthContextAuthority(reference);
      if (!current) throw expiredAuthority(); check(current); };
  }
  private assertReceipt(auth: AuthContext, stage: AvatarStageRow | null, receipt: string): void {
    if (!stage || stage.user_id !== auth.userId || stage.receipt_hash !== hashReceipt(receipt) || stage.expires_at <= this.now()) throw retiredStage();
    let reference;
    try { reference = snapshotAuthContextAuthorityReference(JSON.parse(stage.authority_json)); } catch { throw retiredStage(); }
    const caller = this.deps.tokens.captureAuthContextAuthority(auth);
    if (!caller || !reference || caller.sessionId !== reference.sessionId || caller.sessionScopeKind !== reference.sessionScopeKind
      || caller.sessionScopeId !== reference.sessionScopeId || !this.deps.tokens.resolveAuthContextAuthority(reference)) throw retiredStage();
  }
  private assertDirectorySubject(auth: AuthContext, userId: string): void {
    const user = this.deps.users.getUserById(userId);
    if (!user || user.status !== 'active') throw imageUnavailable();
    if (userId === auth.userId) return;
    if (auth.sessionKind === 'native') throw imageUnavailable();
    if (this.deps.tenancy) {
      if (!auth.tenantId || !this.deps.tenancy.listActiveTenantMembershipsForUser(userId).some(item => item.tenant.tenantId === auth.tenantId)) throw imageUnavailable();
    }
  }
  private snapshot(userId: string, auth: AuthContext): UserAvatarSnapshot {
    return { userId, revision: this.store.revision(userId), capabilities: this.capabilities(auth), asset: this.assetProjection(this.store.current(userId)) };
  }
  private assetProjection(row: AvatarAssetRow | null): UserAvatarSnapshot['asset'] {
    if (!row) return null;
    if (!row.checksum || !row.width || !row.height || !row.byte_length || !/^ava_[a-f0-9-]{36}$/.test(row.asset_id)) throw imageUnavailable();
    return { id: row.asset_id, width: row.width, height: row.height, byteLength: row.byte_length, mimeType: 'image/webp',
      deliveryPath: `/auth/profile/avatar/assets/${row.asset_id}` };
  }
  private namespace(): string { const id = this.store.namespace(); if (!id) throw imageUnavailable(); return id; }
  private namespaceIsPrivate(): boolean {
    try { const id = this.store.namespace(); const drive = id ? this.deps.storage.drives.get(id) : null;
      return Boolean(drive && drive.public === 0 && drive.tenant_id === null && drive.owner_id === null); } catch { return false; }
  }
  private assertReady(): void {
    const state = this.capabilities().state;
    if (state === 'disabled') throw new AuthError('User avatars are disabled', 'AUTH_AVATAR_DISABLED', 403);
    if (state !== 'ready') throw new AuthError('Avatar storage is not ready. Check the SYSTEM migration and storage configuration.', 'AUTH_AVATAR_NOT_READY', 503);
  }
  private async readBounded(stream: ReadableStream<Uint8Array>, maximum: number, fence: () => void): Promise<Uint8Array> {
    const reader = stream.getReader(); this.readers.add(reader);
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { fence(); const next = await reader.read(); fence(); if (next.done) break;
        length += next.value.byteLength; if (length > maximum) throw imageUnavailable(); chunks.push(Uint8Array.from(next.value)); }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes;
    } finally { this.readers.delete(reader); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(expiredAuthority());
    const work = Promise.resolve().then(operation); this.operations.add(work);
    void work.finally(() => { this.operations.delete(work); }).catch(() => {}); return work;
  }
}
function validRevision(value: number): void { if (!Number.isSafeInteger(value) || value < 1 || value >= Number.MAX_SAFE_INTEGER) throw new AuthError('Profile revision is invalid', 'AUTH_PROFILE_VALIDATION_FAILED', 422); }
function validateStageProof(id: string, receipt: string): void { if (typeof id !== 'string' || !/^avs_[a-f0-9-]{36}$/.test(id)
  || typeof receipt !== 'string' || !/^[a-f0-9]{64}$/.test(receipt)) throw retiredStage(); }
function receiptToken(): string { return [...crypto.getRandomValues(new Uint8Array(32))].map(value => value.toString(16).padStart(2, '0')).join(''); }
function hashReceipt(receipt: string): string { return new Bun.CryptoHasher('sha256').update(receipt).digest('hex'); }
function expiredAuthority(): AuthError { return new AuthError('Account authority changed. Sign in again.', 'AUTH_AVATAR_AUTHORITY_CHANGED', 401); }
function imageUnavailable(): AuthError { return new AuthError('The avatar image is unavailable', 'AUTH_AVATAR_IMAGE_UNAVAILABLE', 404); }

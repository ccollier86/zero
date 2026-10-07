/** Managed avatar composition follows Storage startup and drains before that provider/Guardian/Fabric stop. */
import type { ReactiveDB } from '../../sync/reactive-db';
import type { StorageService } from '../../storage/storage-service';
import type { NormalizedAuthBehaviorConfig } from '../../auth/types';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { ZERO_AUTH_STORE, ZERO_AUTH_TOKEN_SERVICE, ZERO_AUTH_TENANCY_SERVICE } from '../../runtime/service-keys';
import { AuthUserAvatarService, ZERO_GUARDIAN_AVATARS } from '../../auth/auth-user-avatar-service';
import { createAuthUserAvatarPlugin } from '../../auth/auth-user-avatar.plugin';
import { createAuthPlatformCodeEmitter } from '../../auth/auth-observability';
import { AuthError } from '../../auth/types';

export function composeManagedUserAvatars(runtime: ZeroAppRuntime, db: ReactiveDB,
  policy: NormalizedAuthBehaviorConfig['userProfile'], installAllowed: boolean) {
  let current: AuthUserAvatarService | null = null;
  const plugin = createAuthUserAvatarPlugin({ getService: () => current, getTokenService: () => runtime.get(ZERO_AUTH_TOKEN_SERVICE) });
  return { plugin,
    captureUploadGrantCommitFence(grant: Readonly<import('../../storage/upload-grant').VerifiedUploadGrant>) {
      if (grant.flow === 'guardian-avatar' && !current) throw new AuthError('Guardian avatar upload is unavailable', 'AUTH_AVATAR_NOT_READY', 503);
      return current?.captureUploadGrantCommitFence(grant);
    },
    onStorageCreated(storage: StorageService): void {
    if (!policy.enabled || !policy.avatars.enabled) return;
    const created = new AuthUserAvatarService({ db, storage, users: runtime.require(ZERO_AUTH_STORE),
      tokens: runtime.require(ZERO_AUTH_TOKEN_SERVICE), tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE),
      policy: { ...policy.avatars, enabled: policy.enabled && policy.avatars.enabled }, installAllowed,
      emitCode: createAuthPlatformCodeEmitter(runtime) });
    current = created; runtime.set(ZERO_GUARDIAN_AVATARS, created);
    runtime.addCleanup(async () => {
      if (current === created) current = null;
      await created.close(); runtime.clear(ZERO_GUARDIAN_AVATARS, created);
    });
    created.initialize();
  } };
}

/** Own-profile policy and live session admission; no HTTP, avatar, contact or role mutations. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { inspectUserProfileSchema } from './auth-user-profile-schema';
import { isUserProfilePolicyReady } from './auth-user-profile-policy';
import { AuthUserProfileStore, type StoredUserProfile } from './auth-user-profile-store';
import { captureUserProfileUpdate } from './auth-user-profile-validation';
import {
  USER_PROFILE_FIELDS,
  type ResolvedAuthUserProfileConfig, type UpdateUserProfileInput,
  type UserProfileCapabilities, type UserProfileSnapshot, type UserProfileValues,
} from './auth-user-profile-types';
import type { TokenService } from './token-service';
import { AuthError, type AuthContext } from './types';
import type { UserStore } from './user-store';
import type { UserAvatarCapabilities } from './auth-user-avatar-types';

/** A single runtime's optional global profile domain, bound to existing Guardian services. */
export class AuthUserProfileService {
  private readonly profiles: AuthUserProfileStore;
  private stopped = false;
  constructor(
    private readonly db: ReactiveDB,
    private readonly users: UserStore,
    private readonly tokens: TokenService,
    private readonly config: ResolvedAuthUserProfileConfig,
    private readonly emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
    private readonly getAvatarCapabilities?: (auth?: AuthContext) => UserAvatarCapabilities,
  ) { this.profiles = new AuthUserProfileStore(db, users, emitCode); }

  /** Secret-free policy/readiness; supplied UI settings may only narrow this result. */
  capabilities(auth?: AuthContext): UserProfileCapabilities {
    if (!this.stopped) this.users.assertCurrentProfile();
    const state = !this.config.enabled ? 'disabled'
      : !this.stopped && inspectUserProfileSchema(this.db) === 'ready' && isUserProfilePolicyReady(this.users) ? 'ready' : 'blocked';
    const writable = state === 'ready' && (!auth || auth.sessionKind !== 'native'
      || Boolean(auth.scope?.includes('profile:write')));
    return {
      state, usernameMode: this.config.usernameMode,
      fields: Object.fromEntries(USER_PROFILE_FIELDS.map(field => [field, {
        ...this.config.fields[field],
        editable: writable && this.config.fields[field].enabled && this.config.fields[field].editable
          && (field !== 'username' || this.config.usernameMode === 'separate'),
      }])) as UserProfileCapabilities['fields'],
      regional: { ...this.config.regional,
        enabled: state === 'ready' && this.config.regional.enabled,
        editable: writable && this.config.regional.enabled,
        fields: [...this.config.regional.fields], defaults: { ...this.config.regional.defaults } },
      ...(this.getAvatarCapabilities ? { avatars: this.getAvatarCapabilities(auth) } : {}),
    };
  }

  /** Retire retained service handles before runtime worker drain; no database mutation is required. */
  stop(): void { this.stopped = true; }

  /** Resolve the exact requesting global identity; no arbitrary-user read API is implied. */
  read(auth: AuthContext): UserProfileSnapshot {
    const admission = this.capture(auth, false);
    return this.users.transaction(() => {
      const current = admission();
      this.assertFeatureReady();
      const stored = this.profiles.read(current.userId);
      admission();
      return this.snapshot(stored, current);
    });
  }

  /** Internal identity-only continuation seam; not an arbitrary-user public account API. */
  readForCompletion(userId: string, assertAdmission: () => void): UserProfileSnapshot {
    this.assertLive();
    return this.users.transaction(() => {
      assertAdmission(); this.assertFeatureReady();
      const profile = this.profiles.read(userId); assertAdmission();
      return { ...profile, capabilities: this.capabilities() };
    });
  }

  /** Same typed field policy/CAS, authorized by a narrowly scoped continuation instead of a fabricated session. */
  updateForCompletion(userId: string, input: UpdateUserProfileInput, assertAdmission: () => void): UserProfileSnapshot {
    this.assertLive();
    const command = captureUserProfileUpdate(input);
    return this.users.transaction(() => {
      assertAdmission(); this.assertFeatureReady(); this.assertEditable(command);
      const before = this.profiles.read(userId);
      this.assertRequired({ ...before.values, ...command.changes,
        regional: { ...before.values.regional, ...command.changes.regional } });
      const profile = this.profiles.update(userId, command, assertAdmission); assertAdmission();
      this.users.afterCommit(() => this.emitCode(OBS_CODES.AUTH_USER_PROFILE_UPDATED, {
        metadata: { operation: 'first-use-completion', revision: profile.revision },
      }));
      return { ...profile, capabilities: this.capabilities() };
    });
  }

  /** CAS core/extended/regional changes under the final live session and immutable field policy. */
  update(auth: AuthContext, input: UpdateUserProfileInput): UserProfileSnapshot {
    const command = captureUserProfileUpdate(input);
    const admission = this.capture(auth, true);
    return this.users.transaction(() => {
      const current = admission();
      this.assertFeatureReady();
      this.assertEditable(command);
      const before = this.profiles.read(current.userId);
      this.assertRequired({ ...before.values, ...command.changes,
        regional: { ...before.values.regional, ...command.changes.regional } });
      const accepted = this.profiles.update(current.userId, command, () => { admission(); });
      admission();
      this.users.afterCommit(() => this.emitCode(OBS_CODES.AUTH_USER_PROFILE_UPDATED, {
        metadata: { operation: 'self-update', revision: accepted.revision },
      }));
      return this.snapshot(accepted, current);
    });
  }

  private capture(auth: AuthContext, write: boolean): () => AuthContext {
    this.assertLive();
    if (auth.credentialKind === 'api-key' || (auth.sessionKind !== 'web' && auth.sessionKind !== 'native')) {
      throw new AuthError('A signed-in account session is required', 'AUTH_PROFILE_SESSION_REQUIRED', 403);
    }
    this.assertScopes(auth, write);
    const reference = this.tokens.captureAuthContextAuthority(auth);
    if (!reference) throw staleAuthority();
    return () => {
      this.assertLive();
      this.users.assertCurrentUserProfilePolicy();
      const current = this.tokens.resolveAuthContextAuthority(reference);
      if (!current) throw staleAuthority();
      this.assertScopes(current, write);
      return current;
    };
  }

  private assertScopes(auth: AuthContext, write: boolean): void {
    if (auth.sessionKind === 'native' && (!auth.scope?.includes('profile')
      || (write && !auth.scope.includes('profile:write')))) {
      throw new AuthError('This session does not grant the requested profile access', 'AUTH_PROFILE_SCOPE_REQUIRED', 403);
    }
  }

  private assertFeatureReady(): void {
    this.assertLive();
    this.users.assertCurrentUserProfilePolicy();
    if (!this.config.enabled) throw new AuthError('User profiles are disabled', 'AUTH_PROFILE_DISABLED', 403);
    if (inspectUserProfileSchema(this.db) !== 'ready') {
      throw new AuthError('Profile storage is not ready; apply the required SYSTEM migration', 'AUTH_PROFILE_NOT_READY', 503);
    }
  }

  private assertLive(): void {
    if (this.stopped) throw new AuthError('User profiles are unavailable', 'AUTH_PROFILE_NOT_READY', 503);
  }

  private assertEditable(input: UpdateUserProfileInput): void {
    for (const key of Object.keys(input.changes)) {
      if (key === 'regional') {
        if (!this.config.regional.enabled || Object.keys(input.changes.regional!).some(field =>
          !this.config.regional.fields.includes(field as typeof this.config.regional.fields[number]))) throw fieldUnavailable();
      } else {
        const policy = this.config.fields[key as typeof USER_PROFILE_FIELDS[number]];
        if (!policy.enabled || !policy.editable || (key === 'username' && this.config.usernameMode !== 'separate')) throw fieldUnavailable();
      }
    }
  }

  private assertRequired(values: UserProfileValues): void {
    for (const field of USER_PROFILE_FIELDS) {
      if (!this.config.fields[field].required) continue;
      const value = values[field];
      if (Array.isArray(value) ? value.length === 0 : value === null || value.trim().length === 0) {
        throw new AuthError('Complete the required profile fields before saving', 'AUTH_PROFILE_REQUIRED_FIELDS', 422);
      }
    }
  }

  private snapshot(profile: StoredUserProfile, auth: AuthContext): UserProfileSnapshot {
    return { ...profile,
      email: auth.sessionKind === 'native' && !auth.scope?.includes('email') ? null : profile.email,
      capabilities: this.capabilities(auth),
    };
  }
}

function staleAuthority(): AuthError {
  return new AuthError('Authorization changed before the profile operation could complete', 'AUTHORIZATION_CHANGED', 409);
}

function fieldUnavailable(): AuthError {
  return new AuthError('These profile fields cannot be edited', 'AUTH_PROFILE_FIELD_NOT_EDITABLE', 403);
}

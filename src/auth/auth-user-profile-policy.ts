/** Bootstrap-owned optional profile policy clock. Readers never adopt or install policy. */
import type { ReactiveDB } from '../sync/reactive-db';
import { inspectUserProfileSchema } from './auth-user-profile-schema';
import { createAuthStateInvariantError, type AuthPlatformCodeEmitter } from './auth-observability';
import type { ResolvedAuthUserProfileConfig } from './auth-user-profile-types';
import { AuthError } from './types';
import type { UserStore } from './user-store';

export interface InstalledUserProfilePolicy {
  readonly policy_fingerprint: string;
  readonly generation: number;
  readonly updated_at: number;
}

/** Functions/provider secrets are deliberately excluded; adapter identity is an explicit boundary. */
export function userProfilePolicyFingerprint(config: ResolvedAuthUserProfileConfig,
  phoneAdapterId: string | null = null): string {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(JSON.stringify({ enabled: config.enabled, usernameMode: config.usernameMode,
    fields: config.fields, regional: config.regional, contacts: config.contacts,
    avatars: config.avatars, completion: config.completion, phoneAdapterId }));
  return hash.digest('hex');
}

/** Used by Doctor as well as the live guard; malformed retained state is not adopted. */
export function inspectInstalledUserProfilePolicy(db: Pick<ReactiveDB, 'prepare'>,
  emitCode?: AuthPlatformCodeEmitter): InstalledUserProfilePolicy | null {
  const row = db.prepare('SELECT policy_fingerprint,generation,updated_at FROM _auth_user_profile_policy WHERE singleton=1')
    .get() as InstalledUserProfilePolicy | null;
  if (row && (typeof row.policy_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.policy_fingerprint)
    || !Number.isSafeInteger(row.generation) || row.generation < 1
    || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0)) throw policyInvariant(emitCode);
  return row ? Object.freeze({ ...row }) : null;
}

/** Called only by AuthRuntime bootstrap, after core Guardian reconciliation. No configuration DDL. */
export function reconcileUserProfilePolicy(db: ReactiveDB, users: UserStore,
  config: ResolvedAuthUserProfileConfig, phoneAdapterId: string | null = null,
  emitCode?: AuthPlatformCodeEmitter): { readonly assertCurrent: () => void } {
  const fingerprint = userProfilePolicyFingerprint(config, phoneAdapterId);
  let captured: InstalledUserProfilePolicy | null = null;
  if (inspectUserProfileSchema(db) === 'ready') {
    captured = users.transaction(() => {
      users.assertCurrentProfile();
      const prior = inspectInstalledUserProfilePolicy(db, emitCode);
      if (!prior) {
        db.prepare(`INSERT INTO _auth_user_profile_policy(singleton,policy_fingerprint,generation,updated_at)
          VALUES (1,?,1,?)`).run(fingerprint, Date.now());
      } else if (prior.policy_fingerprint !== fingerprint) {
        if (prior.generation === Number.MAX_SAFE_INTEGER) throw policyInvariant(emitCode);
        db.prepare(`UPDATE _auth_user_profile_policy SET policy_fingerprint=?,generation=?,updated_at=? WHERE singleton=1`)
          .run(fingerprint, prior.generation + 1, Date.now());
      }
      users.assertCurrentProfile();
      return inspectInstalledUserProfilePolicy(db, emitCode);
    });
  }
  return Object.freeze({ assertCurrent: () => {
    if (!captured || inspectUserProfileSchema(db) !== 'ready') throw policyNotReady();
    const current = inspectInstalledUserProfilePolicy(db, emitCode);
    if (!current) throw policyNotReady();
    if (current.generation !== captured.generation || current.policy_fingerprint !== fingerprint) {
      throw new AuthError('Profile settings changed; retry through the current application runtime', 'AUTH_PROFILE_POLICY_CHANGED', 409);
    }
  } });
}

/** Capability projection can become blocked without guessing that an older policy is still writable. */
export function isUserProfilePolicyReady(users: UserStore): boolean {
  try { users.assertCurrentUserProfilePolicy(); return true; }
  catch (error) {
    if (error instanceof AuthError && (error.code === 'AUTH_PROFILE_POLICY_CHANGED' || error.code === 'AUTH_PROFILE_NOT_READY')) return false;
    throw error;
  }
}
function policyNotReady(): AuthError {
  return new AuthError('Profile storage and policy are not ready; apply the required SYSTEM migration and restart Guardian', 'AUTH_PROFILE_NOT_READY', 503);
}
function policyInvariant(emitCode?: AuthPlatformCodeEmitter): AuthError {
  return createAuthStateInvariantError(emitCode, { component: 'user-profile-policy', invariant: 'installed-policy-invalid',
    message: '[auth] Installed user profile policy is invalid.' });
}

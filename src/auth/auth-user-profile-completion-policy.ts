/** Pure semantic policy identity shared by the runtime fence and read-only Doctor. */
import type { ResolvedAuthUserProfileConfig } from './auth-user-profile-types';
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserStore } from './user-store';
import { inspectProfileCompletionSchema } from './auth-user-profile-completion-schema';
import { createAuthStateInvariantError, type AuthPlatformCodeEmitter } from './auth-observability';

export function profileCompletionPolicyFingerprint(config: ResolvedAuthUserProfileConfig): string {
  const hash = new Bun.CryptoHasher('sha256');
  hash.update(JSON.stringify({ enabled: config.enabled, usernameMode: config.usernameMode,
    fields: config.fields, regional: config.regional, completion: config.completion }));
  return hash.digest('hex');
}

/** Only bootstrap adopts the declared completion policy; constructing a reader cannot replace it. */
export function reconcileProfileCompletionPolicy(db: ReactiveDB, users: UserStore,
  config: ResolvedAuthUserProfileConfig, emitCode?: AuthPlatformCodeEmitter): void {
  if (inspectProfileCompletionSchema(db) !== 'ready') return;
  users.transaction(() => {
    users.assertCurrentProfile();
    const prior = db.prepare('SELECT policy_fingerprint,updated_at FROM _auth_profile_completion_policy WHERE singleton=1')
      .get() as { policy_fingerprint: string; updated_at: number } | null;
    if (prior && (typeof prior.policy_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(prior.policy_fingerprint)
      || !Number.isSafeInteger(prior.updated_at) || prior.updated_at < 0)) {
      throw createAuthStateInvariantError(emitCode, { component: 'profile-completion-policy', invariant: 'current-policy-invalid',
        message: '[auth] Profile completion state is invalid.' });
    }
    const fingerprint = profileCompletionPolicyFingerprint(config);
    if (prior?.policy_fingerprint === fingerprint) return;
    db.prepare(`INSERT INTO _auth_profile_completion_policy(singleton,policy_fingerprint,updated_at) VALUES (1,?,?)
      ON CONFLICT(singleton) DO UPDATE SET policy_fingerprint=excluded.policy_fingerprint,updated_at=excluded.updated_at`)
      .run(fingerprint, Date.now());
    users.assertCurrentProfile();
  });
}

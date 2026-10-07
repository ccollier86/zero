/** Global first-use enrollment and current policy fingerprint; no bearer issuance. */
import type { ReactiveDB } from '../sync/reactive-db';
import { AuthError } from './types';
import type { UserStore } from './user-store';
import { inspectProfileCompletionSchema } from './auth-user-profile-completion-schema';
import type { ResolvedAuthUserProfileConfig, UserProfileField, UserProfileSnapshot } from './auth-user-profile-types';
import { USER_PROFILE_FIELDS } from './auth-user-profile-types';
import { createAuthStateInvariantError, type AuthPlatformCodeEmitter } from './auth-observability';
import { profileCompletionPolicyFingerprint } from './auth-user-profile-completion-policy';

interface Enrollment { origin: 'signup' | 'invitation' | 'existing'; policy_fingerprint: string; completed_fingerprint: string | null; completed_at: number | null }
export interface CompletionContext { policyFingerprint: string; sessionBinding: { tenantId: string; membershipId: string } | undefined }

export class AuthUserProfileCompletionStore {
  readonly fingerprint: string;
  readonly requiredFields: readonly UserProfileField[];
  constructor(private readonly db: ReactiveDB, private readonly users: UserStore,
    readonly config: ResolvedAuthUserProfileConfig, private readonly emitCode?: AuthPlatformCodeEmitter) {
    this.fingerprint = profileCompletionPolicyFingerprint(config);
    this.requiredFields = Object.freeze(USER_PROFILE_FIELDS.filter(field => config.fields[field].enabled && config.fields[field].required));
  }
  get enabled(): boolean { return this.config.enabled && this.config.completion.enabled; }
  assertReady(): void {
    this.users.assertCurrentProfile();
    if (inspectProfileCompletionSchema(this.db) !== 'ready') throw completionNotReady();
    this.assertCurrentPolicy();
  }
  enroll(userId: string, origin: 'signup' | 'invitation'): void {
    this.assertCurrentPolicy();
    if (!this.enabled || !(origin === 'signup' ? this.config.completion.onSignup : this.config.completion.onInvitation)) return;
    this.assertReady();
    this.db.prepare(`INSERT INTO _auth_profile_completion_enrollments(user_id,origin,policy_fingerprint,created_at)
      VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET origin = excluded.origin
      WHERE _auth_profile_completion_enrollments.completed_fingerprint IS NULL`)
      .run(userId, origin, this.fingerprint, Date.now());
  }
  eligible(userId: string): boolean {
    this.assertCurrentPolicy();
    if (!this.enabled || this.requiredFields.length === 0) return false;
    this.assertReady();
    const row = this.db.prepare(`SELECT origin,policy_fingerprint,completed_fingerprint,completed_at
      FROM _auth_profile_completion_enrollments WHERE user_id = ?`).get(userId) as Enrollment | null;
    if (!row) return this.config.completion.existingUsers === 'onSignIn';
    if (!['signup', 'invitation', 'existing'].includes(row.origin) || !/^[a-f0-9]{64}$/.test(row.policy_fingerprint)
      || (row.completed_fingerprint !== null && !/^[a-f0-9]{64}$/.test(row.completed_fingerprint))
      || ((row.completed_fingerprint === null) !== (row.completed_at === null))
      || (row.completed_at !== null && (!Number.isSafeInteger(row.completed_at) || row.completed_at < 0))) {
      throw this.invalidState('enrollment-invalid');
    }
    // A completed old policy becomes an existing account for a future rollout.
    if (row.completed_fingerprint !== null && row.completed_fingerprint !== this.fingerprint
      && this.config.completion.existingUsers === 'none') return false;
    return row.origin === 'signup' ? this.config.completion.onSignup
      : row.origin === 'invitation' ? this.config.completion.onInvitation
        : this.config.completion.existingUsers === 'onSignIn';
  }
  missing(profile: UserProfileSnapshot): readonly UserProfileField[] {
    return this.requiredFields.filter(field => {
      const value = profile.values[field]; return Array.isArray(value) ? value.length === 0 : value === null || value.trim().length === 0;
    });
  }
  markCompleted(userId: string): void {
    this.assertReady();
    this.db.prepare(`INSERT INTO _auth_profile_completion_enrollments
      (user_id,origin,policy_fingerprint,completed_fingerprint,created_at,completed_at) VALUES (?,'existing',?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET completed_fingerprint = excluded.completed_fingerprint, completed_at = excluded.completed_at`)
      .run(userId, this.fingerprint, this.fingerprint, Date.now(), Date.now());
  }
  putContext(id: string, binding?: { tenantId: string; membershipId: string }): void {
    const json = binding ? JSON.stringify({ tenantId: binding.tenantId, membershipId: binding.membershipId }) : null;
    if (json && json.length > 1024) throw new AuthError('Profile completion binding is invalid', 'AUTH_PROFILE_COMPLETION_INVALID', 400);
    this.db.prepare(`INSERT INTO _auth_profile_completion_contexts(continuation_id,policy_fingerprint,session_binding_json)
      VALUES (?,?,?)`).run(id, this.fingerprint, json);
  }
  context(id: string): CompletionContext {
    this.assertReady();
    const row = this.db.prepare('SELECT policy_fingerprint,session_binding_json FROM _auth_profile_completion_contexts WHERE continuation_id = ?')
      .get(id) as { policy_fingerprint: string; session_binding_json: string | null } | null;
    if (!row || typeof row.policy_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.policy_fingerprint)
      || (row.session_binding_json !== null && typeof row.session_binding_json !== 'string')) throw this.invalidState('context-invalid');
    if (row.policy_fingerprint !== this.fingerprint) throw new AuthError('Profile completion requirements changed; sign in again', 'AUTH_PROFILE_COMPLETION_CHANGED', 409);
    let sessionBinding: CompletionContext['sessionBinding'];
    if (row.session_binding_json !== null) {
      try {
        if (row.session_binding_json.length > 1024) throw new Error();
        const value = JSON.parse(row.session_binding_json);
        if (!value || Object.keys(value).length !== 2 || typeof value.tenantId !== 'string' || !value.tenantId
          || typeof value.membershipId !== 'string' || !value.membershipId) throw new Error();
        sessionBinding = { tenantId: value.tenantId, membershipId: value.membershipId };
      } catch { throw this.invalidState('context-invalid'); }
    }
    return { policyFingerprint: row.policy_fingerprint, sessionBinding };
  }
  private invalidState(invariant: string): AuthError {
    return createAuthStateInvariantError(this.emitCode, { component: 'profile-completion-store', invariant,
      message: '[auth] Profile completion state is invalid.' });
  }
  /** A newer runtime may tighten/disable the policy while this one is still alive. */
  private assertCurrentPolicy(): void {
    this.users.assertCurrentProfile();
    if (this.enabled) this.users.assertCurrentUserProfilePolicy();
    const state = inspectProfileCompletionSchema(this.db);
    if (state !== 'ready') {
      if (this.enabled) throw completionNotReady();
      return;
    }
    const row = this.db.prepare('SELECT policy_fingerprint FROM _auth_profile_completion_policy WHERE singleton = 1')
      .get() as { policy_fingerprint: string } | null;
    if (!row || typeof row.policy_fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.policy_fingerprint)) {
      throw this.invalidState('current-policy-invalid');
    }
    if (row.policy_fingerprint !== this.fingerprint) {
      throw new AuthError('Profile completion requirements changed; sign in again', 'AUTH_PROFILE_COMPLETION_CHANGED', 409);
    }
  }
}
export function completionNotReady(): AuthError {
  return new AuthError('Required profile completion storage is unavailable; apply the required SYSTEM migrations', 'AUTH_PROFILE_COMPLETION_NOT_READY', 503);
}

/** Identity-only first-use gate. Full sessions remain owned by the existing tenant/token boundary. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserStore } from './user-store';
import type { AuthUserProfileService } from './auth-user-profile-service';
import { AuthSessionContinuationStore, type AuthSessionContinuationRecord } from './auth-session-continuation-store';
import type { AuthTenantSessionService } from './auth-tenant-session-service';
import type { ResolvedAuthUserProfileConfig, UpdateUserProfileInput } from './auth-user-profile-types';
import type { ProfileCompletionRequired, UserProfileCompletion } from './auth-user-profile-completion-types';
import { AuthUserProfileCompletionStore, completionNotReady } from './auth-user-profile-completion-store';
import { captureProfileCompletionInput, profileCompletionToken } from './auth-user-profile-completion-request';
import { AuthError } from './types';
import { canUserReceiveAuthTokens } from './auth-user-eligibility';
import type { WebSessionBinding } from './auth-session-types';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { OBS_CODES } from '../observability/codes';

export class AuthUserProfileCompletionService {
  private readonly store: AuthUserProfileCompletionStore;
  private stopped = false;
  constructor(private readonly db: ReactiveDB, private readonly users: UserStore,
    private readonly profiles: AuthUserProfileService, private readonly continuations: AuthSessionContinuationStore,
    config: ResolvedAuthUserProfileConfig, private readonly getTenantSessions: () => AuthTenantSessionService,
    private readonly emitCode?: AuthPlatformCodeEmitter) {
    this.store = new AuthUserProfileCompletionStore(db, users, config, emitCode);
  }
  stop(): void { this.stopped = true; }
  enroll(userId: string, origin: 'signup' | 'invitation'): void { this.assertLive(); this.store.enroll(userId, origin); }
  /** Called after existing email/MFA proof but before tenant selection or session issue. */
  gate(userId: string, generation: number, mfaVerifiedAt: number | null, binding?: WebSessionBinding): ProfileCompletionRequired | null {
    this.assertLive();
    if (!this.store.eligible(userId)) return null;
    return this.users.transaction(() => {
      this.assertIdentity(userId, generation);
      const profile = this.profiles.capabilities().state === 'ready'
        ? this.profiles.readForCompletion(userId, () => this.assertIdentity(userId, generation)) : null;
      if (profile && this.store.missing(profile).length === 0) {
        this.store.markCompleted(userId); return null;
      }
      this.continuations.deleteExpired();
      const active = this.db.prepare(`SELECT COUNT(*) AS count,
        SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_count
        FROM _auth_profile_completion_continuations WHERE consumed_at IS NULL AND expires_at > ?`)
        .get(userId, Date.now()) as { count: number; user_count: number | null };
      const stored = this.db.prepare('SELECT COUNT(*) AS count FROM _auth_profile_completion_continuations').get() as { count: number };
      if ((active.user_count ?? 0) >= 10 || active.count >= 5000 || stored.count >= 50000) {
        throw new AuthError('Too many profile completion attempts; try again later', 'AUTH_PROFILE_COMPLETION_CAPACITY', 429);
      }
      const created = this.continuations.create({ userId, purpose: 'profile_completion', authGeneration: generation,
        mfaVerifiedAt, ttlMs: this.store.config.completion.ttlMs });
      this.store.putContext(created.record.continuationId, binding);
      this.assertIdentity(userId, generation);
      return { kind: 'profile_completion_required', profileCompletion: { continuation: created.continuation,
        expiresAt: created.record.expiresAt, profile, missingFields: profile ? this.store.missing(profile) : this.store.requiredFields,
        state: profile ? 'ready' : 'blocked' } };
    });
  }
  /** The final browser/native issuer calls this under its writer admission. */
  assertFullSessionAdmission(userId: string): void {
    this.assertLive();
    if (!this.store.eligible(userId)) return;
    if (this.profiles.capabilities().state !== 'ready') throw completionNotReady();
    const generation = this.users.getAuthGeneration(userId);
    const profile = this.profiles.readForCompletion(userId, () => this.assertIdentity(userId, generation));
    if (this.store.missing(profile).length > 0) throw new AuthError('Complete the required profile before entering the application', 'AUTH_PROFILE_COMPLETION_REQUIRED', 403);
  }
  read(input: unknown): UserProfileCompletion {
    this.assertLive();
    const command = captureProfileCompletionInput(input, ['continuation']);
    const raw = profileCompletionToken(command.continuation);
    return this.users.transaction(() => {
      const record = this.requireRecord(raw);
      const profile = this.profiles.capabilities().state === 'ready'
        ? this.profiles.readForCompletion(record.userId, () => { this.requireRecord(raw); }) : null;
      this.requireRecord(raw);
      return { continuation: raw, expiresAt: record.expiresAt, profile,
        missingFields: profile ? this.store.missing(profile) : this.store.requiredFields, state: profile ? 'ready' : 'blocked' };
    });
  }
  async complete(input: unknown) {
    this.assertLive();
    if (this.db.getRawDatabase().inTransaction) throw new AuthError('Profile completion must run outside an enclosing database transaction', 'AUTH_PROFILE_COMPLETION_TRANSACTION_INVALID', 409);
    const command = captureProfileCompletionInput(input, ['continuation', 'expectedRevision', 'changes']);
    const raw = profileCompletionToken(command.continuation);
    const record = this.requireRecord(raw);
    const context = this.store.context(record.continuationId);
    // Accept a profile CAS under the continuation, not a fabricated full-session user.
    // If signing subsequently fails, the durable profile remains accepted, but the
    // continuation remains unused and the user can retry using the new revision.
    this.profiles.updateForCompletion(record.userId, { expectedRevision: command.expectedRevision,
      changes: command.changes } as UpdateUserProfileInput, () => { this.requireRecord(raw); });
    const user = this.users.getUserById(record.userId)!;
    const completion = await this.getTenantSessions().complete(user, context.sessionBinding,
      record.mfaVerifiedAt, record.authGeneration, () => {
        const latest = this.requireRecord(raw);
        this.assertFullSessionAdmission(latest.userId);
        if (!this.continuations.consumeInspected(latest, 'profile_completion', latest.userId, latest.authGeneration)) return false;
        this.store.markCompleted(latest.userId);
        this.users.afterCommit(() => this.emitCode?.(OBS_CODES.AUTH_USER_PROFILE_COMPLETED, {
          metadata: { operation: 'first-use-completion' },
        }));
        return true;
      });
    return { user, completion };
  }
  private requireRecord(raw: string): AuthSessionContinuationRecord {
    this.assertLive();
    if (!this.store.enabled) throw invalidCompletion();
    this.store.assertReady();
    const record = this.continuations.inspect(raw, 'profile_completion');
    if (!record) throw invalidCompletion();
    this.store.context(record.continuationId);
    this.assertIdentity(record.userId, record.authGeneration);
    return record;
  }
  private assertIdentity(userId: string, generation: number): void {
    this.assertLive();
    this.users.assertCurrentProfile();
    const user = this.users.getUserById(userId);
    if (!user || !canUserReceiveAuthTokens(user) || this.users.getAuthGeneration(userId) !== generation) throw invalidCompletion();
  }
  private assertLive(): void {
    if (this.stopped) throw new AuthError('Profile completion is unavailable; sign in again', 'AUTH_PROFILE_COMPLETION_NOT_READY', 503);
  }
}
function invalidCompletion(): AuthError {
  return new AuthError('Profile completion is invalid or expired; sign in again', 'AUTH_PROFILE_COMPLETION_INVALID', 400);
}

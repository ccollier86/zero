/** Durable contact mail proofs and reauthenticated candidate email activation. */
import { OBS_CODES } from '../observability/codes';
import { AuthError, type AuthContext, type UserRecord } from './types';
import { AuthUserContactDomain, contactAuthorityChanged, contactUnavailable, invalidContactChallenge } from './auth-user-contact-domain';
import { captureContactInput, contactEmail, contactRevision, contactText } from './auth-user-contact-request';
import type { EmailContactVerificationResult } from './auth-user-contact-types';

export class AuthUserContactEmail {
  constructor(private readonly domain: AuthUserContactDomain) {}
  requestVerification(auth: AuthContext, input: unknown) {
    const command = captureContactInput(input, ['expectedRevision']);
    const expected = contactRevision(command.expectedRevision);
    const { deps, store } = this.domain;
    const admission = this.domain.capture(auth, 'email', true);
    return deps.users.transaction(() => {
      const current = admission.current();
      if (!this.domain.capabilities(current).email.verifyReady) throw contactUnavailable();
      const user = deps.users.getUserById(current.userId)!;
      const challenge = this.domain.createChallenge(current, 'email_verify', user.email, expected);
      this.enqueue(challenge.outbox_job_id!, user.email);
      admission.current();
      const snapshot = this.domain.snapshot(current);
      if (!store.challenge(challenge.challenge_id)) throw invalidContactChallenge();
      return snapshot;
    });
  }
  async requestChange(auth: AuthContext, input: unknown) {
    if (this.domain.deps.db.getRawDatabase().inTransaction) throw new AuthError('Contact delivery must start outside an enclosing database transaction', 'AUTH_CONTACT_TRANSACTION_INVALID', 409);
    const command = captureContactInput(input, ['expectedRevision', 'email', 'currentPassword']);
    const expected = contactRevision(command.expectedRevision);
    const email = contactEmail(command.email);
    const password = contactText(command.currentPassword, 1024);
    const admission = this.domain.capture(auth, 'email', true);
    const current = admission.current();
    if (!this.domain.capabilities(current).email.changeReady) throw contactUnavailable();
    const proof = await this.domain.deps.users.verifyPasswordForAuthentication(current.userId, password);
    admission.current();
    if (!proof) throw new AuthError('Current password is incorrect', 'INVALID_PASSWORD', 401);
    return this.domain.deps.users.transaction(() => {
      const current = admission.current();
      const { users } = this.domain.deps;
      if (proof.userId !== current.userId || proof.authGeneration !== users.getAuthGeneration(current.userId)) throw contactAuthorityChanged();
      const user = users.getUserById(current.userId)!;
      if (email === user.email) throw new AuthError('Use email verification for your current address', 'AUTH_CONTACT_EMAIL_UNCHANGED', 422);
      const existing = users.getUserByEmail(email);
      if (existing && existing.userId !== user.userId) throw new AuthError('Email address is unavailable', 'DUPLICATE_EMAIL', 409);
      const challenge = this.domain.createChallenge(current, 'email_change', email, expected);
      this.enqueue(challenge.outbox_job_id!, email);
      admission.current();
      return this.domain.snapshot(current);
    });
  }
  /** Called by the existing email queue under its bounded delivery lease. */
  createDelivery(jobId: string, recipient: string): { user: UserRecord; recipient: string; rawToken: string; expiresAt: number } | null {
    return this.domain.deps.users.transaction(() => {
      const challenge = this.domain.store.challengeForJob(jobId);
      if (!challenge || challenge.contact_value !== recipient || challenge.delivery_attempts >= 10) return null;
      try { this.domain.currentChallenge(challenge); }
      catch (error) { if (error instanceof AuthError) return null; throw error; }
      const created = this.domain.deps.actions.create({ userId: challenge.user_id,
        type: 'profile_contact_verification', skipCooldown: true,
        metadata: { contactChallengeId: challenge.challenge_id } });
      this.domain.deps.db.prepare('UPDATE _auth_contact_challenges SET delivery_attempts = delivery_attempts + 1 WHERE challenge_id = ?')
        .run(challenge.challenge_id);
      this.domain.currentChallenge(this.domain.store.challenge(challenge.challenge_id)!);
      return { user: this.domain.deps.users.getUserById(challenge.user_id)!, recipient,
        rawToken: created.rawToken, expiresAt: Math.min(created.record.expiresAt, challenge.expires_at) };
    });
  }
  assertDeliveryCurrent(jobId: string): void {
    const challenge = this.domain.store.challengeForJob(jobId);
    if (!challenge) throw invalidContactChallenge();
    this.domain.currentChallenge(challenge);
  }
  complete(input: unknown): EmailContactVerificationResult {
    const command = captureContactInput(input, ['token']);
    const raw = contactText(command.token, 512);
    const { deps, store } = this.domain;
    return deps.users.transaction(() => {
      this.domain.assertReady();
      const inspected = deps.actions.inspect(raw, ['profile_contact_verification']);
      const id = inspected.record.metadata.contactChallengeId;
      if (typeof id !== 'string') throw invalidContactChallenge();
      const challenge = store.challenge(id);
      if (!challenge || challenge.kind === 'phone_verify' || challenge.user_id !== inspected.user.userId) throw invalidContactChallenge();
      const current = this.domain.currentChallenge(challenge);
      const reference = store.authority(challenge);
      deps.actions.consume(raw, ['profile_contact_verification']);
      const changing = challenge.kind === 'email_change';
      if (changing) {
        // Current login remains untouched until the candidate's one-time proof is consumed.
        const updated = deps.users.updateUser(current.userId, { email: challenge.contact_value, emailVerificationRequired: false });
        if (!updated || updated.email !== challenge.contact_value) throw invalidContactChallenge();
        deps.users.markEmailVerified(current.userId, this.domain.now());
      }
      store.recordEmailProof(current.userId, this.domain.now(), 'possession');
      deps.db.prepare(`UPDATE _auth_contact_challenges SET status = 'verified', adapter_reference = NULL,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE challenge_id = ?`).run(this.domain.now(), id);
      // Fence after all accepted data writes, immediately before the intentional security transition.
      if (!deps.tokens.resolveAuthContextAuthority(reference)) throw contactAuthorityChanged();
      if (changing) {
        deps.users.revokeAllUserTokens(current.userId);
        if (deps.users.getAuthGeneration(current.userId) !== reference.authGeneration + 1
          || deps.users.getUserById(current.userId)?.email !== challenge.contact_value) throw contactAuthorityChanged();
      }
      deps.users.appendControlPlaneAudit({ action: changing ? 'account.email-changed' : 'account.contact-email-proved', outcome: 'succeeded',
        scope: { kind: 'application' }, actor: { userId: current.userId, provenance: 'authenticated-request' },
        target: { type: 'user', id: current.userId }, metadata: { proof: 'email-link', changed: changing } });
      deps.users.assertCurrentUserProfilePolicy();
      deps.users.afterCommit(() => deps.emitCode(OBS_CODES.AUTH_USER_CONTACT_PROVED, { metadata: { channel: 'email', securityTransition: changing } }));
      return { verified: true, userId: current.userId, requiresSignIn: changing };
    });
  }
  private enqueue(jobId: string, recipient: string): void {
    const outbox = this.domain.deps.getOutbox();
    if (!outbox || outbox.enqueueContactProof({ jobId, recipient }) !== 'enqueued') throw contactUnavailable();
  }
}

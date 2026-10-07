/** App-local own-contact facade. Uses Guardian's existing live sessions and writer domain. */
import { AuthUserContactDomain, type UserContactDependencies } from './auth-user-contact-domain';
import { AuthUserContactEmail } from './auth-user-contact-email';
import { AuthUserContactPhone } from './auth-user-contact-phone';
import { captureContactInput, contactChallengeId, contactRevision } from './auth-user-contact-request';
import { invalidContactChallenge } from './auth-user-contact-domain';
import type { AuthContext } from './types';

export class AuthUserContactService {
  private readonly domain: AuthUserContactDomain;
  private readonly emails: AuthUserContactEmail;
  private readonly phones: AuthUserContactPhone;
  constructor(deps: UserContactDependencies, adapterDeadlineMs = 15_000) {
    this.domain = new AuthUserContactDomain(deps);
    this.emails = new AuthUserContactEmail(this.domain);
    this.phones = new AuthUserContactPhone(this.domain, adapterDeadlineMs);
  }
  capabilities(auth?: AuthContext) { return this.domain.capabilities(auth); }
  read(auth: AuthContext) {
    const admission = this.domain.capture(auth);
    return this.domain.deps.users.transaction(() => {
      const current = admission.current(); const snapshot = this.domain.snapshot(current);
      admission.current(); return snapshot;
    });
  }
  setPhone(auth: AuthContext, input: unknown) { this.domain.assertReady(); return this.phones.set(auth, input); }
  requestEmailVerification(auth: AuthContext, input: unknown) { this.domain.assertReady(); return this.emails.requestVerification(auth, input); }
  requestEmailChange(auth: AuthContext, input: unknown) { this.domain.assertReady(); return this.emails.requestChange(auth, input); }
  completeEmail(input: unknown) { this.domain.assertReady(); return this.emails.complete(input); }
  requestPhoneVerification(auth: AuthContext, input: unknown) { this.domain.assertReady(); return this.phones.request(auth, input); }
  completePhone(auth: AuthContext, input: unknown) { this.domain.assertReady(); return this.phones.verify(auth, input); }
  createEmailDelivery(jobId: string, recipient: string) { if (this.domain.disposed) return null; return this.emails.createDelivery(jobId, recipient); }
  assertEmailDeliveryCurrent(jobId: string) { this.domain.assertReady(); return this.emails.assertDeliveryCurrent(jobId); }
  cancel(auth: AuthContext, input: unknown) {
    this.domain.assertReady();
    const command = captureContactInput(input, ['expectedRevision', 'challengeId']);
    const expected = contactRevision(command.expectedRevision);
    const id = contactChallengeId(command.challengeId);
    const row = this.domain.store.challenge(id);
    if (!row || row.user_id !== auth.userId) throw invalidContactChallenge();
    const admission = this.domain.capture(auth, row.kind === 'phone_verify' ? 'phone' : 'email', true);
    return this.domain.deps.users.transaction(() => {
      const current = admission.current();
      this.domain.store.advance(current.userId, expected, this.domain.now());
      this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET status = 'cancelled', adapter_reference = NULL,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE challenge_id = ? AND user_id = ?`)
        .run(this.domain.now(), id, current.userId);
      this.domain.deps.users.afterCommit(() => this.phones.cancelDelivery(row));
      admission.current(); return this.domain.snapshot(current);
    });
  }
  /** Explicit new proof only. Existing gate timestamps are never backfilled as possession. */
  recordEmailProof(userId: string, provedAt: number, provenance: 'possession' | 'administrator'): void {
    if (this.domain.capabilities().state !== 'ready') return;
    this.domain.deps.users.transaction(() => {
      this.domain.store.assertReady();
      this.domain.store.recordEmailProof(userId, provedAt, provenance);
      this.domain.deps.users.assertCurrentUserProfilePolicy();
    });
  }
  processPhoneDeliveries() { return this.phones.processDue(); }
  start(): void { if (this.domain.capabilities().state === 'ready') this.phones.start(); }
  /** Stop admission/adapter starts synchronously; the existing stop still drains admitted recovery work. */
  retire(): void { this.domain.disposed = true; this.phones.retire(); }
  async stop(): Promise<void> { this.retire(); await this.phones.stop(); }
}

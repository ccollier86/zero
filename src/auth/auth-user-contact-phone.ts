/** Phone storage/proof ceremonies and bounded, restart-safe adapter delivery. */
import { isPhoneNumber } from '../lib/phone-number';
import { OBS_CODES } from '../observability/codes';
import { AuthError, type AuthContext } from './types';
import { AuthUserContactDomain, contactUnavailable, invalidContactChallenge } from './auth-user-contact-domain';
import { captureContactInput, contactChallengeId, contactRevision, contactText, invalidContactInput } from './auth-user-contact-request';
import { AuthUserContactAdapterRequests, adapterUnavailable } from './auth-user-contact-adapter';
import { isUserProfilePolicyReady } from './auth-user-profile-policy';
import type { ContactChallenge } from './auth-user-contact-store';

export class AuthUserContactPhone {
  private readonly requests: AuthUserContactAdapterRequests;
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing: Promise<number> | null = null;
  constructor(private readonly domain: AuthUserContactDomain, deadlineMs = 15_000) {
    this.requests = new AuthUserContactAdapterRequests(deadlineMs);
  }
  set(auth: AuthContext, input: unknown) {
    const command = captureContactInput(input, ['expectedRevision', 'phone']);
    const expected = contactRevision(command.expectedRevision);
    const phone = command.phone;
    if (phone !== null && !isPhoneNumber(phone)) throw invalidContactInput();
    const admission = this.domain.capture(auth, 'phone', true);
    return this.domain.deps.users.transaction(() => {
      const current = admission.current();
      if (!this.domain.capabilities(current).phone.editable) throw new AuthError('Phone contact cannot be edited', 'AUTH_CONTACT_FIELD_NOT_EDITABLE', 403);
      const previous = this.domain.store.pending(current.userId, 'phone', this.domain.now());
      this.domain.store.advance(current.userId, expected, this.domain.now());
      const before = this.domain.store.read(current.userId);
      if (before.phone !== phone) {
        this.domain.store.setPhone(current.userId, phone);
        if (previous) this.domain.deps.users.afterCommit(() => this.cancelDelivery(previous));
      }
      admission.current();
      const snapshot = this.domain.snapshot(current);
      if (snapshot.phone?.value !== phone) throw invalidContactChallenge();
      return snapshot;
    });
  }

  /** Optional best-effort provider cleanup cannot undo a committed local retirement. */
  cancelDelivery(row: ContactChallenge): void {
    const adapter = this.domain.deps.adapter;
    if (this.domain.disposed || !isUserProfilePolicyReady(this.domain.deps.users)
      || row.kind !== 'phone_verify' || row.adapter_id !== adapter?.id
      || !row.adapter_reference || !adapter.cancel) return;
    void this.requests.run(signal => {
      this.domain.assertReady();
      return adapter.cancel!({ challengeId: row.challenge_id,
        phone: row.contact_value, reference: row.adapter_reference!, expiresAt: row.expires_at, signal });
    })
      .catch(() => this.domain.deps.emitCode(OBS_CODES.AUTH_USER_CONTACT_DELIVERY_FAILED,
        { metadata: { channel: 'phone', operation: 'adapter-cancel' } }));
  }
  async request(auth: AuthContext, input: unknown) {
    this.assertAsyncBoundary();
    const command = captureContactInput(input, ['expectedRevision']);
    const expected = contactRevision(command.expectedRevision);
    const admission = this.domain.capture(auth, 'phone', true);
    const challenge = this.domain.deps.users.transaction(() => {
      const current = admission.current();
      if (!this.domain.capabilities(current).phone.verifyReady) throw contactUnavailable();
      const value = this.domain.store.read(current.userId).phone;
      if (!value) throw new AuthError('Add a phone number before verifying it', 'AUTH_CONTACT_PHONE_REQUIRED', 422);
      const challenge = this.domain.createChallenge(current, 'phone_verify', value, expected);
      admission.current(); return challenge;
    });
    try { await this.deliver(challenge.challenge_id); }
    catch (error) { if (!this.domain.disposed) admission.current(); throw error; }
    admission.current();
    return this.domain.snapshot(admission.current());
  }
  async verify(auth: AuthContext, input: unknown) {
    this.assertAsyncBoundary();
    const command = captureContactInput(input, ['expectedRevision', 'challengeId', 'code']);
    const expected = contactRevision(command.expectedRevision);
    const id = contactChallengeId(command.challengeId);
    const code = contactText(command.code, 32);
    if (!/^[A-Za-z0-9 -]{1,32}$/.test(code)) throw invalidContactInput();
    const admission = this.domain.capture(auth, 'phone', true);
    const owner = `acv_${crypto.randomUUID()}`;
    const challenge = this.domain.deps.users.transaction(() => {
      const current = admission.current();
      if (!this.domain.capabilities(current).phone.verifyReady) throw contactUnavailable();
      const row = this.domain.store.challenge(id);
      if (!row || row.user_id !== current.userId || row.kind !== 'phone_verify' || !row.adapter_reference) throw invalidContactChallenge();
      this.domain.currentChallenge(row);
      if (this.domain.store.read(current.userId).revision !== expected) throw new AuthError('Contact details changed; reload before verifying', 'AUTH_CONTACT_REVISION_CONFLICT', 409);
      if (row.attempts >= this.domain.deps.config.maxAttempts || (row.lease_expires_at !== null && row.lease_expires_at > this.domain.now())) {
        throw new AuthError('Contact verification is already pending or has exceeded its attempt limit', 'AUTH_CONTACT_ATTEMPT_UNAVAILABLE', 429);
      }
      this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET attempts = attempts + 1,
        lease_owner = ?, lease_expires_at = ? WHERE challenge_id = ?`).run(owner, this.domain.now() + 30_000, id);
      admission.current(); return row;
    });
    let accepted: boolean;
    try {
      accepted = await this.requests.run(signal => {
        admission.current();
        return this.domain.deps.adapter!.verify({ challengeId: id, phone: challenge.contact_value,
          reference: challenge.adapter_reference!, expiresAt: challenge.expires_at, code, signal });
      });
    } catch (error) { this.release(id, owner); if (!this.domain.disposed) admission.current(); throw error; }
    admission.current();
    const result = this.domain.deps.users.transaction(() => {
      const current = admission.current();
      const row = this.domain.store.challenge(id);
      if (!row || row.lease_owner !== owner) throw invalidContactChallenge();
      this.domain.currentChallenge(row);
      if (accepted !== true) {
        this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET lease_owner = NULL, lease_expires_at = NULL,
          adapter_reference = CASE WHEN attempts >= ? THEN NULL ELSE adapter_reference END,
          status = CASE WHEN attempts >= ? THEN 'cancelled' ELSE status END WHERE challenge_id = ?`)
          .run(this.domain.deps.config.maxAttempts, this.domain.deps.config.maxAttempts, id);
        admission.current(); return null;
      }
      this.domain.store.advance(current.userId, expected, this.domain.now());
      this.domain.store.recordPhoneProof(current.userId, this.domain.now());
      this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET status = 'verified', adapter_reference = NULL,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE challenge_id = ?`).run(this.domain.now(), id);
      admission.current();
      const snapshot = this.domain.snapshot(current);
      if (snapshot.phone?.value !== challenge.contact_value || snapshot.phone.state !== 'possession-verified') throw invalidContactChallenge();
      this.domain.deps.users.afterCommit(() => this.domain.deps.emitCode(OBS_CODES.AUTH_USER_CONTACT_PROVED,
        { metadata: { channel: 'phone', securityTransition: false } }));
      return snapshot;
    });
    if (!result) throw new AuthError('Phone verification code was not accepted', 'AUTH_CONTACT_CODE_INVALID', 422);
    return result;
  }
  /** Claim a small bounded batch; expired leases and idempotent adapter starts survive restart. */
  processDue(): Promise<number> {
    if (this.processing) return this.processing;
    if (this.domain.disposed || !this.domain.deps.config.enabled || !this.domain.deps.config.phone.verify) return Promise.resolve(0);
    this.domain.assertReady();
    if (!this.domain.phoneReady()) return Promise.resolve(0);
    const rows = this.domain.deps.db.prepare(`SELECT challenge_id FROM _auth_contact_challenges
      WHERE kind = 'phone_verify' AND status = 'pending' AND expires_at > ? AND delivery_attempts < 10
      AND (lease_expires_at IS NULL OR lease_expires_at <= ?) ORDER BY created_at LIMIT 4`)
      .all(this.domain.now(), this.domain.now()) as Array<{ challenge_id: string }>;
    this.processing = Promise.all(rows.map(async row => {
      try { return await this.deliver(row.challenge_id) ? 1 : 0; }
      catch { return 0; }
    })).then(values => values.reduce<number>((sum, value) => sum + value, 0)).finally(() => { this.processing = null; });
    return this.processing;
  }
  start(): void {
    if (this.timer || !this.domain.deps.config.enabled || !this.domain.deps.config.phone.verify) return;
    this.timer = setInterval(() => this.recover(), 1_000);
    this.timer.unref?.();
    this.recover();
  }
  private recover(): void {
    void this.processDue().catch(() => {
      // Broken storage or a retired runtime cannot remain a silent hot poller.
      if (this.timer) clearInterval(this.timer);
      this.timer = null; this.requests.cancel();
      this.domain.deps.emitCode(OBS_CODES.AUTH_USER_CONTACT_DELIVERY_FAILED,
        { metadata: { channel: 'phone', operation: 'recovery-stopped' } });
    });
  }
  retire(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.requests.cancel();
  }
  async stop(): Promise<void> { this.retire(); await this.processing; }
  private async deliver(id: string): Promise<boolean> {
    const owner = `acd_${crypto.randomUUID()}`;
    const row = this.domain.deps.users.transaction(() => {
      const row = this.domain.store.challenge(id);
      if (!row || row.status !== 'pending' || row.delivery_attempts >= 10
        || (row.lease_expires_at !== null && row.lease_expires_at > this.domain.now())) return null;
      try { this.domain.currentChallenge(row); }
      catch { this.domain.deps.db.prepare("UPDATE _auth_contact_challenges SET status = 'cancelled' WHERE challenge_id = ?").run(id); return null; }
      if (!this.domain.phoneReady()) throw contactUnavailable();
      this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET delivery_attempts = delivery_attempts + 1,
        lease_owner = ?, lease_expires_at = ? WHERE challenge_id = ?`).run(owner, this.domain.now() + 30_000, id);
      this.domain.currentChallenge(this.domain.store.challenge(id)!);
      return row;
    });
    if (!row) return false;
    try {
      const receipt = await this.requests.run(signal => {
        this.domain.currentChallenge(row);
        return this.domain.deps.adapter!.start({ challengeId: id, phone: row.contact_value, expiresAt: row.expires_at, signal });
      });
      const reference = receipt && Object.getOwnPropertyDescriptor(receipt, 'reference');
      if (!reference || !('value' in reference) || typeof reference.value !== 'string'
        || reference.value.length === 0 || reference.value.length > 1024) throw adapterUnavailable();
      this.domain.deps.users.transaction(() => {
        const latest = this.domain.store.challenge(id);
        if (!latest || latest.lease_owner !== owner) throw invalidContactChallenge();
        this.domain.currentChallenge(latest);
        this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET status = 'delivered', adapter_reference = ?,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE challenge_id = ?`).run(reference.value, this.domain.now(), id);
        this.domain.currentChallenge(this.domain.store.challenge(id)!);
      });
      return true;
    } catch (error) {
      this.release(id, owner, row);
      this.domain.deps.emitCode(OBS_CODES.AUTH_USER_CONTACT_DELIVERY_FAILED, { metadata: { channel: 'phone', operation: 'adapter-start' } });
      throw error;
    }
  }
  private release(id: string, owner: string, retry?: ContactChallenge): void {
    if (this.domain.disposed || !isUserProfilePolicyReady(this.domain.deps.users)) return;
    this.domain.deps.users.transaction(() => {
      this.domain.deps.users.assertCurrentUserProfilePolicy();
      this.domain.deps.db.prepare(`UPDATE _auth_contact_challenges SET lease_owner = ?, lease_expires_at = ?,
        status = CASE WHEN delivery_attempts >= 10 THEN 'cancelled' ELSE status END
        WHERE challenge_id = ? AND lease_owner = ? AND status IN ('pending', 'delivered')`)
        .run(retry ? 'retry' : null, retry ? this.domain.now() + Math.min(30_000, 1_000 * 2 ** retry.delivery_attempts) : null, id, owner);
    });
  }
  private assertAsyncBoundary(): void {
    if (this.domain.deps.db.getRawDatabase().inTransaction) throw new AuthError('Contact delivery must start outside an enclosing database transaction', 'AUTH_CONTACT_TRANSACTION_INVALID', 409);
  }
}

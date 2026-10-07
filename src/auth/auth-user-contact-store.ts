/** Private row mechanics. Callers own live admission inside the shared writer transaction. */
import type { ReactiveDB } from '../sync/reactive-db';
import { isPhoneNumber } from '../lib/phone-number';
import { createAuthStateInvariantError, type AuthPlatformCodeEmitter } from './auth-observability';
import { snapshotAuthContextAuthorityReference } from './auth-context-authority';
import { inspectUserContactSchema } from './auth-user-contact-schema';
import { AuthError, type AuthContextAuthorityReference } from './types';
import type { UserStore } from './user-store';

export interface ContactRow {
  user_id: string; revision: number; phone: string | null; phone_generation: number;
  email_proof_generation: number | null; email_proved_at: number | null;
  email_attested_generation: number | null; email_attested_at: number | null;
  phone_proof_generation: number | null; phone_proved_at: number | null; updated_at: number;
}
export interface ContactChallenge {
  challenge_id: string; user_id: string; kind: 'email_verify' | 'email_change' | 'phone_verify';
  contact_value: string; contact_generation: number; auth_generation: number;
  authority_json: string; adapter_id: string | null; adapter_reference: string | null;
  outbox_job_id: string | null; status: 'pending' | 'delivered' | 'verified' | 'cancelled';
  attempts: number; delivery_attempts: number; lease_owner: string | null;
  lease_expires_at: number | null; expires_at: number; created_at: number; updated_at: number;
}

export class AuthUserContactStore {
  constructor(private readonly db: ReactiveDB, private readonly users: UserStore,
    private readonly emitCode?: AuthPlatformCodeEmitter) {
    if (db.getTransactionDomain() !== users.getTransactionDomain()) throw this.invariant('transaction-domain');
  }
  assertReady(): void {
    this.users.assertCurrentProfile();
    this.users.assertCurrentUserProfilePolicy();
    if (inspectUserContactSchema(this.db) !== 'ready') throw new AuthError('Contact storage is not ready; apply the required SYSTEM migration', 'AUTH_CONTACT_NOT_READY', 503);
  }
  read(userId: string): ContactRow {
    this.assertReady();
    if (!this.users.getUserById(userId)) throw new AuthError('User not found', 'USER_NOT_FOUND', 404);
    const row = this.db.prepare('SELECT * FROM _auth_user_contacts WHERE user_id = ?').get(userId) as ContactRow | null;
    if (!row) return { user_id: userId, revision: 1, phone: null, phone_generation: 1,
      email_proof_generation: null, email_proved_at: null, email_attested_generation: null,
      email_attested_at: null, phone_proof_generation: null, phone_proved_at: null, updated_at: 0 };
    if (!integer(row.revision, 1) || !integer(row.phone_generation, 1)
      || (row.phone !== null && !isPhoneNumber(row.phone))
      || !integer(row.updated_at, 0)) throw this.invariant('stored-contact');
    for (const [generation, time] of [[row.email_proof_generation, row.email_proved_at],
      [row.email_attested_generation, row.email_attested_at], [row.phone_proof_generation, row.phone_proved_at]]) {
      if ((generation === null) !== (time === null) || (generation !== null && !integer(generation, 1))
        || (time !== null && !integer(time, 0))) throw this.invariant('stored-proof');
    }
    return row;
  }
  /** Increment only against the exact private contact revision, never a browser supplied row. */
  advance(userId: string, expected: number, now: number): ContactRow {
    const current = this.read(userId);
    if (current.revision !== expected) throw contactConflict();
    if (!integer(expected, 1) || expected >= Number.MAX_SAFE_INTEGER) throw this.invariant('revision-exhausted');
    this.db.prepare(`INSERT INTO _auth_user_contacts(user_id, revision, updated_at) VALUES (?, 1, ?)
      ON CONFLICT(user_id) DO NOTHING`).run(userId, now);
    if (this.db.prepare('UPDATE _auth_user_contacts SET revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?')
      .run(now, userId, expected).changes !== 1) throw contactConflict();
    return this.read(userId);
  }
  setPhone(userId: string, phone: string | null): void {
    this.db.prepare(`UPDATE _auth_user_contacts SET phone = ?, phone_generation = phone_generation + 1,
      phone_proof_generation = NULL, phone_proved_at = NULL WHERE user_id = ?`).run(phone, userId);
    this.cancelChannel(userId, 'phone');
  }
  recordEmailProof(userId: string, now: number, provenance: 'possession' | 'administrator'): void {
    const generation = this.users.getEmailGeneration(userId);
    this.advance(userId, this.read(userId).revision, now);
    const field = provenance === 'possession' ? 'email_proof_generation' : 'email_attested_generation';
    const time = provenance === 'possession' ? 'email_proved_at' : 'email_attested_at';
    this.db.prepare(`UPDATE _auth_user_contacts SET ${field} = ?, ${time} = ? WHERE user_id = ?`).run(generation, now, userId);
  }
  recordPhoneProof(userId: string, now: number): void {
    const row = this.read(userId);
    this.db.prepare('UPDATE _auth_user_contacts SET phone_proof_generation = ?, phone_proved_at = ? WHERE user_id = ?')
      .run(row.phone_generation, now, userId);
  }
  pending(userId: string, channel: 'email' | 'phone', now: number): ContactChallenge | null {
    const condition = channel === 'phone' ? "kind = 'phone_verify'" : "kind IN ('email_verify', 'email_change')";
    return this.validate(this.db.prepare(`SELECT * FROM _auth_contact_challenges WHERE user_id = ? AND ${condition}
      AND status IN ('pending', 'delivered') AND expires_at > ? ORDER BY created_at DESC, challenge_id DESC LIMIT 1`).get(userId, now));
  }
  challenge(id: string): ContactChallenge | null {
    return this.validate(this.db.prepare('SELECT * FROM _auth_contact_challenges WHERE challenge_id = ?').get(id));
  }
  challengeForJob(jobId: string): ContactChallenge | null {
    return this.validate(this.db.prepare('SELECT * FROM _auth_contact_challenges WHERE outbox_job_id = ?').get(jobId));
  }
  latest(userId: string, channel: 'phone' | 'email'): ContactChallenge | null {
    const condition = channel === 'phone' ? "kind = 'phone_verify'" : "kind != 'phone_verify'";
    return this.validate(this.db.prepare(`SELECT * FROM _auth_contact_challenges WHERE user_id = ? AND ${condition}
      ORDER BY created_at DESC, challenge_id DESC LIMIT 1`).get(userId));
  }
  create(row: ContactChallenge): void {
    this.assertReady();
    this.db.prepare(`DELETE FROM _auth_contact_challenges WHERE challenge_id IN (
      SELECT challenge_id FROM _auth_contact_challenges WHERE expires_at < ? ORDER BY expires_at LIMIT 100)`).run(row.created_at - 86_400_000);
    const counts = this.db.prepare(`SELECT COUNT(*) AS total, SUM(status IN ('pending', 'delivered') AND expires_at > ?) AS active
      FROM _auth_contact_challenges`).get(row.created_at) as { total: number; active: number | null };
    if (counts.total >= 50_000 || (counts.active ?? 0) >= 5_000) throw new AuthError('Contact verification is temporarily unavailable', 'AUTH_CONTACT_CAPACITY', 503);
    this.cancelChannel(row.user_id, row.kind === 'phone_verify' ? 'phone' : 'email');
    this.db.prepare(`INSERT INTO _auth_contact_challenges (challenge_id,user_id,kind,contact_value,contact_generation,
      auth_generation,authority_json,adapter_id,adapter_reference,outbox_job_id,status,attempts,delivery_attempts,
      lease_owner,lease_expires_at,expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(row.challenge_id,row.user_id,row.kind,row.contact_value,row.contact_generation,row.auth_generation,row.authority_json,
        row.adapter_id,row.adapter_reference,row.outbox_job_id,row.status,row.attempts,row.delivery_attempts,row.lease_owner,
        row.lease_expires_at,row.expires_at,row.created_at,row.updated_at);
  }
  cancelChannel(userId: string, channel: 'phone' | 'email'): void {
    this.db.prepare(`UPDATE _auth_contact_challenges SET status = 'cancelled', adapter_reference = NULL,
      lease_owner = NULL, lease_expires_at = NULL WHERE user_id = ? AND status IN ('pending', 'delivered')
      AND ${channel === 'phone' ? "kind = 'phone_verify'" : "kind != 'phone_verify'"}`).run(userId);
  }
  authority(row: ContactChallenge): AuthContextAuthorityReference {
    try {
      const value = snapshotAuthContextAuthorityReference(JSON.parse(row.authority_json));
      if (value && value.userId === row.user_id && value.authGeneration === row.auth_generation) return value;
    } catch { /* Static invariant below; never print the retained row. */ }
    throw this.invariant('stored-authority');
  }
  private validate(value: unknown): ContactChallenge | null {
    if (!value) return null;
    const row = value as ContactChallenge;
    if (typeof row.authority_json !== 'string' || row.authority_json.length > 8192
      || typeof row.contact_value !== 'string' || row.contact_value.length > 254
      || !integer(row.contact_generation, 1) || !integer(row.auth_generation, 0)
      || !integer(row.attempts, 0) || row.attempts > 10 || !integer(row.delivery_attempts, 0) || row.delivery_attempts > 10
      || !integer(row.expires_at, 0) || !integer(row.created_at, 0)
      || (row.adapter_reference !== null && (typeof row.adapter_reference !== 'string' || row.adapter_reference.length > 1024))) throw this.invariant('stored-challenge');
    this.authority(row);
    return row;
  }
  private invariant(name: string): AuthError {
    return createAuthStateInvariantError(this.emitCode, { component: 'user-contacts-store', invariant: name,
      message: '[auth] Stored contact state is invalid.' });
  }
}
export function contactConflict(): AuthError {
  return new AuthError('Contact details changed; reload before saving', 'AUTH_CONTACT_REVISION_CONFLICT', 409);
}
function integer(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

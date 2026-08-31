/** Durable server-trusted registration intent used across verification resends. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';

export class RegistrationIntentStore {
  private readonly setIntent: Statement;
  private readonly getIntent: Statement;
  private readonly clearIntent: Statement;

  constructor(db: ReactiveDB) {
    this.setIntent = db.prepare(`INSERT INTO _auth_registration_intents
      (user_id, mfa_enrollment_requested, created_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        mfa_enrollment_requested = excluded.mfa_enrollment_requested,
        created_at = excluded.created_at`);
    this.getIntent = db.prepare(`SELECT mfa_enrollment_requested
      FROM _auth_registration_intents WHERE user_id = ?`);
    this.clearIntent = db.prepare('DELETE FROM _auth_registration_intents WHERE user_id = ?');
  }

  setMfaEnrollment(userId: string, requested: boolean): void {
    this.setIntent.run(userId, requested ? 1 : 0, Date.now());
  }

  wantsMfaEnrollment(userId: string): boolean {
    const row = this.getIntent.get(userId) as { mfa_enrollment_requested?: number } | null;
    return row?.mfa_enrollment_requested === 1;
  }

  clear(userId: string): boolean {
    return this.clearIntent.run(userId).changes === 1;
  }
}

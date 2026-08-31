/** User binding for native browser continuations. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { hashToken } from '../../tokens/token-utils';

export class NativeRequestBindingStore {
  private readonly begin: Statement;
  private readonly claim: Statement;
  private readonly match: Statement;
  private readonly available: Statement;
  private readonly release: Statement;

  constructor(db: ReactiveDB, private readonly now: () => number) {
    this.begin = db.prepare(`UPDATE _auth_native_requests SET prompt = 'create-resume'
      WHERE request_hash = ? AND prompt = 'create' AND consumed_at IS NULL AND expires_at > ?`);
    this.claim = db.prepare(`UPDATE _auth_native_requests SET bound_user_id = ?
      WHERE request_hash = ? AND (prompt IS NULL OR prompt = 'create-resume')
        AND (bound_user_id IS NULL OR bound_user_id = ?)
        AND consumed_at IS NULL AND expires_at > ?`);
    this.match = db.prepare(`SELECT 1 FROM _auth_native_requests
      WHERE request_hash = ? AND bound_user_id = ?
        AND (prompt IS NULL OR prompt = 'create-resume')
        AND consumed_at IS NULL AND expires_at > ?`);
    this.available = db.prepare(`SELECT 1 FROM _auth_native_requests
      WHERE request_hash = ? AND bound_user_id IS NULL
        AND (prompt IS NULL OR prompt = 'create-resume')
        AND consumed_at IS NULL AND expires_at > ?`);
    this.release = db.prepare(`UPDATE _auth_native_requests SET bound_user_id = NULL
      WHERE request_hash = ? AND bound_user_id = ?
        AND consumed_at IS NULL AND expires_at > ?`);
  }

  beginRegistration(raw: string): boolean {
    return this.begin.run(hashToken(raw), this.now()).changes === 1;
  }

  claimForUser(raw: string, userId: string): boolean {
    return this.claim.run(userId, hashToken(raw), userId, this.now()).changes === 1;
  }

  matchesUser(raw: string, userId: string): boolean {
    return Boolean(this.match.get(hashToken(raw), userId, this.now()));
  }

  isAvailable(raw: string): boolean {
    return Boolean(this.available.get(hashToken(raw), this.now()));
  }

  releaseForUser(raw: string, userId: string): boolean {
    return this.release.run(hashToken(raw), userId, this.now()).changes === 1;
  }
}

/** User binding for native browser continuations. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import { hashToken } from '../../tokens/token-utils';
import type { NativeAuthoritySnapshot } from './native-tenant-authority';

export class NativeRequestBindingStore {
  private readonly begin: Statement;
  private readonly claimUser: Statement;
  private readonly claimAuthority: Statement;
  private readonly matchUser: Statement;
  private readonly matchAuthority: Statement;
  private readonly available: Statement;
  private readonly release: Statement;

  constructor(db: ReactiveDB, private readonly now: () => number) {
    this.begin = db.prepare(`UPDATE _auth_native_requests SET prompt = 'create-resume'
      WHERE request_hash = ? AND prompt = 'create' AND consumed_at IS NULL AND expires_at > ?`);
    this.claimUser = db.prepare(`UPDATE _auth_native_requests SET bound_user_id = ?
      WHERE request_hash = ? AND (prompt IS NULL OR prompt = 'create-resume')
        AND (bound_user_id IS NULL OR bound_user_id = ?)
        AND consumed_at IS NULL AND expires_at > ?`);
    this.claimAuthority = db.prepare(`UPDATE _auth_native_requests
      SET bound_user_id = ?, scope_kind = ?, scope_id = ?, tenant_id = ?,
          membership_id = ?, tenant_authorization_generation = ?,
          membership_authorization_generation = ?
      WHERE request_hash = ? AND (prompt IS NULL OR prompt = 'create-resume')
        AND (bound_user_id IS NULL OR bound_user_id = ?)
        AND (scope_kind IS NULL OR (
          scope_kind = ? AND scope_id = ? AND tenant_id IS ?
          AND membership_id IS ? AND tenant_authorization_generation IS ?
          AND membership_authorization_generation IS ?
        ))
        AND consumed_at IS NULL AND expires_at > ?`);
    this.matchUser = db.prepare(`SELECT 1 FROM _auth_native_requests
      WHERE request_hash = ? AND bound_user_id = ?
        AND (prompt IS NULL OR prompt = 'create-resume')
        AND consumed_at IS NULL AND expires_at > ?`);
    this.matchAuthority = db.prepare(`SELECT 1 FROM _auth_native_requests
      WHERE request_hash = ? AND bound_user_id = ?
        AND scope_kind = ? AND scope_id = ? AND tenant_id IS ?
        AND membership_id IS ? AND tenant_authorization_generation IS ?
        AND membership_authorization_generation IS ?
        AND (prompt IS NULL OR prompt = 'create-resume')
        AND consumed_at IS NULL AND expires_at > ?`);
    this.available = db.prepare(`SELECT 1 FROM _auth_native_requests
      WHERE request_hash = ? AND bound_user_id IS NULL
        AND (prompt IS NULL OR prompt = 'create-resume')
        AND consumed_at IS NULL AND expires_at > ?`);
    this.release = db.prepare(`UPDATE _auth_native_requests
      SET bound_user_id = NULL, scope_kind = NULL, scope_id = NULL,
          tenant_id = NULL, membership_id = NULL,
          tenant_authorization_generation = NULL,
          membership_authorization_generation = NULL
      WHERE request_hash = ? AND bound_user_id = ?
        AND consumed_at IS NULL AND expires_at > ?`);
  }

  beginRegistration(raw: string): boolean {
    return this.begin.run(hashToken(raw), this.now()).changes === 1;
  }

  claimForUser(raw: string, userId: string): boolean {
    return this.claimUser.run(userId, hashToken(raw), userId, this.now()).changes === 1;
  }

  matchesUser(raw: string, userId: string): boolean {
    return Boolean(this.matchUser.get(hashToken(raw), userId, this.now()));
  }

  claimForAuthority(
    raw: string,
    userId: string,
    authority: NativeAuthoritySnapshot,
  ): boolean {
    return this.claimAuthority.run(
      userId,
      ...authorityValues(authority),
      hashToken(raw),
      userId,
      ...authorityValues(authority),
      this.now(),
    ).changes === 1;
  }

  matchesAuthority(
    raw: string,
    userId: string,
    authority: NativeAuthoritySnapshot,
  ): boolean {
    return Boolean(this.matchAuthority.get(
      hashToken(raw),
      userId,
      ...authorityValues(authority),
      this.now(),
    ));
  }

  isAvailable(raw: string): boolean {
    return Boolean(this.available.get(hashToken(raw), this.now()));
  }

  releaseForUser(raw: string, userId: string): boolean {
    return this.release.run(hashToken(raw), userId, this.now()).changes === 1;
  }
}

function authorityValues(authority: NativeAuthoritySnapshot) {
  return [
    authority.scopeKind,
    authority.scopeId,
    authority.tenantId,
    authority.membershipId,
    authority.tenantAuthorizationGeneration,
    authority.membershipAuthorizationGeneration,
  ] as const;
}

/** Exact live-family lookup for native access-token admission. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';

export interface NativeFamilyAccess {
  familyId: string;
  userId: string;
  clientId: string;
  authGeneration: number;
}

export class NativeSessionAccessStore {
  private readonly activeFamily: Statement;

  constructor(db: ReactiveDB, private readonly now: () => number) {
    this.activeFamily = db.prepare(`SELECT 1 FROM _auth_native_sessions
      WHERE family_id = ? AND user_id = ? AND client_id = ? AND auth_generation = ?
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM _auth_native_sessions AS family
          WHERE family.family_id = ? AND (
            family.user_id <> ? OR family.client_id <> ?
            OR family.auth_generation <> ? OR family.revoked_at IS NOT NULL
          )
        )
      LIMIT 1`);
  }

  isActive(access: NativeFamilyAccess, now = this.now()): boolean {
    return Boolean(this.activeFamily.get(
      access.familyId, access.userId, access.clientId, access.authGeneration, now,
      access.familyId, access.userId, access.clientId, access.authGeneration,
    ));
  }
}

/** Exact live-family lookup for native access-token admission. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { NativeSessionRecord } from './native-auth-records';
import { toNativeSession } from './native-row-mappers';

export interface NativeFamilyAccess {
  familyId: string;
  userId: string;
  clientId: string;
  authGeneration: number;
}

export class NativeSessionAccessStore {
  private readonly activeFamily: Statement;

  constructor(db: ReactiveDB, private readonly now: () => number) {
    this.activeFamily = db.prepare(`SELECT current.* FROM _auth_native_sessions AS current
      WHERE current.family_id = ? AND current.user_id = ? AND current.client_id = ?
        AND current.auth_generation = ? AND current.consumed_at IS NULL
        AND current.revoked_at IS NULL AND current.expires_at > ?
        AND NOT EXISTS (
          SELECT 1 FROM _auth_native_sessions AS family
          WHERE family.family_id = current.family_id AND (
            family.user_id <> current.user_id OR family.client_id <> current.client_id
            OR family.auth_generation <> current.auth_generation
            OR COALESCE(family.scope_kind, 'application')
              <> COALESCE(current.scope_kind, 'application')
            OR COALESCE(family.scope_id, 'application')
              <> COALESCE(current.scope_id, 'application')
            OR family.tenant_id IS NOT current.tenant_id
            OR family.membership_id IS NOT current.membership_id
            OR family.tenant_authorization_generation
              IS NOT current.tenant_authorization_generation
            OR family.membership_authorization_generation
              IS NOT current.membership_authorization_generation
            OR family.revoked_at IS NOT NULL
          )
        )
      ORDER BY current.created_at DESC
      LIMIT 1`);
  }

  isActive(access: NativeFamilyAccess, now = this.now()): boolean {
    return this.resolveActive(access, now) !== null;
  }

  resolveActive(
    access: NativeFamilyAccess,
    now = this.now(),
  ): NativeSessionRecord | null {
    const row = this.activeFamily.get(
      access.familyId, access.userId, access.clientId, access.authGeneration, now,
    );
    return row ? toNativeSession(row as Record<string, unknown>) : null;
  }
}

/**
 * storage-studio-profile-store.ts
 *
 * Persists and pages managed-drive profiles in the authoritative system
 * database. Operation receipts and provider jobs use separate stores.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { StorageStudioDriveListRequest } from './storage-studio-contracts';
import { StorageDomainError } from './storage-domain-error';
import type {
  StorageStudioOwnerKind,
  StorageStudioScopeKind,
} from './storage-studio-ownership';
import {
  STORAGE_DRIVE_PROFILES_TABLE,
  type StorageStudioDriveProfile,
} from './storage-studio-schema';

export interface StorageStudioProfilePage {
  readonly profiles: readonly StorageStudioDriveProfile[];
  readonly nextCursor: string | null;
}

export interface StorageStudioListScope {
  readonly kind: StorageStudioScopeKind;
  readonly id: string;
  readonly actorUserId: string;
  readonly includeScopeCatalog: boolean;
}

/** Profile-only persistence adapter. */
export class StorageStudioProfileStore {
  private readonly getProfileStatement;

  constructor(private readonly db: ReactiveDB) {
    this.getProfileStatement = db.prepare(
      `SELECT * FROM ${STORAGE_DRIVE_PROFILES_TABLE} WHERE drive_id = ?`,
    );
  }

  get(driveId: string): StorageStudioDriveProfile | null {
    return this.getProfileStatement.get(driveId) as StorageStudioDriveProfile | null;
  }

  getByKey(
    scopeKind: StorageStudioScopeKind,
    scopeId: string,
    ownerKind: StorageStudioOwnerKind,
    ownerId: string,
    key: string,
  ): StorageStudioDriveProfile | null {
    return this.db.prepare(`
      SELECT * FROM ${STORAGE_DRIVE_PROFILES_TABLE}
      WHERE scope_kind = ? AND scope_id = ? AND owner_kind = ?
        AND owner_id = ? AND drive_key = ? COLLATE NOCASE
    `).get(scopeKind, scopeId, ownerKind, ownerId, key) as StorageStudioDriveProfile | null;
  }

  countForOwner(
    scopeKind: StorageStudioScopeKind,
    scopeId: string,
    ownerKind: StorageStudioOwnerKind,
    ownerId: string,
  ): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count FROM ${STORAGE_DRIVE_PROFILES_TABLE}
      WHERE scope_kind = ? AND scope_id = ? AND owner_kind = ? AND owner_id = ?
        AND lifecycle <> 'deleted'
    `).get(scopeKind, scopeId, ownerKind, ownerId) as { count: number };
    return row.count;
  }

  list(
    scope: StorageStudioListScope,
    request: StorageStudioDriveListRequest,
  ): StorageStudioProfilePage {
    const limit = Math.min(Math.max(request.limit ?? 50, 1), 100);
    const cursor = request.cursor ? decodeCursor(request.cursor) : null;
    const clauses = ['p.scope_kind = ?', 'p.scope_id = ?'];
    const values: Array<string | number> = [scope.kind, scope.id];
    appendOwnerPredicate(clauses, values, scope, request);
    if (request.lifecycle && request.lifecycle !== 'all') {
      clauses.push('p.lifecycle = ?');
      values.push(request.lifecycle);
    }
    const search = normalizeSearch(request.search);
    if (search) {
      clauses.push("(lower(p.drive_key) LIKE ? ESCAPE '\\' OR lower(d.name) LIKE ? ESCAPE '\\')");
      const pattern = `%${escapeLike(search)}%`;
      values.push(pattern, pattern);
    }
    if (cursor) {
      clauses.push('(p.updated_at < ? OR (p.updated_at = ? AND p.drive_id < ?))');
      values.push(cursor.updatedAt, cursor.updatedAt, cursor.driveId);
    }
    values.push(limit + 1);
    const rows = this.db.prepare(`
      SELECT p.* FROM ${STORAGE_DRIVE_PROFILES_TABLE} p
      JOIN storage_drives d ON d.drive_id = p.drive_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.updated_at DESC, p.drive_id DESC
      LIMIT ?
    `).all(...values) as StorageStudioDriveProfile[];
    const hasMore = rows.length > limit;
    const profiles = hasMore ? rows.slice(0, limit) : rows;
    const last = profiles.at(-1);
    return Object.freeze({
      profiles: Object.freeze(profiles),
      nextCursor: hasMore && last ? encodeCursor(last.updated_at, last.drive_id) : null,
    });
  }

  insert(profile: StorageStudioDriveProfile): void {
    this.db.prepare(`
      INSERT INTO ${STORAGE_DRIVE_PROFILES_TABLE} (
        drive_id, drive_key, owner_kind, owner_id, scope_kind, scope_id,
        lifecycle, revision, provider, provider_namespace, isolation_mode,
        generation, created_by_user_id, created_by_membership_id,
        updated_by_user_id, updated_by_membership_id, created_at, updated_at,
        ready_at, degraded_at, suspended_at, deleting_at, deleted_at,
        restoring_at, failed_at, failure_code
      ) VALUES (${Array.from({ length: 26 }, () => '?').join(', ')})
    `).run(...profileValues(profile));
  }

  update(profile: StorageStudioDriveProfile): void {
    this.db.prepare(`
      UPDATE ${STORAGE_DRIVE_PROFILES_TABLE} SET
        lifecycle = ?, revision = ?, generation = ?,
        updated_by_user_id = ?, updated_by_membership_id = ?, updated_at = ?,
        ready_at = ?, degraded_at = ?, suspended_at = ?, deleting_at = ?,
        deleted_at = ?, restoring_at = ?, failed_at = ?, failure_code = ?
      WHERE drive_id = ?
    `).run(...profileUpdateValues(profile), profile.drive_id);
  }

  /** Replace one profile only while its persisted revision still matches. */
  updateAtRevision(profile: StorageStudioDriveProfile, expectedRevision: number): boolean {
    const result = this.db.prepare(`
      UPDATE ${STORAGE_DRIVE_PROFILES_TABLE} SET
        lifecycle = ?, revision = ?, generation = ?,
        updated_by_user_id = ?, updated_by_membership_id = ?, updated_at = ?,
        ready_at = ?, degraded_at = ?, suspended_at = ?, deleting_at = ?,
        deleted_at = ?, restoring_at = ?, failed_at = ?, failure_code = ?
      WHERE drive_id = ? AND revision = ?
    `).run(...profileUpdateValues(profile), profile.drive_id, expectedRevision);
    return result.changes === 1;
  }
}

interface DecodedCursor {
  readonly updatedAt: number;
  readonly driveId: string;
}

function appendOwnerPredicate(
  clauses: string[],
  values: Array<string | number>,
  scope: StorageStudioListScope,
  request: StorageStudioDriveListRequest,
): void {
  if (!scope.includeScopeCatalog || request.owner === 'personal') {
    clauses.push("p.owner_kind = 'user'", 'p.owner_id = ?');
    values.push(scope.actorUserId);
  } else if (request.owner === 'organization') {
    clauses.push(scope.kind === 'application'
      ? "p.owner_kind = 'application'"
      : "p.owner_kind = 'organization'");
  }
}

function profileValues(profile: StorageStudioDriveProfile): Array<string | number | null> {
  return [
    profile.drive_id, profile.drive_key, profile.owner_kind, profile.owner_id,
    profile.scope_kind, profile.scope_id, profile.lifecycle, profile.revision,
    profile.provider, profile.provider_namespace, profile.isolation_mode,
    profile.generation, profile.created_by_user_id, profile.created_by_membership_id,
    profile.updated_by_user_id, profile.updated_by_membership_id, profile.created_at,
    profile.updated_at, profile.ready_at, profile.degraded_at, profile.suspended_at,
    profile.deleting_at, profile.deleted_at, profile.restoring_at, profile.failed_at,
    profile.failure_code,
  ];
}

function profileUpdateValues(
  profile: StorageStudioDriveProfile,
): Array<string | number | null> {
  return [
    profile.lifecycle,
    profile.revision,
    profile.generation,
    profile.updated_by_user_id,
    profile.updated_by_membership_id,
    profile.updated_at,
    profile.ready_at,
    profile.degraded_at,
    profile.suspended_at,
    profile.deleting_at,
    profile.deleted_at,
    profile.restoring_at,
    profile.failed_at,
    profile.failure_code,
  ];
}

function encodeCursor(updatedAt: number, driveId: string): string {
  return new TextEncoder()
    .encode(JSON.stringify([updatedAt, driveId]))
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

function decodeCursor(cursor: string): DecodedCursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/u.test(cursor)) throw new TypeError('invalid');
    const decoded = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decoded));
    if (!Array.isArray(parsed)
      || parsed.length !== 2
      || !Number.isSafeInteger(parsed[0])
      || parsed[0] < 0
      || typeof parsed[1] !== 'string'
      || parsed[1].length < 1
      || parsed[1].length > 128) throw new TypeError('invalid');
    return { updatedAt: parsed[0], driveId: parsed[1] };
  } catch {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Storage Studio cursor is invalid.');
  }
}

function normalizeSearch(input: string | undefined): string | null {
  if (input === undefined) return null;
  const value = input.trim().toLowerCase();
  if (value.length > 120) {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Storage search is too long.');
  }
  return value || null;
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (value) => `\\${value}`);
}

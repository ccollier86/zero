/** Synchronous persistence boundary for private Guardian API-key rows. */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';
import { defineAuthApiKeyTables } from './auth-api-key-schema';
import type {
  AuthApiKeyCreatedVia,
  AuthApiKeyRecord,
  AuthApiKeyScopeKind,
} from './auth-api-key-types';

interface ApiKeyRow {
  key_id: string;
  user_id: string;
  label: string;
  secret_hash: string;
  secret_hint: string;
  scope_kind: AuthApiKeyScopeKind;
  scope_id: string;
  tenant_id: string | null;
  membership_id: string | null;
  issued_auth_generation: number;
  key_generation: number;
  created_by_user_id: string | null;
  created_via: AuthApiKeyCreatedVia;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  revoked_by_user_id: string | null;
  rotated_from_key_id: string | null;
}

export interface InsertAuthApiKeyInput {
  keyId: string;
  userId: string;
  label: string;
  secretHash: string;
  secretHint: string;
  scopeKind: AuthApiKeyScopeKind;
  scopeId: string;
  tenantId: string | null;
  membershipId: string | null;
  issuedAuthGeneration: number;
  createdByUserId: string;
  createdVia: AuthApiKeyCreatedVia;
  createdAt: number;
  expiresAt: number;
  rotatedFromKeyId?: string | null;
}

export interface AuthApiKeyStoreCursor {
  readonly createdAt: number;
  readonly keyId: string;
}

export interface AuthApiKeyStorePageInput {
  readonly limit: number;
  readonly cursor: AuthApiKeyStoreCursor | null;
}

export class AuthApiKeyStore {
  private readonly insertStatement: Statement;
  private readonly byIdStatement: Statement;
  private readonly listUserScopeStatement: Statement;
  private readonly listTenantStatement: Statement;
  private readonly listAllStatement: Statement;
  private readonly countActiveStatement: Statement;
  private readonly revokeStatement: Statement;
  private readonly touchStatement: Statement;

  constructor(private readonly db: ReactiveDB) {
    defineAuthApiKeyTables(db);
    this.insertStatement = db.prepare(`
      INSERT INTO _auth_api_keys (
        key_id, user_id, label, secret_hash, secret_hint,
        scope_kind, scope_id, tenant_id, membership_id,
        issued_auth_generation, key_generation,
        created_by_user_id, created_via, created_at, expires_at,
        rotated_from_key_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    `);
    this.byIdStatement = db.prepare(`
      SELECT * FROM _auth_api_keys WHERE key_id = ?
    `);
    this.listUserScopeStatement = db.prepare(`
      SELECT * FROM _auth_api_keys
      WHERE user_id = ? AND scope_kind = ? AND scope_id = ?
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND key_id < ?))
      ORDER BY created_at DESC, key_id DESC
      LIMIT ?
    `);
    this.listTenantStatement = db.prepare(`
      SELECT * FROM _auth_api_keys
      WHERE tenant_id = ?
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND key_id < ?))
      ORDER BY created_at DESC, key_id DESC
      LIMIT ?
    `);
    this.listAllStatement = db.prepare(`
      SELECT * FROM _auth_api_keys
      WHERE (? IS NULL OR created_at < ? OR (created_at = ? AND key_id < ?))
      ORDER BY created_at DESC, key_id DESC
      LIMIT ?
    `);
    this.countActiveStatement = db.prepare(`
      SELECT COUNT(*) AS count FROM _auth_api_keys
      WHERE user_id = ? AND scope_kind = ? AND scope_id = ?
        AND issued_auth_generation = ?
        AND revoked_at IS NULL AND expires_at > ?
    `);
    this.revokeStatement = db.prepare(`
      UPDATE _auth_api_keys
      SET revoked_at = ?, revoked_by_user_id = ?, key_generation = key_generation + 1
      WHERE key_id = ? AND key_generation = ? AND revoked_at IS NULL
    `);
    this.touchStatement = db.prepare(`
      UPDATE _auth_api_keys SET last_used_at = ?
      WHERE key_id = ? AND key_generation = ? AND revoked_at IS NULL
        AND (last_used_at IS NULL OR last_used_at < ?)
    `);
  }

  transaction<T>(operation: () => T): T {
    return this.db.transaction(operation);
  }

  afterCommit(callback: () => unknown): void {
    this.db.afterCommit(callback);
  }

  insert(input: InsertAuthApiKeyInput): AuthApiKeyRecord {
    this.insertStatement.run(
      input.keyId,
      input.userId,
      input.label,
      input.secretHash,
      input.secretHint,
      input.scopeKind,
      input.scopeId,
      input.tenantId,
      input.membershipId,
      input.issuedAuthGeneration,
      input.createdByUserId,
      input.createdVia,
      input.createdAt,
      input.expiresAt,
      input.rotatedFromKeyId ?? null,
    );
    return this.getById(input.keyId)!;
  }

  getById(keyId: string): AuthApiKeyRecord | null {
    return mapRow(this.byIdStatement.get(keyId) as ApiKeyRow | null);
  }

  listForUserScope(
    userId: string,
    scopeKind: AuthApiKeyScopeKind,
    scopeId: string,
    page: AuthApiKeyStorePageInput,
  ): AuthApiKeyRecord[] {
    const cursor = cursorArguments(page.cursor);
    return (this.listUserScopeStatement.all(
      userId,
      scopeKind,
      scopeId,
      ...cursor,
      page.limit,
    ) as ApiKeyRow[])
      .map((row) => mapRow(row)!);
  }

  listForTenant(
    tenantId: string,
    page: AuthApiKeyStorePageInput,
  ): AuthApiKeyRecord[] {
    const cursor = cursorArguments(page.cursor);
    return (this.listTenantStatement.all(tenantId, ...cursor, page.limit) as ApiKeyRow[])
      .map((row) => mapRow(row)!);
  }

  listAll(page: AuthApiKeyStorePageInput): AuthApiKeyRecord[] {
    return (this.listAllStatement.all(
      ...cursorArguments(page.cursor),
      page.limit,
    ) as ApiKeyRow[]).map((row) => mapRow(row)!);
  }

  countActiveForUserScope(
    userId: string,
    scopeKind: AuthApiKeyScopeKind,
    scopeId: string,
    authGeneration: number,
    now: number,
  ): number {
    const row = this.countActiveStatement.get(
      userId,
      scopeKind,
      scopeId,
      authGeneration,
      now,
    ) as {
      count: number;
    };
    return Number(row.count);
  }

  revoke(
    keyId: string,
    expectedGeneration: number,
    revokedByUserId: string,
    now: number,
  ): boolean {
    return this.revokeStatement.run(
      now,
      revokedByUserId,
      keyId,
      expectedGeneration,
    ).changes === 1;
  }

  touchLastUsed(
    keyId: string,
    expectedGeneration: number,
    now: number,
    cutoff: number,
  ): void {
    this.touchStatement.run(now, keyId, expectedGeneration, cutoff);
  }
}

function cursorArguments(
  cursor: AuthApiKeyStoreCursor | null,
): [number | null, number | null, number | null, string | null] {
  return cursor
    ? [cursor.createdAt, cursor.createdAt, cursor.createdAt, cursor.keyId]
    : [null, null, null, null];
}

function mapRow(row: ApiKeyRow | null): AuthApiKeyRecord | null {
  if (!row) return null;
  return Object.freeze({
    keyId: row.key_id,
    userId: row.user_id,
    label: row.label,
    secretHash: row.secret_hash,
    secretHint: row.secret_hint,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    tenantId: row.tenant_id,
    membershipId: row.membership_id,
    issuedAuthGeneration: row.issued_auth_generation,
    keyGeneration: row.key_generation,
    createdByUserId: row.created_by_user_id,
    createdVia: row.created_via,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    revokedByUserId: row.revoked_by_user_id,
    rotatedFromKeyId: row.rotated_from_key_id,
  });
}

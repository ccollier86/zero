/** SQLite row mappers for native auth stores. */

import type {
  NativeAuthorizationCodeRecord,
  NativeAuthorizationRequestRecord,
  NativeSessionRecord,
} from './native-auth-records';

export function toAuthorizationRequest(row: Record<string, unknown>): NativeAuthorizationRequestRecord {
  return {
    requestId: String(row.request_id), clientId: String(row.client_id),
    redirectUri: String(row.redirect_uri), scope: String(row.scope),
    state: String(row.state), nonce: String(row.nonce),
    codeChallenge: String(row.code_challenge), prompt: nullableString(row.prompt),
    boundUserId: nullableString(row.bound_user_id),
    ...toAuthority(row),
    sourceHash: nullableString(row.source_hash),
    createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    consumedAt: nullableNumber(row.consumed_at),
  };
}

export function toAuthorizationCode(row: Record<string, unknown>): NativeAuthorizationCodeRecord {
  return {
    codeId: String(row.code_id), requestId: String(row.request_id),
    userId: String(row.user_id), clientId: String(row.client_id),
    redirectUri: String(row.redirect_uri), scope: String(row.scope),
    nonce: String(row.nonce), codeChallenge: String(row.code_challenge),
    authGeneration: Number(row.auth_generation), createdAt: Number(row.created_at),
    ...toAuthority(row),
    expiresAt: Number(row.expires_at), consumedAt: nullableNumber(row.consumed_at),
  };
}

export function toNativeSession(row: Record<string, unknown>): NativeSessionRecord {
  return {
    tokenId: String(row.token_id), familyId: String(row.family_id),
    userId: String(row.user_id), clientId: String(row.client_id),
    scope: String(row.scope), authGeneration: Number(row.auth_generation),
    ...toAuthority(row),
    expiresAt: Number(row.expires_at), createdAt: Number(row.created_at),
    rotationCount: Number(row.rotation_count ?? 0),
    consumedAt: nullableNumber(row.consumed_at), revokedAt: nullableNumber(row.revoked_at),
    replacedBy: nullableString(row.replaced_by),
  };
}

function toAuthority(row: Record<string, unknown>) {
  const kind = row.scope_kind;
  return {
    scopeKind: kind === 'application' || kind === 'tenant' ? kind : null,
    scopeId: nullableString(row.scope_id),
    tenantId: nullableString(row.tenant_id),
    membershipId: nullableString(row.membership_id),
    tenantAuthorizationGeneration: nullableNumber(row.tenant_authorization_generation),
    membershipAuthorizationGeneration: nullableNumber(row.membership_authorization_generation),
  } as const;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

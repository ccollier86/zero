/** Strict response validation for Guardian API-key management boundaries. */

import { isAuthApiKeyTimestamp } from '../../auth/auth-api-key-time';
import type {
  AuthApiKeyPage,
  AuthApiKeyStatus,
  AuthApiKeySummary,
  IssuedAuthApiKey,
} from './auth-api-key-types';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SUBJECT_ID = /^[A-Za-z0-9_-]+$/;
const HINT = /^[A-Za-z0-9_-]{4}$/;
const SECRET = /^zero_ak_v1\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;
const STATUSES = new Set<AuthApiKeyStatus>([
  'active', 'expired', 'revoked', 'invalidated', 'unavailable',
]);
const MAX_PAGE = 100;

export function parseAuthApiKeyPage(value: unknown): AuthApiKeyPage {
  const result = exact(value, ['apiKeys', 'capabilities', 'page']);
  if (!Array.isArray(result.apiKeys) || result.apiKeys.length > MAX_PAGE) throw invalid();
  const apiKeys = Object.freeze(result.apiKeys.map(parseAuthApiKeySummary));
  if (new Set(apiKeys.map((key) => key.keyId)).size !== apiKeys.length) throw invalid();
  const rawCapabilities = exact(result.capabilities, [
    'canIssue', 'canRotate', 'canRevoke',
  ]);
  if (typeof rawCapabilities.canIssue !== 'boolean'
    || typeof rawCapabilities.canRotate !== 'boolean'
    || typeof rawCapabilities.canRevoke !== 'boolean') throw invalid();
  const capabilities = Object.freeze({
    canIssue: rawCapabilities.canIssue,
    canRotate: rawCapabilities.canRotate,
    canRevoke: rawCapabilities.canRevoke,
  });
  const page = exact(result.page, ['limit', 'count', 'hasMore', 'nextCursor']);
  const limit = integer(page.limit, 1, MAX_PAGE);
  const count = integer(page.count, 0, limit);
  const hasMore = page.hasMore;
  const nextCursor = page.nextCursor === null ? null : text(page.nextCursor, 512);
  if (count !== apiKeys.length || typeof hasMore !== 'boolean'
    || hasMore !== (nextCursor !== null)) throw invalid();
  return Object.freeze({
    apiKeys,
    capabilities,
    page: Object.freeze({ limit, count, hasMore, nextCursor }),
  });
}

export function parseIssuedAuthApiKey(value: unknown): IssuedAuthApiKey {
  const result = exact(value, ['apiKey', 'secret']);
  const apiKey = parseAuthApiKeySummary(result.apiKey);
  if (typeof result.secret !== 'string' || !SECRET.test(result.secret)) throw invalid();
  const [, keyId, opaque] = result.secret.split('.');
  if (keyId !== apiKey.keyId
    || opaque?.slice(-4) !== apiKey.hint
    || apiKey.status !== 'active'
    || apiKey.revokedAt !== null
    || apiKey.lastUsedAt !== null) throw invalid();
  return Object.freeze({ apiKey, secret: result.secret });
}

export function parseAuthApiKeySummary(value: unknown): AuthApiKeySummary {
  const result = exact(value, [
    'keyId', 'userId', 'label', 'hint', 'scopeKind', 'scopeId', 'tenantId',
    'membershipId', 'createdByUserId', 'createdVia', 'createdAt', 'expiresAt',
    'lastUsedAt', 'revokedAt', 'status',
  ]);
  const keyId = uuid(result.keyId);
  const userId = subjectId(result.userId);
  const label = text(result.label, 100);
  const hint = text(result.hint, 4);
  if (!HINT.test(hint)) throw invalid();
  if (result.scopeKind !== 'application' && result.scopeKind !== 'tenant') throw invalid();
  const scopeId = subjectId(result.scopeId);
  const tenantId = nullableSubjectId(result.tenantId);
  const membershipId = nullableSubjectId(result.membershipId);
  if (result.scopeKind === 'application') {
    if (scopeId !== 'application' || tenantId !== null || membershipId !== null) throw invalid();
  } else if (tenantId === null || membershipId === null || scopeId !== tenantId) {
    throw invalid();
  }
  if (result.createdVia !== 'self' && result.createdVia !== 'administrator') throw invalid();
  const createdAt = timestamp(result.createdAt);
  const expiresAt = timestamp(result.expiresAt);
  const lastUsedAt = nullableTimestamp(result.lastUsedAt);
  const revokedAt = nullableTimestamp(result.revokedAt);
  const status = result.status as AuthApiKeyStatus;
  if (expiresAt <= createdAt
    || (lastUsedAt !== null && lastUsedAt < createdAt)
    || (revokedAt !== null && revokedAt < createdAt)
    || !STATUSES.has(status)
    || ((status === 'revoked') !== (revokedAt !== null))) throw invalid();
  return Object.freeze({
    keyId,
    userId,
    label,
    hint,
    scopeKind: result.scopeKind,
    scopeId,
    tenantId,
    membershipId,
    createdByUserId: nullableSubjectId(result.createdByUserId),
    createdVia: result.createdVia,
    createdAt,
    expiresAt,
    lastUsedAt,
    revokedAt,
    status,
  });
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length
    || keys.some((key) => !Object.hasOwn(result, key))) throw invalid();
  return result;
}

function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!UUID_V4.test(result)) throw invalid();
  return result;
}

function subjectId(value: unknown): string {
  const result = text(value, 200);
  if (!SUBJECT_ID.test(result)) throw invalid();
  return result;
}

function nullableSubjectId(value: unknown): string | null {
  return value === null ? null : subjectId(value);
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) throw invalid();
  return value;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw invalid();
  }
  return value as number;
}

function timestamp(value: unknown): number {
  if (!isAuthApiKeyTimestamp(value)) throw invalid();
  return value;
}

function nullableTimestamp(value: unknown): number | null {
  return value === null ? null : timestamp(value);
}

function invalid(): Error {
  return new Error('[client] Zero returned an invalid Guardian API-key response.');
}

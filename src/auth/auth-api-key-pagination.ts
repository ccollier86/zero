/** Bounded, opaque pagination for API-key management directories. */

import type { AuthApiKeyListQuery, AuthApiKeyRecord } from './auth-api-key-types';
import type { AuthApiKeyStoreCursor } from './auth-api-key-store';
import { apiKeyValidation } from './auth-api-key-errors';

export const AUTH_API_KEY_DEFAULT_PAGE_SIZE = 25;
export const AUTH_API_KEY_MAX_PAGE_SIZE = 100;

export function normalizeAuthApiKeyPage(query: AuthApiKeyListQuery): {
  readonly limit: number;
  readonly cursor: AuthApiKeyStoreCursor | null;
} {
  const limit = query.limit ?? AUTH_API_KEY_DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUTH_API_KEY_MAX_PAGE_SIZE) {
    throw apiKeyValidation(
      `API key page limit must be between 1 and ${AUTH_API_KEY_MAX_PAGE_SIZE}`,
    );
  }
  return Object.freeze({ limit, cursor: decodeCursor(query.cursor) });
}

export function pageCursor(record: AuthApiKeyRecord | undefined): string | null {
  if (!record) return null;
  return Buffer.from(JSON.stringify({
    createdAt: record.createdAt,
    keyId: record.keyId,
  }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined): AuthApiKeyStoreCursor | null {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) {
    throw apiKeyValidation('Invalid API key page cursor');
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as {
      createdAt?: unknown;
      keyId?: unknown;
    };
    if (!Number.isSafeInteger(parsed.createdAt)
      || Number(parsed.createdAt) < 0
      || typeof parsed.keyId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        parsed.keyId,
      )) {
      throw new Error('invalid');
    }
    return Object.freeze({
      createdAt: Number(parsed.createdAt),
      keyId: parsed.keyId,
    });
  } catch {
    throw apiKeyValidation('Invalid API key page cursor');
  }
}

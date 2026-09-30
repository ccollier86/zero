import { describe, expect, test } from 'bun:test';
import { AUTH_API_KEY_MAX_TIMESTAMP_MS } from '../../auth/auth-api-key-time';
import {
  parseAuthApiKeyPage,
  parseAuthApiKeySummary,
  parseIssuedAuthApiKey,
} from './auth-api-key-parser';
import { AuthApiKeyTransport } from './auth-api-key-transport';

const KEY_ID = '123e4567-e89b-42d3-a456-426614174000';
const SECRET = `zero_ak_v1.${KEY_ID}.${'a'.repeat(43)}`;

describe('Guardian API-key transport', () => {
  test('maps every scope to its session-only management route', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const transport = createTransport(async (url, init) => {
      calls.push({ url, init });
      if (init?.method === 'DELETE') return Response.json(summary());
      if (init?.method === 'POST') return Response.json(issued());
      return Response.json(page());
    });
    const query = { limit: 25, cursor: 'cursor/value' };
    const input = { label: 'Automation', ttl: '12h' };

    await transport.self.list(query);
    await transport.self.issue(input);
    await transport.self.rotate('key/self', input);
    await transport.self.revoke('key/self');
    await transport.applicationAdmin.listUser('user/one', query);
    await transport.applicationAdmin.issueUser('user/one', input);
    await transport.applicationAdmin.rotate('key/admin', input);
    await transport.applicationAdmin.revoke('key/admin');
    await transport.tenantAdmin.listMember('member/one', query);
    await transport.tenantAdmin.issueMember('member/one', input);
    await transport.tenantAdmin.rotate('key/tenant', input);
    await transport.tenantAdmin.revoke('key/tenant');
    await transport.platformAdmin.list({ ...query, tenantId: 'tenant/one' });
    await transport.platformAdmin.listMember('tenant/one', 'member/one', query);
    await transport.platformAdmin.issueMember('tenant/one', 'member/one', input);
    await transport.platformAdmin.rotate('key/platform', input);
    await transport.platformAdmin.revoke('key/platform');

    expect(calls.map(({ url, init }) => [
      url.replace('https://zero.test', ''), init?.method ?? 'GET',
    ])).toEqual([
      ['/auth/api-keys?limit=25&cursor=cursor%2Fvalue', 'GET'],
      ['/auth/api-keys', 'POST'],
      ['/auth/api-keys/key%2Fself/rotate', 'POST'],
      ['/auth/api-keys/key%2Fself', 'DELETE'],
      ['/auth/admin/users/user%2Fone/api-keys?limit=25&cursor=cursor%2Fvalue', 'GET'],
      ['/auth/admin/users/user%2Fone/api-keys', 'POST'],
      ['/auth/admin/api-keys/key%2Fadmin/rotate', 'POST'],
      ['/auth/admin/api-keys/key%2Fadmin', 'DELETE'],
      ['/auth/tenant/members/member%2Fone/api-keys?limit=25&cursor=cursor%2Fvalue', 'GET'],
      ['/auth/tenant/members/member%2Fone/api-keys', 'POST'],
      ['/auth/tenant/api-keys/key%2Ftenant/rotate', 'POST'],
      ['/auth/tenant/api-keys/key%2Ftenant', 'DELETE'],
      ['/auth/platform/api-keys?limit=25&cursor=cursor%2Fvalue&tenantId=tenant%2Fone', 'GET'],
      ['/auth/platform/tenants/tenant%2Fone/members/member%2Fone/api-keys?limit=25&cursor=cursor%2Fvalue', 'GET'],
      ['/auth/platform/tenants/tenant%2Fone/members/member%2Fone/api-keys', 'POST'],
      ['/auth/platform/api-keys/key%2Fplatform/rotate', 'POST'],
      ['/auth/platform/api-keys/key%2Fplatform', 'DELETE'],
    ]);
    expect(calls.every(({ init }) => init?.cache === 'no-store')).toBe(true);
    const writes = calls.filter(({ init }) => init?.method === 'POST');
    expect(writes.every(({ init }) => (
      new Headers(init?.headers).get('content-type') === 'application/json'
    ))).toBe(true);
    expect(JSON.parse(String(writes[0]!.init!.body))).toEqual(input);
  });

  test('normalizes server failures without parsing an error as a key', async () => {
    const normalized = new Error('normalized API-key failure');
    const transport = new AuthApiKeyTransport({
      baseUrl: 'https://zero.test',
      authenticatedFetch: async () => Response.json(
        { code: 'FORBIDDEN', error: 'Forbidden' },
        { status: 403 },
      ),
      createResponseError: (_response, body, fallback) => {
        expect(body).toEqual({ code: 'FORBIDDEN', error: 'Forbidden' });
        expect(fallback).toBe('Failed to load API keys');
        return normalized;
      },
      assertResponseCurrent: () => { throw new Error('must not assert failed response'); },
    });
    await expect(transport.self.list()).rejects.toBe(normalized);
  });
});

describe('Guardian API-key response parser', () => {
  test('freezes canonical pages, one-time issues, and revocation summaries', () => {
    const parsedPage = parseAuthApiKeyPage(page());
    const parsedIssue = parseIssuedAuthApiKey(issued());
    const parsedSummary = parseAuthApiKeySummary(summary());
    expect(parsedPage.apiKeys[0]?.keyId).toBe(KEY_ID);
    expect(parsedIssue.secret).toBe(SECRET);
    expect(parsedSummary.status).toBe('active');
    expect(Object.isFrozen(parsedPage)).toBe(true);
    expect(Object.isFrozen(parsedPage.apiKeys)).toBe(true);
    expect(Object.isFrozen(parsedPage.capabilities)).toBe(true);
    expect(Object.isFrozen(parsedIssue)).toBe(true);
    expect(parseAuthApiKeySummary({
      ...summary(),
      expiresAt: AUTH_API_KEY_MAX_TIMESTAMP_MS,
    }).expiresAt).toBe(AUTH_API_KEY_MAX_TIMESTAMP_MS);
  });

  test('rejects private fields, mismatched secrets, malformed scope, and page drift', () => {
    expectInvalid(() => parseAuthApiKeySummary({ ...summary(), secretHash: 'x'.repeat(64) }));
    expectInvalid(() => parseIssuedAuthApiKey({ ...issued(), secret: `${SECRET}x` }));
    expectInvalid(() => parseIssuedAuthApiKey({
      ...issued(),
      secret: `zero_ak_v1.223e4567-e89b-42d3-a456-426614174000.${'a'.repeat(43)}`,
    }));
    expectInvalid(() => parseAuthApiKeySummary({
      ...summary(), scopeKind: 'tenant', scopeId: 'tenant-1',
    }));
    expectInvalid(() => parseAuthApiKeySummary({
      ...summary(), expiresAt: AUTH_API_KEY_MAX_TIMESTAMP_MS + 1,
    }));
    expectInvalid(() => parseAuthApiKeyPage({
      ...page(), page: { ...page().page, count: 0 },
    }));
    expectInvalid(() => parseAuthApiKeyPage({
      ...page(), page: { ...page().page, hasMore: true, nextCursor: null },
    }));
    expectInvalid(() => parseAuthApiKeyPage({
      ...page(), capabilities: { ...page().capabilities, canIssue: 'yes' },
    }));
  });

  test('rejects contradictory revocation lifecycle fields', () => {
    expectInvalid(() => parseAuthApiKeySummary({
      ...summary(), status: 'active', revokedAt: 2,
    }));
    expectInvalid(() => parseAuthApiKeySummary({
      ...summary(), status: 'revoked', revokedAt: null,
    }));
  });
});

function createTransport(
  authenticatedFetch: (url: string, init?: RequestInit) => Promise<Response>,
) {
  return new AuthApiKeyTransport({
    baseUrl: 'https://zero.test',
    authenticatedFetch,
    createResponseError: (_response, _body, fallback) => new Error(fallback),
    assertResponseCurrent: () => {},
  });
}

function summary() {
  return {
    keyId: KEY_ID,
    userId: 'user-1',
    label: 'Automation',
    hint: 'aaaa',
    scopeKind: 'application',
    scopeId: 'application',
    tenantId: null,
    membershipId: null,
    createdByUserId: 'user-1',
    createdVia: 'self',
    createdAt: 1,
    expiresAt: 10_000,
    lastUsedAt: null,
    revokedAt: null,
    status: 'active',
  };
}

function page() {
  return {
    apiKeys: [summary()],
    capabilities: { canIssue: true, canRotate: true, canRevoke: true },
    page: { limit: 25, count: 1, hasMore: false, nextCursor: null },
  };
}

function issued() {
  return { apiKey: summary(), secret: SECRET };
}

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrow('invalid Guardian API-key response');
}

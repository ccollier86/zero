import { describe, expect, test } from 'bun:test';
import { readAuthBearerToken } from './auth-bearer-token';
import { extractAuthContext } from './auth-context';
import { AUTH_REQUEST_LIMITS } from './auth-request-limits';
import type { TokenService } from './token-service';

describe('bounded auth Bearer extraction', () => {
  test('accepts the exact token boundary and rejects empty or oversized credentials', () => {
    expect(readAuthBearerToken(request('t'.repeat(AUTH_REQUEST_LIMITS.token))))
      .toHaveLength(AUTH_REQUEST_LIMITS.token);
    expect(readAuthBearerToken(request(''))).toBeNull();
    expect(readAuthBearerToken(request('t'.repeat(AUTH_REQUEST_LIMITS.token + 1))))
      .toBeNull();
  });

  test('accepts case-insensitive schemes and repeated RFC spaces', () => {
    expect(readAuthBearerToken(headerRequest('bearer   token-value')))
      .toBe('token-value');
    expect(readAuthBearerToken(headerRequest('Bearer token value'))).toBeNull();
  });

  test('does not invoke JWT verification for an oversized Bearer credential', async () => {
    let calls = 0;
    const tokens = {
      resolveAuthContext: async () => {
        calls += 1;
        return null;
      },
    } as unknown as TokenService;
    const auth = await extractAuthContext(
      request('t'.repeat(AUTH_REQUEST_LIMITS.token + 1)),
      tokens
    );
    expect(auth).toBeNull();
    expect(calls).toBe(0);
  });
});

function request(token: string): Request {
  return headerRequest(`Bearer ${token}`);
}

function headerRequest(authorization: string): Request {
  return new Request('https://app.test/auth/me', {
    headers: { Authorization: authorization },
  });
}

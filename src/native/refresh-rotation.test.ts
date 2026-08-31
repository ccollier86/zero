import { describe, expect, test } from 'bun:test';
import { NativeAuthError } from './errors';
import type { NativeOidcMetadata } from './oidc-types';
import { refreshNativeTokens } from './token-endpoint';

describe('native refresh rotation', () => {
  test('never reuses a consumed refresh token when replacement is omitted', async () => {
    const metadata = {
      issuer: 'https://zero.example/auth',
      token_endpoint: 'https://zero.example/auth/token',
    } as NativeOidcMetadata;

    try {
      await refreshNativeTokens({
        metadata,
        clientId: 'desktop-app',
        async fetch() {
          return Response.json({
            access_token: 'new-access',
            token_type: 'Bearer',
            expires_in: 300,
          });
        },
      }, 'consumed-refresh');
      throw new Error('expected missing rotation rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(NativeAuthError);
      expect((error as NativeAuthError).code).toBe('OIDC_REFRESH_ROTATION_MISSING');
    }
  });
});

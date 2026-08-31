import { describe, expect, test } from 'bun:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createWebCryptoAdapter, encodeBase64Url, utf8 } from './crypto';
import { NativeAuthError } from './errors';
import { NativeIdTokenValidator } from './id-token';
import type { NativeOidcMetadata } from './oidc-types';

const issuer = 'https://zero.example';
const clientId = 'native-client';
const accessToken = 'opaque-access-token';

describe('native ID token validation', () => {
  test('validates ES256, issuer, audience, nonce, and at_hash through JWKS', async () => {
    const fixture = await createFixture();
    const token = await fixture.sign({ nonce: 'expected', at_hash: await accessHash(accessToken) });
    const claims = await fixture.validator.validate({
      token, accessToken, expectedNonce: 'expected',
    });
    expect(claims.sub).toBe('user-1');
    expect(claims.email).toBe('person@example.com');
  });

  test.each([
    ['nonce substitution', 'OIDC_NONCE_MISMATCH', { nonce: 'wrong' }],
    ['access token substitution', 'OIDC_AT_HASH_MISMATCH', { at_hash: 'wrong' }],
    ['missing azp for multiple audiences', 'OIDC_ID_TOKEN_INVALID', { aud: [clientId, 'other'] }],
    ['wrong azp', 'OIDC_ID_TOKEN_INVALID', { azp: 'other' }],
  ])('rejects %s', async (_name, code, claims) => {
    const fixture = await createFixture();
    const token = await fixture.sign({ nonce: 'expected', ...claims });
    await expectError(
      fixture.validator.validate({ token, accessToken, expectedNonce: 'expected' }),
      code,
    );
  });

  test('rejects a changed subject during refresh validation', async () => {
    const fixture = await createFixture();
    const token = await fixture.sign({ nonce: undefined, sub: 'attacker' });
    await expectError(
      fixture.validator.validate({ token, accessToken, expectedSubject: 'user-1' }),
      'OIDC_SUBJECT_MISMATCH',
    );
  });
});

async function createFixture() {
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'key-1', alg: 'ES256', use: 'sig' };
  const metadata: NativeOidcMetadata = {
    issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`, code_challenge_methods_supported: ['S256'],
    response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['openid'],
    id_token_signing_alg_values_supported: ['ES256'], token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
  const crypto = createWebCryptoAdapter();
  const validator = new NativeIdTokenValidator(
    metadata, clientId, async () => Response.json({ keys: [jwk] }), crypto, 0, Date.now,
  );
  return {
    validator,
    async sign(overrides: Record<string, unknown>) {
      const payload: Record<string, unknown> = {
        nonce: 'expected', email: 'person@example.com', ...overrides,
      };
      const sub = typeof payload.sub === 'string' ? payload.sub : 'user-1';
      const aud = payload.aud ?? clientId;
      delete payload.sub;
      delete payload.aud;
      return new SignJWT(payload).setProtectedHeader({ alg: 'ES256', kid: 'key-1' })
        .setIssuer(issuer).setAudience(aud as string | string[]).setSubject(sub)
        .setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
    },
  };
}

async function accessHash(token: string): Promise<string> {
  const digest = await createWebCryptoAdapter().sha256(utf8(token));
  return encodeBase64Url(digest.slice(0, digest.length / 2));
}

async function expectError(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('expected ID-token rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(NativeAuthError);
    expect((error as NativeAuthError).code).toBe(code);
  }
}

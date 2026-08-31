/** Minimal signing helpers for the native SDK's in-process OIDC test provider. */

import { SignJWT } from 'jose';

export const testIssuer = 'https://zero.example/auth';
export const testServerUrl = 'https://zero.example';
export const testClientId = 'desktop-test';

export function testMetadata() {
  return {
    issuer: testIssuer,
    authorization_endpoint: `${testIssuer}/authorize`,
    token_endpoint: `${testIssuer}/token`,
    jwks_uri: `${testIssuer}/jwks`,
    revocation_endpoint: `${testIssuer}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    scopes_supported: ['openid', 'profile', 'email'],
    code_challenge_methods_supported: ['S256'],
    id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
}

export function testTokenResponse(
  access_token: string,
  refresh_token: string,
  id_token?: string,
) {
  return { access_token, refresh_token, id_token, expires_in: 3600, token_type: 'Bearer' };
}

export async function signTestIdToken(
  key: CryptoKey,
  nonce?: string,
  subject = 'user-1',
): Promise<string> {
  return new SignJWT({
    ...(nonce === undefined ? {} : { nonce }),
    email: 'person@example.com', email_verified: true,
  })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuer(testIssuer)
    .setAudience(testClientId)
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(key);
}

export function testJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

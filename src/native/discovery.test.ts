import { describe, expect, test } from 'bun:test';
import { discoverNativeOidc } from './discovery';
import { NativeAuthError } from './errors';

const issuer = 'https://zero.example';

describe('native OpenID discovery', () => {
  test('accepts a complete issuer-bound public-client configuration', async () => {
    const result = await discoverNativeOidc(issuer, async () => Response.json(metadata()));
    expect(result.issuer).toBe(issuer);
    expect(result.token_endpoint_auth_methods_supported).toContain('none');
  });

  test.each([
    ['issuer substitution', 'OIDC_ISSUER_MISMATCH', { issuer: 'https://attacker.example' }],
    ['missing PKCE', 'OIDC_PKCE_UNSUPPORTED', { code_challenge_methods_supported: [] }],
    ['missing public client support', 'OIDC_PUBLIC_CLIENT_UNSUPPORTED', {
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    }],
    ['missing response issuer', 'OIDC_RESPONSE_ISS_UNSUPPORTED', {
      authorization_response_iss_parameter_supported: false,
    }],
    ['missing refresh grant', 'OIDC_GRANT_UNSUPPORTED', {
      grant_types_supported: ['authorization_code'],
    }],
    ['unsafe token endpoint', 'OIDC_DISCOVERY_INVALID', {
      token_endpoint: 'http://attacker.example/token',
    }],
    ['cross-origin authorization endpoint', 'OIDC_DISCOVERY_INVALID', {
      authorization_endpoint: 'https://identity.example/authorize',
    }],
    ['cross-origin JWKS endpoint', 'OIDC_DISCOVERY_INVALID', {
      jwks_uri: 'https://identity.example/jwks',
    }],
    ['cross-origin optional endpoints', 'OIDC_DISCOVERY_INVALID', {
      revocation_endpoint: 'https://identity.example/revoke',
    }],
  ])('rejects %s', async (_name, code, override) => {
    await expectCode(
      discoverNativeOidc(issuer, async () => Response.json({ ...metadata(), ...override })),
      code,
    );
  });
});

function metadata() {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`, response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: ['openid'],
    code_challenge_methods_supported: ['S256'], id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('expected discovery rejection');
  } catch (error) {
    expect(error).toBeInstanceOf(NativeAuthError);
    expect((error as NativeAuthError).code).toBe(code);
  }
}

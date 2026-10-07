/** OpenID Connect discovery metadata for Zero native clients. */

export function buildNativeDiscovery(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['openid', 'profile', 'email', 'phone', 'profile:write', 'contacts:write'],
    claims_supported: [
      'sub', 'iss', 'aud', 'exp', 'iat', 'nonce', 'name',
      'given_name', 'family_name', 'preferred_username', 'email', 'email_verified',
    ],
    prompt_values_supported: ['none', 'create'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    zero_tenant_sessions: {
      version: 1,
      list_endpoint: `${issuer}/oauth/tenants`,
      switch_endpoint: `${issuer}/oauth/tenants/switch`,
      proof: 'refresh_token',
    },
  };
}

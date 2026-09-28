/** Public and persisted OIDC contracts used by the native auth SDK. */

export interface NativeOidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  revocation_endpoint?: string;
  response_types_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  id_token_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  authorization_response_iss_parameter_supported?: boolean;
  zero_tenant_sessions?: {
    version: 1;
    list_endpoint: string;
    switch_endpoint: string;
    proof: 'refresh_token';
  };
}

export interface NativeIdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  azp?: string;
  nonce?: string;
  auth_time?: number;
  email?: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
}

export interface NativeTokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  expiresIn: number;
  scope?: string;
  activeTenant?: import('./client-types').NativeTenantSummary | null;
}

export interface NativeStoredSession {
  issuer: string;
  clientId: string;
  subject: string;
  refreshToken: string;
  identity: NativeIdTokenClaims;
  activeTenant?: import('./client-types').NativeTenantSummary | null;
}

export interface NativePendingAuthorization {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
}

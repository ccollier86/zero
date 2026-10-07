import type {
  NativeAuthorizationRequestPolicyConfig,
  NativeRefreshRotationPolicyConfig,
  ResolvedNativeAuthorizationRequestPolicy,
  ResolvedNativeRefreshRotationPolicy,
} from './policy-types';

/** Native applications are public OAuth clients and never receive a secret. */
export interface NativeAuthClientConfig {
  clientId: string;
  name: string;
  redirectUris: readonly string[];
  scopes?: readonly NativeIdentityScope[];
}

export interface NativeAuthConfig {
  enabled?: boolean;
  issuer?: string;
  requestTTL?: string;
  codeTTL?: string;
  refreshTokenTTL?: string;
  requestAdmission?: NativeAuthorizationRequestPolicyConfig;
  refreshRotation?: NativeRefreshRotationPolicyConfig;
  clients?: readonly NativeAuthClientConfig[];
}

export interface ResolvedNativeAuthClientConfig {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: NativeIdentityScope[];
}

export interface ResolvedNativeAuthConfig {
  enabled: boolean;
  issuer?: string;
  requestTTL: string;
  codeTTL: string;
  refreshTokenTTL: string;
  requestAdmission: ResolvedNativeAuthorizationRequestPolicy;
  refreshRotation: ResolvedNativeRefreshRotationPolicy;
  clients: ResolvedNativeAuthClientConfig[];
}

export type NativeIdentityScope = 'openid' | 'profile' | 'email' | 'phone' | 'profile:write' | 'contacts:write';

export type NativeRedirectKind =
  | 'loopback'
  | 'claimed-https'
  | 'private-use';

export interface NativeAuthorizationRequest {
  responseType: 'code';
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
  nonce: string;
  scopes: NativeIdentityScope[];
}

export type NativeAuthorizationErrorCode =
  | 'invalid_request'
  | 'unauthorized_client'
  | 'access_denied'
  | 'interaction_required'
  | 'unsupported_response_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'server_error'
  | 'temporarily_unavailable';

export interface NativeAuthorizationErrorPayload {
  error: NativeAuthorizationErrorCode;
  errorDescription?: string;
  errorUri?: string;
  state?: string;
  issuer?: string;
}

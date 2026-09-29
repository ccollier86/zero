/** Public client configuration, state, and action contracts. */

import type {
  NativeCallbackAdapter,
  NativeCryptoAdapter,
  NativeFetch,
  NativeSecureVault,
  NativeSystemBrowser,
} from './adapter-types';
import type { NativeIdTokenClaims } from './oidc-types';

export type NativeAuthStatus =
  | 'uninitialized'
  | 'anonymous'
  | 'authorizing'
  | 'authenticated'
  | 'error';

export interface NativeAuthState {
  status: NativeAuthStatus;
  identity: NativeIdTokenClaims | null;
  /** Sanitized server projection; credentials and internal generations are never exposed. */
  activeTenant?: NativeTenantSummary | null;
  error: NativeAuthErrorInfo | null;
}

export interface NativeTenantSummary {
  tenantId: string;
  /** Protected control-plane scope or ordinary customer data scope. */
  kind: 'administration' | 'organization';
  slug: string;
  name: string;
  role: string | null;
}

export interface NativeTenantListResult {
  activeTenantId: string | null;
  tenants: NativeTenantSummary[];
}

export interface NativeAuthErrorInfo {
  code: string;
  message: string;
  status?: number;
}

/** Identity claims Zero can release to a native public client. */
export type NativeIdentityScope = 'openid' | 'profile' | 'email';

export interface NativeAuthClientOptions {
  issuer: string;
  clientId: string;
  redirectUri?: string;
  vault: NativeSecureVault;
  browser: NativeSystemBrowser;
  callbacks: NativeCallbackAdapter;
  fetch?: NativeFetch;
  crypto?: NativeCryptoAdapter;
  scopes?: NativeIdentityScope[];
  storageNamespace?: string;
  authorizationTimeoutMs?: number;
  networkTimeoutMs?: number;
  clockSkewSeconds?: number;
  now?: () => number;
}

export interface NativeSignInOptions {
  loginHint?: string;
  signal?: AbortSignal;
}

export interface NativeSignUpOptions {
  loginHint?: string;
  signal?: AbortSignal;
}

export type NativeAuthStateListener = (state: NativeAuthState) => void;

/** Public native client. Refresh tokens are intentionally never exposed. */
export interface NativeAuthClient {
  readonly state: NativeAuthState;
  initialize(): Promise<NativeAuthState>;
  signIn(options?: NativeSignInOptions): Promise<NativeAuthState>;
  signUp(options?: NativeSignUpOptions): Promise<NativeAuthState>;
  completeAuthorization(callbackUrl: string, signal?: AbortSignal): Promise<NativeAuthState>;
  refresh(): Promise<NativeAuthState>;
  listTenants(): Promise<NativeTenantListResult>;
  switchTenant(tenantId: string): Promise<NativeAuthState>;
  getUser(): NativeIdTokenClaims | null;
  getAccessToken(): Promise<string | null>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  signOut(): Promise<void>;
  subscribe(listener: NativeAuthStateListener): () => void;
}

/** OIDC authorization request construction for public native clients. */

import type { NativeSignInOptions, NativeSignUpOptions } from './client-types';
import type { NativeOidcMetadata, NativePendingAuthorization } from './oidc-types';

interface AuthorizationUrlInput {
  metadata: NativeOidcMetadata;
  clientId: string;
  scopes: string[];
  pending: NativePendingAuthorization;
  codeChallenge: string;
  action: 'signIn' | 'signUp';
  options?: NativeSignInOptions | NativeSignUpOptions;
}

/** Build a standards-only Authorization Code + PKCE request. */
export function createAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.metadata.authorization_endpoint);
  const params = url.searchParams;
  params.set('client_id', input.clientId);
  params.set('redirect_uri', input.pending.redirectUri);
  params.set('response_type', 'code');
  params.set('scope', input.scopes.join(' '));
  params.set('state', input.pending.state);
  params.set('nonce', input.pending.nonce);
  params.set('code_challenge', input.codeChallenge);
  params.set('code_challenge_method', 'S256');

  const options = input.options;
  if (input.action === 'signUp') params.set('prompt', 'create');
  if (options?.loginHint?.trim()) params.set('login_hint', options.loginHint.trim());
  return url.toString();
}

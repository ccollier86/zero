/** Persistence and replay helpers for native authorization callbacks. */

import type { NativeAuthorizationContext } from './authorization-context';
import { NativeAuthError } from './errors';
import type { NativePendingAuthorization } from './oidc-types';

export async function requirePendingAuthorization(
  input: NativeAuthorizationContext,
): Promise<NativePendingAuthorization> {
  const pending = await input.vault.loadPending();
  if (!pending) {
    throw new NativeAuthError('No authorization is pending.', 'OIDC_PENDING_MISSING');
  }
  const age = input.config.now() - pending.createdAt;
  if (pending.issuer !== input.config.issuer
    || pending.clientId !== input.config.clientId
    || age < -input.config.clockSkewSeconds * 1000
    || age > input.config.authorizationTimeoutMs) {
    await input.vault.clearPending();
    throw new NativeAuthError('Pending authorization expired.', 'OIDC_PENDING_INVALID');
  }
  return pending;
}

export function nativeCallbackKey(value: string): string {
  try {
    const url = new URL(value);
    url.searchParams.sort();
    return url.href;
  } catch {
    return value;
  }
}

export function shouldDiscardPendingAuthorization(error: unknown): boolean {
  return !(error instanceof NativeAuthError
    && [
      'OIDC_STATE_MISMATCH',
      'OIDC_RESPONSE_ISS_MISMATCH',
      'OIDC_REDIRECT_MISMATCH',
      'OIDC_CALLBACK_INVALID',
    ].includes(error.code));
}

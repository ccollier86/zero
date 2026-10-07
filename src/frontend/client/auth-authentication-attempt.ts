/** Internal lifecycle fence for one unauthenticated authentication exchange. */
import type { AuthCredentialIssuanceLease } from './auth-session';

export interface AuthAuthenticationAttempt {
  /** Aborted when the browser adopts another account or tenant scope. */
  readonly signal: AbortSignal;
  /** Throws before a stale response can publish or replace the live session. */
  assertCurrent(): void;
  /** Release lifecycle listeners after the exchange settles. */
  dispose(): void;
  /** @internal Shared browser cookie-write ownership, supplied by AuthClient. */
  runCredentialIssuance?<T>(operation: (ownedAttempt: AuthAuthenticationAttempt) => Promise<T>, signal?: AbortSignal): Promise<T>;
  /** @internal Active completion capability; survives scoped attempt composition. */
  readonly credentialIssuance?: AuthCredentialIssuanceLease;
}

/** Serialize SDK exchanges while preserving standalone transport adapters. */
export async function runAuthenticationExchange<T>(
  attempt: AuthAuthenticationAttempt,
  operation: (ownedAttempt: AuthAuthenticationAttempt) => Promise<T>,
  onUnsettledFailure?: (cause: unknown) => never,
  signal?: AbortSignal,
): Promise<T> {
  let settled = false;
  const exchange = async (owned: AuthAuthenticationAttempt) => {
    try { return await operation(owned); } finally { settled = true; }
  };
  try {
    signal?.throwIfAborted();
    return await (attempt.runCredentialIssuance ? attempt.runCredentialIssuance(exchange, signal) : exchange(attempt));
  } catch (cause) {
    // Admission and ignored-signal body stalls can reject outside the original
    // transport catch. Settle its form only if that transport has not done so.
    if (!settled && onUnsettledFailure) return onUnsettledFailure(cause);
    throw cause;
  } finally { attempt.dispose(); }
}

/**
 * Settle one failed authentication exchange only while its originating
 * authorization scope is still current. The assertion intentionally happens
 * before the store write so a late network failure cannot replace the error
 * or loading state of a newer account/tenant scope.
 */
export function failCurrentAuthenticationAttempt(
  attempt: AuthAuthenticationAttempt,
  fail: (message: string, attempt: AuthAuthenticationAttempt) => void,
  cause: unknown,
  message: string,
): never {
  attempt.assertCurrent();
  fail(message, attempt);
  throw cause;
}

/**
 * Settle a failure that happened after a response was parsed and handed to
 * the session controller. A successful scope commit intentionally makes the
 * originating attempt stale, even when a host lifecycle does not implement
 * the optional cancellation callback. Preserve the controller's useful
 * synchronization error in that case instead of replacing it with a generic
 * stale-response error.
 */
export function failCurrentAuthenticationCompletion(
  attempt: AuthAuthenticationAttempt,
  fail: (message: string, attempt: AuthAuthenticationAttempt) => void,
  cause: unknown,
  message: string,
): never {
  try {
    attempt.assertCurrent();
  } catch {
    throw cause;
  }
  fail(message, attempt);
  throw cause;
}

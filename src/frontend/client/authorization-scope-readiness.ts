/** Pure readiness policy for browser authorization-scope data boundaries. */

import type { AuthAuthorizationStatus } from './auth-authorization-types';
import type { AuthSessionTransitionState } from './auth-types';

/** A committed or recoverable scope may safely back UI reads. */
export function isAuthorizationScopeStable(
  transition: AuthSessionTransitionState,
): boolean {
  return transition.phase === 'idle' || transition.phase === 'recovery-required';
}

/** True when cached application state may be rendered for the current scope. */
export function isAuthorizationScopeReady(
  transition: AuthSessionTransitionState,
  isRestoring: boolean,
): boolean {
  // Ordinary login/MFA form submission uses isLoading but does not make the
  // current scope unsafe. Initial credential restoration and explicit scope
  // transitions do, and remain masked by this boundary.
  return isAuthorizationScopeStable(transition) && !isRestoring;
}

/**
 * Decide whether the current scope has a safe authorization-data projection.
 *
 * A server-declared read-authority purge is unreadable until a replacement
 * authorization projection has been validated for the same browser session.
 * A settled signed-out scope has no authorization projection to replace, so
 * its public login/bootstrap UI remains readable after the purge. Revision zero
 * preserves initial hydration while that optional UI hint loads.
 */
export function isAuthorizationDataReady(
  revision: number,
  status: AuthAuthorizationStatus | null,
  isAuthenticated: boolean,
): boolean {
  if (!isAuthenticated) {
    // `loading` keeps public auth forms mounted during an ordinary login or
    // registration submission. `revoked` becomes readable only after the Auth
    // session has actually been cleared.
    return status === 'unauthenticated'
      || status === 'loading'
      || status === 'revoked';
  }

  // Refreshing retains a server projection matched to the exact identity and
  // scope. After a server-declared purge, no other authenticated state may
  // render until its replacement projection validates.
  if (status === 'ready' || status === 'refreshing') return true;

  // Before any purge, loading/error concern only the optional browser
  // authorization hint. Server loaders and Sync remain server-authorized,
  // while browser permission gates fail closed, so a transient hint error must
  // not strand the whole authenticated app behind a permanent transition.
  return revision === 0 && (status === 'loading' || status === 'error');
}

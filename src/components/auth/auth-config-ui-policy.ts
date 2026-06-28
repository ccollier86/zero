/**
 * auth-config-ui-policy.ts
 *
 * Defines frontend visibility decisions derived from public auth config. This
 * file owns UI policy helpers only; backend auth routes remain the source of
 * truth for registration, reset, and account lifecycle enforcement.
 */

import type { AuthConfigState } from '../../frontend/client/hooks';

/** Return true while a policy-aware form is waiting for `/auth/config`. */
export function isAuthConfigPending(
  respectPolicy: boolean,
  authConfig: Pick<AuthConfigState, 'config' | 'isLoading'>,
): boolean {
  return respectPolicy && authConfig.config === null && authConfig.isLoading;
}

/** Return true when policy-aware UI cannot load the config it needs. */
export function isAuthConfigUnavailable(
  respectPolicy: boolean,
  authConfig: Pick<AuthConfigState, 'config' | 'isLoading' | 'error'>,
): boolean {
  return (
    respectPolicy &&
    authConfig.config === null &&
    !authConfig.isLoading &&
    authConfig.error !== null
  );
}

/** Return true when registration is authoritatively closed by loaded config. */
export function isRegistrationClosed(
  respectRegistrationPolicy: boolean,
  authConfig: Pick<AuthConfigState, 'config' | 'canRegister'>,
): boolean {
  return respectRegistrationPolicy && authConfig.config !== null && !authConfig.canRegister;
}

/** Return true when password reset email is authoritatively unavailable. */
export function isPasswordResetUnavailable(
  respectEmailPolicy: boolean,
  authConfig: Pick<AuthConfigState, 'config'>,
): boolean {
  return (
    respectEmailPolicy &&
    authConfig.config !== null &&
    authConfig.config.accountEmails?.passwordReset === false
  );
}

/** Decide whether the login form should render its public registration link. */
export function canShowRegistrationLink(
  showRegisterLink: boolean,
  respectRegistrationPolicy: boolean,
  authConfig: Pick<AuthConfigState, 'config' | 'canRegister' | 'isLoading'>,
): boolean {
  if (!showRegisterLink) return false;
  if (!respectRegistrationPolicy) return true;
  if (isAuthConfigPending(true, authConfig)) return false;
  return authConfig.config !== null && authConfig.canRegister;
}

/** Decide whether the login form should render its forgot-password link. */
export function canShowForgotPasswordLink(
  showForgotPassword: boolean,
  respectEmailPolicy: boolean,
  authConfig: Pick<AuthConfigState, 'config' | 'isLoading'>,
): boolean {
  if (!showForgotPassword) return false;
  if (!respectEmailPolicy) return true;
  if (isAuthConfigPending(true, authConfig)) return false;
  return authConfig.config !== null && authConfig.config.accountEmails?.passwordReset !== false;
}

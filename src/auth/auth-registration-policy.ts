/** Registration admission and account-gate decisions. */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { assertBootstrapRequest } from './auth-bootstrap';
import type { AccountEmailService } from './account-email-service';
import { AuthError, type ResolvedAuthBehaviorConfig } from './types';
import type { AuthPlatformCodeEmitter } from './auth-observability';

export interface RegistrationPolicy {
  isBootstrap: boolean;
  role: 'admin' | 'user';
  requestedMfaSetup: boolean;
  requireEmailVerification: boolean;
  mfaRequired: boolean;
}

export function resolveRegistrationPolicy(params: {
  isBootstrap: boolean;
  accountEmail: AccountEmailService;
  authConfig: ResolvedAuthBehaviorConfig;
  mfaEnrollment?: boolean;
  bootstrapSecret?: string;
  emitCode?: AuthPlatformCodeEmitter;
}): RegistrationPolicy {
  const { isBootstrap, accountEmail, authConfig } = params;
  const emitCode = params.emitCode ?? emitPlatformCode;
  assertBootstrapRequest(authConfig, isBootstrap, params.bootstrapSecret, emitCode);
  if (!isBootstrap && authConfig.registration.mode !== 'public') {
    emitCode(OBS_CODES.AUTH_REGISTRATION_DISABLED, {
      metadata: { mode: authConfig.registration.mode },
    });
    throw new AuthError('Registration disabled', 'REGISTRATION_DISABLED', 403);
  }

  const role = isBootstrap ? 'admin' : 'user';
  const requireEmailVerification =
    authConfig.account.requireEmailVerification && !isBootstrap;
  if (requireEmailVerification) accountEmail.assertReady();

  return {
    isBootstrap,
    role,
    requestedMfaSetup: Boolean(params.mfaEnrollment) && authConfig.mfa.enabled,
    requireEmailVerification,
    mfaRequired: requiresMfa(role, authConfig),
  };
}

function requiresMfa(
  role: 'admin' | 'user',
  authConfig: ResolvedAuthBehaviorConfig
): boolean {
  if (!authConfig.mfa.enabled) return false;
  if (authConfig.mfa.policy === 'required') return true;
  return authConfig.mfa.policy === 'admin-required' && role === 'admin';
}

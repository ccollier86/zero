/** First-administrator bootstrap policy and public-safe capability mapping. */

import { createHash, timingSafeEqual } from 'node:crypto';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import {
  AuthError,
  type ResolvedAuthBehaviorConfig,
  type ResolvedAuthBootstrapConfig,
} from './types';
import type { AuthPlatformCodeEmitter } from './auth-observability';

/** Current bootstrap config, including a safe fallback for legacy test doubles. */
export function getBootstrapConfig(
  config: ResolvedAuthBehaviorConfig
): ResolvedAuthBootstrapConfig {
  return config.bootstrap ?? { mode: 'secret' };
}

/** Whether an operator has enabled the configured ceremony. */
export function isBootstrapAvailable(
  bootstrap: ResolvedAuthBootstrapConfig
): boolean {
  if (bootstrap.mode === 'public') return true;
  return bootstrap.mode === 'secret' && typeof bootstrap.secret === 'string';
}

/**
 * Authorize the one request that creates an installation's first admin.
 *
 * The comparison hashes both values to fixed-length buffers before the
 * constant-time comparison. No caller receives or logs the configured secret.
 */
export function assertBootstrapAuthorized(
  config: ResolvedAuthBehaviorConfig,
  presentedSecret: string | undefined,
  emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
): void {
  const bootstrap = getBootstrapConfig(config);
  if (bootstrap.mode === 'public') return;

  if (bootstrap.mode === 'disabled' || !bootstrap.secret) {
    emitBootstrapRejected(bootstrap.mode, 'unavailable', emitCode);
    throw new AuthError(
      'Administrator bootstrap is unavailable',
      'BOOTSTRAP_UNAVAILABLE',
      403
    );
  }

  if (!presentedSecret || !secretsEqual(bootstrap.secret, presentedSecret)) {
    emitBootstrapRejected(bootstrap.mode, 'authorization_failed', emitCode);
    throw new AuthError(
      'Administrator bootstrap authorization failed',
      'BOOTSTRAP_AUTHORIZATION_FAILED',
      403
    );
  }
}

/**
 * Validate bootstrap-only request input. Call once before password hashing for
 * cheap rejection and again under the registration transaction for authority.
 */
export function assertBootstrapRequest(
  config: ResolvedAuthBehaviorConfig,
  bootstrapRequired: boolean,
  presentedSecret: string | undefined,
  emitCode: AuthPlatformCodeEmitter = emitPlatformCode,
): void {
  if (bootstrapRequired) {
    assertBootstrapAuthorized(config, presentedSecret, emitCode);
    return;
  }
  if (presentedSecret !== undefined) {
    throw new AuthError(
      'Bootstrap authorization is only accepted for an empty installation',
      'BOOTSTRAP_NOT_REQUIRED',
      400
    );
  }
}

/** Public-safe bootstrap capability. Never includes the secret. */
export function buildBootstrapCapability(
  config: ResolvedAuthBehaviorConfig,
  bootstrapRequired: boolean
) {
  const bootstrap = getBootstrapConfig(config);
  const available = bootstrapRequired && isBootstrapAvailable(bootstrap);

  return {
    required: bootstrapRequired,
    mode: bootstrap.mode,
    available,
    secretRequired: bootstrapRequired && bootstrap.mode === 'secret',
  };
}

/** Public-safe ordinary-registration capabilities. */
export function buildRegistrationCapability(
  config: ResolvedAuthBehaviorConfig,
  bootstrapRequired: boolean
) {
  const bootstrap = getBootstrapConfig(config);
  const available = bootstrapRequired && isBootstrapAvailable(bootstrap);
  const registrationEnabled = bootstrapRequired
    ? available
    : config.registration.mode === 'public';
  const publicRegistrationEnabled = bootstrapRequired
    ? bootstrap.mode === 'public'
    : config.registration.mode === 'public';

  return {
    mode: config.registration.mode,
    bootstrapRequired,
    registrationEnabled,
    publicRegistrationEnabled,
  };
}

function secretsEqual(expected: string, presented: string): boolean {
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const presentedDigest = createHash('sha256').update(presented, 'utf8').digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

function emitBootstrapRejected(
  mode: ResolvedAuthBootstrapConfig['mode'],
  reason: 'unavailable' | 'authorization_failed',
  emitCode: AuthPlatformCodeEmitter,
): void {
  emitCode(OBS_CODES.AUTH_BOOTSTRAP_REJECTED, {
    metadata: { mode, reason },
  });
}

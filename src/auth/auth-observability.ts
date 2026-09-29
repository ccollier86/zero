/** App-local observability boundary shared by auth runtime/services. */

import {
  emitPlatformCode,
  emitPlatformCodeTo,
} from '../observability/sink';
import { OBS_CODES } from '../observability/codes';
import { ZERO_OBSERVABILITY_RUNTIME } from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import { AuthError } from './types';

export type AuthPlatformCodeEmitter = typeof emitPlatformCode;

/**
 * Bind auth emissions to the owning managed app.
 *
 * Standalone plugin composition deliberately retains the legacy process-wide
 * sink. Once a managed runtime is supplied, resolution stays app-local and
 * fails setup if its observability service is missing instead of leaking an
 * event into another app's global sink.
 */
export function createAuthPlatformCodeEmitter(
  runtime?: ZeroAppRuntime,
): AuthPlatformCodeEmitter {
  if (!runtime) return emitPlatformCode;
  const observability = runtime.require(ZERO_OBSERVABILITY_RUNTIME);
  return (definition, options) => emitPlatformCodeTo(
    observability,
    definition,
    options,
  );
}

/**
 * Create the canonical private-state failure used by auth persistence and
 * orchestration boundaries, and report only stable non-sensitive metadata to
 * the owning app when an emitter is available.
 */
export function createAuthStateInvariantError(
  emitCode: AuthPlatformCodeEmitter | undefined,
  input: {
    component: string;
    invariant: string;
    message: string;
  },
): AuthError {
  const error = new AuthError(
    input.message,
    'AUTH_STATE_INVARIANT_FAILED',
    500,
  );
  emitCode?.(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
    error,
    metadata: {
      component: input.component,
      invariant: input.invariant,
    },
  });
  return error;
}

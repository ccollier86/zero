/** Fail closed when a callback that participates in an auth transaction yields. */

import { OBS_CODES } from '../observability/codes';
import type { AuthPlatformCodeEmitter } from './auth-observability';
import { AuthError } from './types';

export interface AuthSynchronousCallbackFailure {
  component: string;
  invariant: string;
  message: string;
  emitCode?: AuthPlatformCodeEmitter;
  /** Reuse a caller's app-local invariant boundary when it already owns emission. */
  createError?: () => AuthError;
}

/**
 * Invoke one callback that must finish inside the current synchronous database
 * transaction. TypeScript permits an async function where `() => void` is
 * expected, so the runtime boundary must reject thenables as well. A rejected
 * continuation is consumed because the transaction has already failed closed.
 */
export function invokeSynchronousAuthCallback<T>(
  callback: () => T,
  failure: AuthSynchronousCallbackFailure,
): T {
  const result = callback();
  let promiseLike: boolean;
  try {
    promiseLike = isPromiseLike(result);
  } catch {
    throw createSynchronousBoundaryError(failure);
  }
  if (!promiseLike) return result;

  void Promise.resolve(result).catch(() => {});
  throw createSynchronousBoundaryError(failure);
}

function createSynchronousBoundaryError(
  failure: AuthSynchronousCallbackFailure,
): AuthError {
  const error = failure.createError?.() ?? new AuthError(
    failure.message,
    'AUTH_STATE_INVARIANT_FAILED',
    500,
  );
  if (!failure.createError) {
    failure.emitCode?.(OBS_CODES.AUTH_STATE_INVARIANT_FAILED, {
      error,
      metadata: {
        component: failure.component,
        invariant: failure.invariant,
      },
    });
  }
  return error;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

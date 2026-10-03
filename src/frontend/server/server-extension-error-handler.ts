/** Privacy-safe error responses shared by Zero-native server extensions. */

import { ValidationError, type AnyElysia } from 'elysia';

import { getPublicAuthErrorMessage } from '../../auth/auth-error-response';
import { AuthError } from '../../auth/types';

export const ZERO_REQUEST_VALIDATION_FAILED = 'ZERO_REQUEST_VALIDATION_FAILED';
export const ZERO_REQUEST_PARSE_FAILED = 'ZERO_REQUEST_PARSE_FAILED';
export const ZERO_RESPONSE_VALIDATION_FAILED = 'ZERO_RESPONSE_VALIDATION_FAILED';

/**
 * Map errors raised before an extension handler runs without reflecting the
 * rejected body, validation schema, or parser details back to the caller.
 */
export function applyServerExtensionErrorHandler(app: AnyElysia): AnyElysia {
  return (app as AnyElysia & {
    onError(handler: (context: {
      code: string;
      error: unknown;
      set: { status?: number };
    }) => unknown): AnyElysia;
  }).onError(function mapZeroExtensionError({ code, error, set }) {
    if (error instanceof AuthError) {
      set.status = error.status;
      return {
        error: getPublicAuthErrorMessage(error),
        code: error.code,
      };
    }

    if (code === 'VALIDATION' && error instanceof ValidationError
      && error.type === 'response') {
      set.status = 500;
      return {
        error: 'Invalid server response.',
        code: ZERO_RESPONSE_VALIDATION_FAILED,
      };
    }

    if (code === 'VALIDATION') {
      set.status = 422;
      return {
        error: 'Invalid request.',
        code: ZERO_REQUEST_VALIDATION_FAILED,
      };
    }

    if (code === 'PARSE') {
      set.status = 400;
      return {
        error: 'Invalid request body.',
        code: ZERO_REQUEST_PARSE_FAILED,
      };
    }

    return undefined;
  });
}

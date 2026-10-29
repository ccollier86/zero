/** Browser-safe scalar privacy rules shared by configuration, capture and read validation. */
import type { LoggingScalar } from './logging-contracts';

// Token-shaped fields are deliberately ineligible even when a vocabulary was
// supplied. New credential-token prefixes must not silently become opt-in values.
export const LOGGING_SENSITIVE_FIELD = /password|secret|cookie|authorization|credential|token|(?:api|private|signing)[_-]?key/i;

export function isLoggingApprovedScalar(value: unknown): value is LoggingScalar {
  return value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string' && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
}

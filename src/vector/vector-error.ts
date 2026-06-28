/**
 * vector-error.ts
 *
 * Defines domain errors for Zero vector storage. This file owns error shape
 * only; it does not log, map HTTP responses, or inspect zvec internals beyond
 * carrying sanitized failure metadata.
 */

/** Stable vector error codes for service and adapter failures. */
export type VectorErrorCode =
  | 'VECTOR_CONFIG_INVALID'
  | 'VECTOR_INDEX_NOT_FOUND'
  | 'VECTOR_DIMENSION_MISMATCH'
  | 'VECTOR_FILTER_INVALID'
  | 'VECTOR_METADATA_INVALID'
  | 'VECTOR_OPERATION_FAILED';

/** Domain error thrown by vector config, filters, services, and adapters. */
export class VectorError extends Error {
  /** Create a vector-domain error with a stable code and optional metadata. */
  constructor(
    public readonly code: VectorErrorCode,
    message: string,
    public readonly metadata: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'VectorError';
  }
}

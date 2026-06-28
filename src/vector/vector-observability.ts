/**
 * vector-observability.ts
 *
 * Emits vector-store lifecycle and operation events through Zero
 * observability. This file owns safe event metadata only; it does not store
 * vectors, inspect text content, or execute zvec operations.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

/** Safe metadata accepted by vector observability helpers. */
export interface VectorEventMetadata {
  index?: string;
  operation?: string;
  indexes?: number;
  documents?: number;
  durationMs?: number;
  errors?: number;
  filterFields?: readonly string[];
}

/** Emit that vector runtime was configured. */
export function emitVectorConfigured(metadata: VectorEventMetadata): void {
  emitPlatformCode(OBS_CODES.VECTOR_CONFIGURED, {
    metadata: safeVectorMetadata(metadata),
  });
}

/** Emit that a zvec index was opened and is ready. */
export function emitVectorIndexReady(metadata: VectorEventMetadata): void {
  emitPlatformCode(OBS_CODES.VECTOR_INDEX_READY, {
    metadata: safeVectorMetadata(metadata),
  });
}

/** Emit successful vector operation completion without record text or vectors. */
export function emitVectorOperationCompleted(metadata: VectorEventMetadata): void {
  emitPlatformCode(OBS_CODES.VECTOR_OPERATION_COMPLETED, {
    metadata: safeVectorMetadata(metadata),
  });
}

/** Emit vector operation failure without record text or vectors. */
export function emitVectorOperationFailed(error: unknown, metadata: VectorEventMetadata): void {
  emitPlatformCode(OBS_CODES.VECTOR_OPERATION_FAILED, {
    error,
    metadata: safeVectorMetadata(metadata),
  });
}

function safeVectorMetadata(metadata: VectorEventMetadata): Record<string, unknown> {
  return {
    index: metadata.index,
    operation: metadata.operation,
    indexes: metadata.indexes,
    documents: metadata.documents,
    durationMs: metadata.durationMs,
    errors: metadata.errors,
    filterFields: metadata.filterFields,
  };
}

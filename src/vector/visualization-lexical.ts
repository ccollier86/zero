/** Native full-corpus lexical admission; no candidate-only term-overlap reranking. */

import { VectorError } from './vector-error';

/** Bound literal text before opening a native collection or parsing a search. */
export function validateLexicalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 16_384 || value.includes('\0')) {
    throw new VectorError('VECTOR_FILTER_INVALID', 'Full-text query must be a bounded literal string.');
  }
  const text = value.trim();
  if (!text) throw new VectorError('VECTOR_FILTER_INVALID', 'Full-text query cannot be empty.');
  return text;
}

/** Validated native query limits; never interpolate user text into a filter. */
export function boundedQueryInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new VectorError('VECTOR_FILTER_INVALID', 'Vector query limit is outside the supported range.', { field, min, max });
  }
  return value;
}

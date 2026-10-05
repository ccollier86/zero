/** Detached scope input and preflight rules for same-service vector writes. */

import { VectorError } from './vector-error';
import { buildZvecFilter, extractSimpleEqualityMetadata, recordMatchesVectorFilter } from './vector-filter';
import type { StoredVectorRecord, VectorFilter, VectorRecord } from './vector-types';

/** Scope identity never follows later mutations to caller/adapter-owned objects. */
export function snapshotVectorFilter(filter: VectorFilter): VectorFilter {
  let copy: VectorFilter;
  try {
    copy = freezeData(structuredClone(filter), new Set());
    buildZvecFilter(copy);
  } catch (error) {
    if (error instanceof VectorError) throw error;
    throw new VectorError('VECTOR_FILTER_INVALID', 'Vector filter must contain valid cloneable data.');
  }
  return copy;
}

/** Queued records cannot have their id/vector/metadata replaced after admission. */
export function snapshotVectorRecords(records: readonly VectorRecord[]): VectorRecord[] {
  try { return structuredClone([...records]); }
  catch { throw new VectorError('VECTOR_METADATA_INVALID', 'Vector records must contain cloneable data.'); }
}

export function prepareScopedVectorRecords(
  filter: VectorFilter,
  records: readonly VectorRecord[],
): VectorRecord[] {
  const required = extractSimpleEqualityMetadata(filter);
  return snapshotVectorRecords(records).map(record => {
    const metadata = { ...(record.metadata ?? {}) };
    for (const [field, value] of Object.entries(required)) {
      if (metadata[field] !== undefined && metadata[field] !== value) {
        throw new VectorError('VECTOR_METADATA_INVALID', 'Vector scope metadata conflicts with the record.', { field });
      }
      metadata[field] = value;
    }
    const prepared = { ...record, metadata };
    if (!recordMatchesVectorFilter({ id: prepared.id, text: prepared.text, metadata }, filter)) {
      throw scopeConflict();
    }
    return prepared;
  });
}

/** Must run inside the same write boundary as the adapter upsert. */
export function assertStoredVectorsInScope(records: readonly StoredVectorRecord[], filter: VectorFilter): void {
  if (records.some(record => !recordMatchesVectorFilter(record, filter))) throw scopeConflict();
}

function scopeConflict(): VectorError {
  return new VectorError('VECTOR_SCOPE_CONFLICT', 'Vector write conflicts with the required scope.');
}

function freezeData<T>(value: T, ancestors: Set<object>): T {
  if (value !== null && typeof value === 'object') {
    if (ancestors.has(value)) throw new VectorError('VECTOR_FILTER_INVALID', 'Vector filters cannot contain cycles.');
    ancestors.add(value);
    try {
      for (const child of Object.values(value)) freezeData(child, ancestors);
      Object.freeze(value);
    } finally { ancestors.delete(value); }
  }
  return value;
}

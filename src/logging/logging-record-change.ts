/** Shared synchronous differences from the source transaction's actual before/after images. */
import { isDeepStrictEqual } from 'node:util';
import type { Row, Change } from '../sync/types';
import type { LoggingFieldChange, LoggingRecordChange, LoggingResourcePolicies } from './logging-activity-contracts';
import { LOGGING_SENSITIVE_FIELD, isLoggingApprovedScalar } from './logging-activity-values';
import { loggingDigest } from './logging-hash';
import { loggingByteLength } from './logging-validation';

const MAX_FIELDS = 32;

export function captureLoggingRecordChange(change: Pick<Change, 'op' | 'table' | 'seq' | 'row' | 'previousRow'>,
  resources: LoggingResourcePolicies = {}): LoggingRecordChange | null {
  const before: Row = change.previousRow ?? {}, after: Row = change.row ?? {};
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(field => Object.hasOwn(before, field) !== Object.hasOwn(after, field) || before[field] !== after[field] && !isDeepStrictEqual(before[field], after[field]));
  if (!changed.length && change.op === 'UPDATE') return null;
  const changes: LoggingFieldChange[] = []; let omittedFields = 0, bytes = loggingByteLength(change.table) + 256;
  for (const key of changed) {
    const policy = resources[change.table]?.fields?.[key] ?? 'redact';
    if (policy === 'omit' || changes.length >= MAX_FIELDS) { omittedFields++; continue; }
    const field = key.length > 256 || /[\u0000-\u001f\u007f]/.test(key) ? 'hash:' + loggingDigest(key) : key;
    const beforePresent = Object.hasOwn(before, key), afterPresent = Object.hasOwn(after, key);
    const previous = beforePresent ? before[key] : null, next = afterPresent ? after[key] : null;
    const allowed = typeof policy === 'object' && !LOGGING_SENSITIVE_FIELD.test(key)
      && isLoggingApprovedScalar(previous) && isLoggingApprovedScalar(next)
      && (!beforePresent || policy.values.includes(previous)) && (!afterPresent || policy.values.includes(next));
    const captured = Object.freeze(allowed
      ? { field, beforePresent, afterPresent, kind: 'value', before: previous, after: next }
      : { field, beforePresent, afterPresent, kind: 'redacted' }) as LoggingFieldChange;
    const size = loggingByteLength(captured) + 1;
    if (bytes + size > 8192) { omittedFields++; continue; }
    bytes += size; changes.push(captured);
  }
  return Object.freeze({ kind: 'record-change', table: change.table, sequence: change.seq, changes: Object.freeze(changes), omittedFields });
}

/** Strict server boundary for typed facts. Metadata never becomes a record snapshot. */
import type { LoggingActivityDetail, LoggingFieldChange } from './logging-activity-contracts';
import { invalid, loggingArray, loggingRecord } from './logging-validation';
import { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';

export function normalizeLoggingActivityDetail(value: unknown): LoggingActivityDetail {
  const detail = loggingRecord(value, ['kind', 'table', 'sequence', 'changes', 'omittedFields']);
  if (detail.kind !== 'record-change' || typeof detail.table !== 'string' || !detail.table.length || detail.table.length > 1024
    || /[\u0000-\u001f\u007f]/.test(detail.table) || !Number.isSafeInteger(detail.omittedFields) || Number(detail.omittedFields) < 0) invalid();
  if (typeof detail.sequence !== 'number' || !Number.isSafeInteger(detail.sequence) || detail.sequence < 1) invalid();
  const sequence = detail.sequence;
  const changes = loggingArray(detail.changes, 32).map(value => {
    const field = loggingRecord(value, ['field', 'beforePresent', 'afterPresent', 'kind', 'before', 'after']);
    if (typeof field.field !== 'string' || !field.field.length || field.field.length > 256 || /[\u0000-\u001f\u007f]/.test(field.field)
      || typeof field.beforePresent !== 'boolean' || typeof field.afterPresent !== 'boolean' || !field.beforePresent && !field.afterPresent) invalid();
    const common = { field: field.field, beforePresent: field.beforePresent, afterPresent: field.afterPresent };
    if (field.kind === 'redacted') {
      if ('before' in field || 'after' in field) invalid();
      return Object.freeze({ ...common, kind: 'redacted' }) as LoggingFieldChange;
    }
    if (field.kind !== 'value' || LOGGING_SENSITIVE_FIELD.test(field.field) || !isLoggingApprovedScalar(field.before) || !isLoggingApprovedScalar(field.after)
      || !field.beforePresent && field.before !== null || !field.afterPresent && field.after !== null
      || field.beforePresent === field.afterPresent && field.before === field.after) invalid();
    return Object.freeze({ ...common, kind: 'value', before: field.before === 0 ? 0 : field.before, after: field.after === 0 ? 0 : field.after }) as LoggingFieldChange;
  });
  if (new Set(changes.map(field => field.field)).size !== changes.length) invalid();
  return Object.freeze({ kind: 'record-change', table: detail.table, sequence, changes: Object.freeze(changes), omittedFields: Number(detail.omittedFields) });
}

/** Browser-only JSON shape check. The server separately performs descriptor-safe admission. */
import type { LoggingActivityDetail } from './logging-activity-contracts';
import { isLoggingApprovedScalar as scalar, LOGGING_SENSITIVE_FIELD as sensitive } from './logging-activity-values';
import { isLoggingResultReference } from './logging-result-contracts';

const record = (value: unknown, keys: readonly string[]): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key));

export function isLoggingActivityDetail(value: unknown): value is LoggingActivityDetail {
  if (value && typeof value === 'object' && 'kind' in value && value.kind === 'result') return isLoggingResultReference(value);
  if (!record(value, ['kind', 'table', 'sequence', 'changes', 'omittedFields']) || value.kind !== 'record-change'
    || typeof value.table !== 'string' || !value.table.length || value.table.length > 1024 || /[\u0000-\u001f\u007f]/.test(value.table)
    || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || !Number.isSafeInteger(value.omittedFields) || value.omittedFields < 0
    || !Array.isArray(value.changes) || value.changes.length > 32) return false;
  const fields = new Set<string>();
  return value.changes.every((field: unknown) => {
    if (!record(field, ['field', 'beforePresent', 'afterPresent', 'kind', 'before', 'after'])
      || typeof field.field !== 'string' || !field.field.length || field.field.length > 256 || /[\u0000-\u001f\u007f]/.test(field.field)
      || fields.has(field.field) || typeof field.beforePresent !== 'boolean' || typeof field.afterPresent !== 'boolean'
      || !field.beforePresent && !field.afterPresent) return false;
    fields.add(field.field);
    if (field.kind === 'redacted') return !('before' in field) && !('after' in field);
    return field.kind === 'value' && !sensitive.test(field.field) && scalar(field.before) && scalar(field.after)
      && (field.beforePresent || field.before === null) && (field.afterPresent || field.after === null)
      && (field.beforePresent !== field.afterPresent || field.before !== field.after);
  });
}

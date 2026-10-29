/** Human-readable summaries of retained facts, never a fresh lookup presented as history. */
import type { LoggingEvent, LoggingScalar } from '../../logging/logging-contracts';
import { loggingWords } from './logging-readable-activity';

export function loggingFieldValue(value: LoggingScalar, present: boolean): string {
  if (!present) return 'Not present';
  if (value === null) return 'Empty';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return value === '' ? 'Empty text' : value;
}

export function loggingChangeSummary(event: LoggingEvent): string | null {
  const detail = event.detail;
  if (detail?.kind !== 'record-change') return event.action === 'record.updated' ? 'Field differences were not retained.' : null;
  const summaries = detail.changes.slice(0, 2).map(field => field.kind === 'value'
    ? `${loggingWords(field.field)}: ${loggingFieldValue(field.before, field.beforePresent)} → ${loggingFieldValue(field.after, field.afterPresent)}`
    : `${loggingWords(field.field)} changed (values private)`);
  if (detail.changes.length > 2) summaries.push(`+${detail.changes.length - 2} more fields`);
  if (detail.omittedFields) summaries.push(`${detail.omittedFields} fields omitted`);
  return summaries.join(' · ') || 'No field values retained';
}

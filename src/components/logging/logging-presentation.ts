/** Browser-only labels never upgrade the certainty of a retained event. */
import type { LoggingEvidence, LoggingOutcome, LoggingQuery } from '../../logging/logging-contracts';

export const loggingEvidence: Record<LoggingEvidence, { label: string; description: string }> = {
  'server-confirmed': { label: 'Server confirmed', description: 'The server recorded this stage. This does not establish that a person read the response or that a later stage completed.' },
  'provider-confirmed': { label: 'Provider confirmed', description: 'A provider confirmed the named stage. Acceptance is not necessarily final delivery or receipt by a person.' },
  'browser-observed': { label: 'Browser observed', description: 'An untrusted browser reported this signal. Views do not prove attention; copy does not include clipboard contents; print does not prove paper output.' },
  estimated: { label: 'Estimated', description: 'A derived estimate, not a directly confirmed action.' },
  incomplete: { label: 'Incomplete', description: 'Some observations or delivery stages are missing. Do not infer a successful result from this record.' },
};
export const loggingOutcome: Record<LoggingOutcome, { label: string; className: string }> = {
  succeeded: { label: 'Succeeded', className: 'border-success/20 bg-success/10 text-success' },
  denied: { label: 'Denied', className: 'border-warning/20 bg-warning/10 text-warning' },
  failed: { label: 'Failed', className: 'border-destructive/20 bg-destructive/10 text-destructive' },
  attempted: { label: 'Attempted', className: 'border-border bg-muted text-muted-foreground' },
  unknown: { label: 'Unknown', className: 'border-border bg-muted text-muted-foreground' },
};
/** Make a code readable while retaining the exact original code separately. */
export function loggingLabel(code: string): string {
  const words = code.replace(/[._:-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
export function loggingDate(value: number): string {
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value).toLocaleString() : 'Unavailable';
}
/** datetime-local uses the investigator's timezone; milliseconds survive until edited. */
export function loggingLocalDate(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 8.64e15) return '';
  const date = new Date(value), local = new Date(value - date.getTimezoneOffset() * 60000);
  return Number.isNaN(local.getTime()) ? '' : local.toISOString().slice(0, 16);
}
export const loggingFilterLabels = {
  family: 'Category', outcome: 'Outcome', actorId: 'User', action: 'Activity', targetId: 'Record ID',
  sessionId: 'Session ID', targetType: 'Table / resource', level: 'Severity', since: 'From', until: 'Before',
} as const;
export type LoggingFilterKey = keyof typeof loggingFilterLabels;
/** Clear editable criteria only, not caller-supplied pinned windows or identities. */
export function clearLoggingFilters(query: LoggingQuery): LoggingQuery {
  const next = { ...query };
  for (const key of Object.keys(loggingFilterLabels) as LoggingFilterKey[]) delete next[key];
  return next;
}
/** Helpful client feedback; the server remains the authoritative query validator. */
export function loggingFilterError(query: LoggingQuery): string | null {
  for (const key of ['actorId', 'sessionId', 'targetId'] as const) if (query[key] !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(query[key])) return `${loggingFilterLabels[key]} must be an opaque ID (letters, digits, dots, underscores, colons or hyphens).`;
  for (const key of ['action', 'targetType'] as const) if (query[key] !== undefined && (query[key].length > 120 || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(query[key]))) return `${loggingFilterLabels[key]} must be an exact lowercase code, such as ${key === 'action' ? 'record.read' : 'record'}.`;
  for (const key of ['since', 'until'] as const) if (query[key] !== undefined && (!Number.isSafeInteger(query[key]) || query[key] < 0 || query[key] > 8.64e15)) return 'Choose a valid date and time.';
  return query.since !== undefined && query.until !== undefined && query.since >= query.until ? 'Start must be before end.' : null;
}

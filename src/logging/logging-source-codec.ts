/** Private source-spool encoding. Shared attribution is stored once; sink/public envelopes remain unchanged. */
import type { LoggingEvent } from './logging-contracts';
import { loggingCanonical, normalizeLoggingEvent } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { LoggingError } from './logging-error';

export function encodeLoggingSourceEvent(event: LoggingEvent) {
  const { version, id, family, action, level, outcome, evidence, occurredAt, target, metadata, detail, ...context } = event;
  return { context: loggingCanonical(context), contextDigest: loggingDigest(context),
    payload: loggingCanonical([id, family, action, level, outcome, evidence, occurredAt, target, metadata, ...(version === 2 ? [version, detail] : [])]) };
}

/** Version-one full envelopes stay readable. No previously queued evidence is rewritten during upgrade. */
export function decodeLoggingSourceEvent(payload: string, context: string | null): LoggingEvent {
  const value: unknown = JSON.parse(payload);
  if (context === null) return normalizeLoggingEvent(value);
  if (!Array.isArray(value) || value.length !== 9 && value.length !== 11 || value.length === 11 && value[9] !== 2) throw new LoggingError('LOGGING_EVENT_INVALID', 'Origin audit encoding is invalid.');
  const [id, family, action, level, outcome, evidence, occurredAt, target, metadata, version, detail] = value;
  return normalizeLoggingEvent({ ...JSON.parse(context), version: version ?? 1, id, family, action, level, outcome, evidence, occurredAt, target, metadata,
    ...(version === 2 ? { detail } : {}) });
}

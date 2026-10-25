/** Validated durable-source budgets. Independent from the in-memory sink writer queue. */
import { loggingRecord } from './logging-validation';
import { LoggingError } from './logging-error';
export interface LoggingSourceLimits { readonly maxEvents: number; readonly maxBytes: number }
export const LOGGING_SOURCE_HARD_EVENTS = 100000;
export const LOGGING_SOURCE_HARD_BYTES = 256 * 1024 * 1024;
export const LOGGING_SOURCE_PAGE_EVENTS = 256;
export function normalizeLoggingSourceLimits(input: unknown = {}): LoggingSourceLimits {
  const r = loggingRecord(input, ['maxEvents', 'maxBytes']);
  const maxEvents = r.maxEvents === undefined ? 50000 : r.maxEvents, maxBytes = r.maxBytes === undefined ? 64 * 1024 * 1024 : r.maxBytes;
  if (!Number.isSafeInteger(maxEvents) || (maxEvents as number) < 1 || (maxEvents as number) > LOGGING_SOURCE_HARD_EVENTS
    || !Number.isSafeInteger(maxBytes) || (maxBytes as number) < 16384 || (maxBytes as number) > LOGGING_SOURCE_HARD_BYTES) {
    throw new LoggingError('LOGGING_CONFIG_INVALID', 'Durable source queue limits are invalid.');
  }
  return Object.freeze({ maxEvents: maxEvents as number, maxBytes: maxBytes as number });
}

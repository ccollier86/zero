/** Closed evidence cursor admission shared by the scoped facade and private actor. */
import type { LoggingEvidenceCursor } from './logging-evidence-contracts';
import { loggingId, loggingRecord, loggingTime, invalid } from './logging-validation';

export function normalizeLoggingEvidenceCursor(value: unknown): number | LoggingEvidenceCursor | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return loggingTime(value); // Existing timestamp API remains supported.
  const r = loggingRecord(value, ['version', 'holds', 'reviews']);
  if (r.version !== 1) invalid('LOGGING_QUERY_INVALID');
  const point = (input: unknown) => {
    if (input === null) return null;
    const p = loggingRecord(input, ['at', 'id']);
    return Object.freeze({ at: loggingTime(p.at), id: loggingId(p.id)! });
  };
  return Object.freeze({ version: 1, holds: point(r.holds), reviews: point(r.reviews) });
}

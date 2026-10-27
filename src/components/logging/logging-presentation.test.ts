import { expect, test } from 'bun:test';
import { clearLoggingFilters, loggingDate, loggingEvidence, loggingFilterError, loggingLabel, loggingLocalDate } from './logging-presentation';

test('friendly labels do not invent a stronger event outcome or evidence type', () => {
  expect(loggingLabel('record.read')).toBe('Record read');
  expect(loggingEvidence['browser-observed'].description).toContain('untrusted');
  expect(loggingEvidence['provider-confirmed'].description).toContain('not necessarily final delivery');
  expect(loggingEvidence['server-confirmed'].description).toContain('does not establish');
});
test('clearing presentation filters preserves exact identity and pinned ingestion constraints', () => {
  const eventIds = ['["source","event"]'];
  const query = { actorId: 'user-a', since: 42, level: 'warn' as const, eventIds, highWaterOrdinal: 100, beforeOrdinal: 90, limit: 25 };
  expect(clearLoggingFilters(query)).toEqual({ eventIds, highWaterOrdinal: 100, beforeOrdinal: 90, limit: 25 });
  expect(query.actorId).toBe('user-a');
});
test('feedback rejects unsupported exact criteria and invalid dates before a table query', () => {
  expect(loggingFilterError({ actorId: 'a@example.test' })).toContain('opaque ID');
  expect(loggingFilterError({ targetType: 'Record' })).toContain('lowercase');
  expect(loggingFilterError({ action: 'record.read', sessionId: 'session-1', actorId: 'user:a' })).toBeNull();
  expect(loggingFilterError({ since: 20, until: 10 })).toBe('Start must be before end.');
  expect(loggingFilterError({ since: NaN })).toBe('Choose a valid date and time.');
  expect(loggingDate(Infinity)).toBe('Unavailable');
  expect(loggingLocalDate(NaN)).toBe('');
  expect(loggingLocalDate()).toBe('');
  expect(loggingLocalDate(1700000000000)).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
});

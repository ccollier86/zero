/** Detached, bounded native references; no canonical target authority or source dependencies. */
import type { CalendarParticipantReference } from './contracts';
import { CalendarError } from './error';
import { calendarKey, calendarRecord, calendarValue } from './validation';

export const CALENDAR_PARTICIPANT_LIMIT = 100;
export function calendarParticipantSearch(input: unknown): string {
  if (typeof input !== 'string' || input.length > 100 || /[\u0000-\u001f\u007f]/.test(input)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return input.trim();
}
/** Duplicates reject instead of hiding invalid intent. Ordering matches SQLite BINARY. */
export function calendarParticipantReferences(input: unknown): CalendarParticipantReference[] {
  const value = calendarValue(input);
  if (!Array.isArray(value) || value.length > CALENDAR_PARTICIPANT_LIMIT) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const references = value.map(item => {
    const r = calendarRecord(item, ['kind', 'userId']);
    if (r.kind !== 'guardian-user') throw new CalendarError('CALENDAR_INPUT_INVALID');
    return { kind: 'guardian-user' as const, userId: calendarKey(r.userId) };
  });
  if (new Set(references.map(reference => reference.userId)).size !== references.length) throw new CalendarError('CALENDAR_INPUT_INVALID');
  return references.sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);
}

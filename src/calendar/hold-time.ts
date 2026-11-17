/** Trusted source clock. Call once per short writer decision, never accept a browser timestamp as now. */
import { CalendarError } from './error';

export function calendarNow(): number {
  const now = Date.now();
  if (!Number.isSafeInteger(now) || Math.abs(now) > 8_640_000_000_000_000) throw new CalendarError('CALENDAR_STATE_INVALID');
  return now;
}

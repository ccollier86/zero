/** Pure source-clock admission; no files, workers, timers or providers. */
import { expect, spyOn, test } from 'bun:test';
import { calendarNow } from './hold-time';

test('hold clock admits canonical exact instants without falling back to viewer time', () => {
  const clock = spyOn(Date, 'now');
  try {
    for (const instant of [-8_640_000_000_000_000, 0, 1, 8_640_000_000_000_000]) {
      clock.mockReturnValue(instant); expect(calendarNow()).toBe(instant);
    }
  } finally { clock.mockRestore(); }
});

test('invalid source clock fails closed with a static state error', () => {
  const clock = spyOn(Date, 'now');
  try {
    for (const instant of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, 8_640_000_000_000_001, -8_640_000_000_000_001]) {
      clock.mockReturnValue(instant);
      expect(calendarNow).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID', outcome: 'not-started' }));
    }
  } finally { clock.mockRestore(); }
});

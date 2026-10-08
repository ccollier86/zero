/** SSR public field semantics; interaction and popup ownership are browser-tested separately. */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatePicker } from './date-picker';
import { TimePicker } from './time-picker';
import { Calendar } from './calendar';

describe('shared picker public composition', () => {
  test('native dropdown captions keep downward carets rather than month-navigation arrows', () => {
    const markup = renderToStaticMarkup(<Calendar captionLayout="dropdown" defaultMonth={new Date(2026, 9, 1)}
      startMonth={new Date(2000, 0)} endMonth={new Date(2030, 11)} />);
    expect(markup.match(/lucide-chevron-down\b/g)?.length).toBeGreaterThanOrEqual(2);
    expect(markup).toContain('lucide-chevron-left');
    expect(markup).toContain('lucide-chevron-right');
  });

  test('button date display and accessible value honor the calendar timezone', () => {
    const markup = renderToStaticMarkup(<DatePicker appearance="button" value={new Date('2026-01-01T00:30:00.000Z')}
      calendarProps={{ timeZone: 'Pacific/Honolulu' }} inputProps={{ id: 'launch', 'aria-label': 'Launch date', 'aria-describedby': 'help' }} />);
    expect(markup).toContain('aria-label="Launch date, Dec 31, 2025"');
    expect(markup).toContain('id="launch"');
    expect(markup).toContain('aria-describedby="help"');
    expect(markup).not.toContain('January 1st, 2026');
  });

  test('time storage is canonical and read-only remains form-submittable', () => {
    const markup = renderToStaticMarkup(<TimePicker value="17:46" name="meeting" format="12h" readOnly aria-label="Meeting time" />);
    expect(markup).toContain('type="hidden"');
    expect(markup).toContain('name="meeting"');
    expect(markup).toContain('value="17:46"');
    expect(markup).toContain('5:46 PM');
    expect(markup).toContain('aria-readonly="true"');
    expect(markup).not.toContain('type="time"');
    const disabled = renderToStaticMarkup(<TimePicker value="17:46" name="meeting" disabled />);
    expect(disabled).toMatch(/<input(?=[^>]*disabled="")(?=[^>]*type="hidden")[^>]*>/);
  });

  test('unsupported incomplete times stay visible and invalid instead of becoming midnight', () => {
    const markup = renderToStaticMarkup(<TimePicker value="unfinished" />);
    expect(markup).toContain('unfinished');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).not.toContain('12:00 AM');
  });
});

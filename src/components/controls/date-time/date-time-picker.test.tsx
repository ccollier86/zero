/** SSR public field semantics; interaction and popup ownership are browser-tested separately. */
import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatePicker } from './date-picker-scroll';
import { DateRangePicker } from './date-range-picker';
import { TimePicker } from './time-picker';
import { Calendar } from './calendar';
import * as Canonical0 from './calendar';
import * as Legacy0 from '../../ui/calendar';
import * as Canonical1 from './calendar-month-presentation';
import * as Legacy1 from '../../ui/calendar-month-presentation';
import * as Canonical2 from './calendar-view-context';
import * as Legacy2 from '../../ui/calendar-view-context';
import * as Canonical3 from './calendar-view-model';
import * as Legacy3 from '../../ui/calendar-view-model';
import * as Canonical4 from './calendar-view-motion';
import * as Legacy4 from '../../ui/calendar-view-motion';
import * as Canonical5 from './calendar-motion';
import * as Legacy5 from '../../ui/calendar-motion';
import * as Canonical6 from './date-picker-scroll';
import * as Legacy6 from '../../ui/date-picker';
import * as Canonical7 from './date-picker-value';
import * as Legacy7 from '../../ui/date-picker-value';
import * as Canonical8 from './date-range-picker';
import * as Legacy8 from '../../ui/date-range-picker';
import * as Canonical9 from './time-picker';
import * as Legacy9 from '../../ui/time-picker';
import * as Canonical10 from './time-picker-value';
import * as Legacy10 from '../../ui/time-picker-value';
import * as Canonical11 from './picker-value-text';
import * as Legacy11 from '../../ui/picker-value-text';
import * as Canonical12 from './picker-popover-motion';
import * as Legacy12 from '../../ui/picker-popover-motion';
import * as PublicDateTime from './index';

test('every historical date/time component, context and helper forwards the exact canonical object', () => {
  const pairs: Array<readonly [Record<string, unknown>, Record<string, unknown>]> = [
    [Legacy0, Canonical0],
    [Legacy1, Canonical1],
    [Legacy2, Canonical2],
    [Legacy3, Canonical3],
    [Legacy4, Canonical4],
    [Legacy5, Canonical5],
    [Legacy6, Canonical6],
    [Legacy7, Canonical7],
    [Legacy8, Canonical8],
    [Legacy9, Canonical9],
    [Legacy10, Canonical10],
    [Legacy11, Canonical11],
    [Legacy12, Canonical12],
  ];
  for (const [legacy, canonical] of pairs) {
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(canonical).sort());
    for (const name of Object.keys(canonical)) expect(legacy[name]).toBe(canonical[name]);
  }
  expect(PublicDateTime.Calendar).toBe(Calendar);
  expect(PublicDateTime.DatePicker).toBe(DatePicker);
  expect(PublicDateTime.DateRangePicker).toBe(DateRangePicker);
  expect(PublicDateTime.TimePicker).toBe(TimePicker);
  expect(Object.keys(PublicDateTime).sort()).toEqual(['Calendar', 'DatePicker', 'DateRangePicker', 'TimePicker']);
});

describe('shared picker public composition', () => {
  test('date range retains its native non-submitting trigger, custom placeholder and controlled display', () => {
    const empty = renderToStaticMarkup(<DateRangePicker placeholder="Choose reporting period" className="consumer-range" />);
    expect(empty).toContain('data-slot="date-range-picker-trigger"');
    expect(empty).toContain('type="button"');
    expect(empty).toContain('Choose reporting period');
    expect(empty).toContain('consumer-range');
    const selected = renderToStaticMarkup(<DateRangePicker value={{ from: new Date(2026, 1, 3), to: new Date(2026, 1, 10) }} disabled />);
    expect(selected).toContain('Feb 03, 2026');
    expect(selected).toContain('Feb 10, 2026');
    expect(selected).toContain('disabled=""');
  });

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

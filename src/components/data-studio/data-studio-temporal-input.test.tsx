import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataStudioTemporalInput } from './data-studio-temporal-input';
import { DatePicker } from '../ui/date-picker';

describe('Data Studio existing temporal control composition', () => {
  test('date defaults use the platform DatePicker with accessible attributes', () => {
    const markup = renderToStaticMarkup(<DataStudioTemporalInput type="date" value="2026-02-03"
      onValueChange={() => { throw new Error('Rendering must not edit data.'); }} id="birthday" required
      aria-label="Birthday" aria-describedby="birthday-help" />);
    expect(markup).toContain('data-slot="date-picker"');
    expect(markup).toContain('id="birthday"');
    expect(markup).toContain('aria-label="Birthday"');
    expect(markup).toContain('aria-describedby="birthday-help"');
    expect(markup).toContain('value="February 3rd, 2026"');
    expect(markup).toContain('aria-label="Clear Birthday"');
    expect(markup).not.toMatch(/<input[^>]*\stype="date"/);
  });

  test('datetime binds existing TimePicker and a visible precise-seconds input', () => {
    const markup = renderToStaticMarkup(<DataStudioTemporalInput type="datetime" value="2026-02-03T17:45:37.123"
      onValueChange={() => undefined} aria-label="Meeting" />);
    expect(markup).toContain('data-slot="date-picker"');
    expect(markup).toContain('data-slot="time-picker"');
    expect(markup).toContain('aria-label="Meeting time"');
    expect(markup).toContain('aria-label="Meeting seconds"');
    expect(markup).toContain('value="37.123"');
    expect(markup).not.toMatch(/<input[^>]*\stype="(?:date|time|datetime-local)"/);
  });

  test('incomplete raw drafts remain visible and invalid rather than reverting to saved values', () => {
    const markup = renderToStaticMarkup(<DataStudioTemporalInput type="datetime" value="2/30/2026T17:45:37."
      onValueChange={() => undefined} aria-label="Meeting" />);
    expect(markup).toContain('value="2/30/2026"');
    expect(markup).toContain('value="37."');
    expect(markup).toContain('aria-invalid="true"');
  });

  test('empty and read-only controls cannot mutate merely through rendering', () => {
    const markup = renderToStaticMarkup(<DataStudioTemporalInput type="datetime" value=""
      readOnly onValueChange={() => { throw new Error('Read-only must not mutate.'); }} aria-label="Meeting" />);
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('aria-label="Clear Meeting"');
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('aria-invalid="true"');
  });

  test('DatePicker forwards controlled text, input metadata, and read-only without native date UI', () => {
    const markup = renderToStaticMarkup(<DatePicker inputValue="unfinished date" readOnly
      inputProps={{ id: 'controlled-date', 'aria-label': 'Controlled date', 'aria-describedby': 'help', required: true }} />);
    expect(markup).toContain('value="unfinished date"');
    expect(markup).toContain('id="controlled-date"');
    expect(markup).toContain('aria-label="Controlled date"');
    expect(markup).toContain('aria-describedby="help"');
    expect(markup).toContain('required=""');
    expect(markup).toContain('readOnly=""');
    expect(markup).not.toContain('type="date"');
  });
});

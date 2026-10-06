import { describe, expect, test } from 'bun:test';
import {
  dataStudioCalendarDate, dataStudioCalendarDraft, dataStudioTemporalParts, parseDataStudioTemporalDraft,
  updateDataStudioTemporalDate, updateDataStudioTemporalDateText, updateDataStudioTemporalSeconds,
  updateDataStudioTemporalTime,
} from './data-studio-temporal-value';
import { dataStudioValueDraft, parseDataStudioValueDraft } from './data-studio-value';
import type { DataStudioColumn } from '../../frontend/client/data-studio-client';

const datetime: DataStudioColumn = { columnId: 'meeting', key: 'meeting', label: 'Meeting', type: 'datetime', required: false };
const date: DataStudioColumn = { ...datetime, type: 'date' };

describe('Data Studio temporal picker binding', () => {
  test('date-only values use local calendar parts rather than a UTC midnight instant', () => {
    const calendar = dataStudioCalendarDate('2026-02-03')!;
    expect(calendar.getFullYear()).toBe(2026);
    expect(calendar.getMonth()).toBe(1);
    expect(calendar.getDate()).toBe(3);
    expect(calendar.getHours()).toBe(0);
    expect(dataStudioCalendarDraft(calendar)).toBe('2026-02-03');
  });

  test.each(['2026-02-30', '2025-02-29', '2026-04-31', '0000-01-01', '2026-13-01', '2026-01-00', '', '02/03/2026'])('rejects invalid date-only domain draft %s', (value) => {
    expect(dataStudioCalendarDate(value)).toBeUndefined();
    expect(() => parseDataStudioTemporalDraft(value, 'date')).toThrow();
  });

  test('retains full four-digit calendar years and valid leap days', () => {
    for (const value of ['0001-01-01', '0099-12-31', '2024-02-29', '9999-12-31']) {
      expect(dataStudioCalendarDraft(dataStudioCalendarDate(value)!)).toBe(value);
    }
  });

  test('existing timestamp projection round-trips seconds/milliseconds unchanged', () => {
    const original = '2026-02-03T17:45:37.123Z';
    const draft = dataStudioValueDraft(original, datetime);
    expect(draft).toEndWith(':37.123');
    expect(parseDataStudioTemporalDraft(draft, 'datetime')).toBe(original);
    expect(parseDataStudioValueDraft(draft, datetime)).toBe(original);
  });

  test('date changes preserve the exact time and fractional buffer', () => {
    const changed = updateDataStudioTemporalDate('2026-02-03T17:45:37.100', dataStudioCalendarDate('2026-03-04'), 'datetime');
    expect(changed).toBe('2026-03-04T17:45:37.100');
    expect(updateDataStudioTemporalDateText('2026-02-03T17:45:37.123', '3/4/2026', 'datetime')).toBe('2026-03-04T17:45:37.123');
    expect(updateDataStudioTemporalDateText('2026-02-03T17:45:37.123', '2026-03-04', 'datetime')).toBe('2026-03-04T17:45:37.123');
  });

  test('hour/minute changes retain seconds rather than rounding to a minute', () => {
    expect(updateDataStudioTemporalTime('2026-02-03T17:45:37.123', '08:15')).toBe('2026-02-03T08:15:37.123');
    expect(updateDataStudioTemporalTime('2026-02-03T17:45:37.100', '08:15')).toBe('2026-02-03T08:15:37.100');
    expect(updateDataStudioTemporalTime('2026-02-03T17:45', '08:15')).toBe('2026-02-03T08:15:00.000');
  });

  test('clearing is explicit and empty reading does not manufacture a record value', () => {
    expect(dataStudioTemporalParts('', 'datetime')).toEqual({ date: undefined, dateDraft: '', time: '00:00', seconds: '00.000', valid: true });
    expect(updateDataStudioTemporalDate('2026-02-03T17:45:37.123', undefined, 'datetime')).toBe('');
    expect(updateDataStudioTemporalDateText('2026-02-03T17:45:37.123', '', 'datetime')).toBe('');
    expect(parseDataStudioValueDraft('', datetime)).toBeNull();
    expect(parseDataStudioValueDraft('', date)).toBeNull();
    expect(() => parseDataStudioValueDraft('', { ...date, required: true })).toThrow('Meeting requires a date');
  });

  test('empty day plus explicitly edited time remains an invalid partial draft', () => {
    expect(updateDataStudioTemporalTime('', '14:30')).toBe('T14:30:00.000');
    expect(dataStudioTemporalParts('T14:30:00.000', 'datetime').valid).toBe(false);
    expect(updateDataStudioTemporalDateText('T14:30:00.000', '2/3/2026', 'datetime')).toBe('2026-02-03T14:30:00.000');
  });

  test('invalid typed date and seconds survive edits to other pieces', () => {
    const invalid = updateDataStudioTemporalDateText('2026-02-03T17:45:37.123', '2/30/2026', 'datetime');
    expect(invalid).toBe('2/30/2026T17:45:37.123');
    expect(dataStudioTemporalParts(invalid, 'datetime').valid).toBe(false);
    expect(updateDataStudioTemporalTime(invalid, '08:15')).toBe('2/30/2026T08:15:37.123');
    const seconds = updateDataStudioTemporalSeconds('2026-02-03T17:45:37.123', '37.');
    expect(seconds).toBe('2026-02-03T17:45:37.');
    expect(updateDataStudioTemporalTime(seconds, '08:15')).toBe('2026-02-03T08:15:37.');
    expect(updateDataStudioTemporalDateText(seconds, '3/4/2026', 'datetime')).toBe('2026-03-04T17:45:37.');
  });

  test.each([
    '2026-02-30T12:00:00.000', '2026-04-31T12:00', '2026-02-03T24:00',
    '2026-02-03T17:60', '2026-02-03T17:45:60', '2026-02-03T17:45:',
    '2026-02-03T17:45:37.', '2026-02-03T17:45:37.1234', '2026-02-03T17:45:3',
  ])('central parser rejects invalid local datetime %s instead of normalizing it', (value) => {
    expect(() => parseDataStudioTemporalDraft(value, 'datetime')).toThrow();
    expect(() => parseDataStudioValueDraft(value, datetime)).toThrow();
    expect(dataStudioTemporalParts(value, 'datetime').valid).toBe(false);
  });

  test('accepts minute precision and preserves supported fractional precisions', () => {
    for (const value of ['2026-02-03T17:45', '2026-02-03T17:45:37', '2026-02-03T17:45:37.1', '2026-02-03T17:45:37.12', '2026-02-03T17:45:37.123']) {
      expect(parseDataStudioTemporalDraft(value, 'datetime')).toBe(new Date(value).toISOString());
    }
  });

  test('public draft parser retains valid timezone-bearing ISO compatibility and exact fractions', () => {
    for (const value of [
      '2026-02-03T17:45:37.123Z', '2026-02-03T12:45:37.123-05:00',
      '2026-02-04T02:45:37.123+09:00', '2026-02-03T17:45:37.1Z',
      '2026-02-03T17:45:37.12Z', '2026-02-03T17:45:37Z',
    ]) {
      expect(parseDataStudioValueDraft(value, datetime)).toBe(new Date(value).toISOString());
      expect(() => parseDataStudioTemporalDraft(value, 'datetime')).toThrow();
    }
  });

  test.each([
    '2026-02-30T17:45:37.123Z', '2026-04-31T17:45:37.123-05:00',
    '2026-02-03T24:00:00Z', '2026-02-03T17:60:00Z', '2026-02-03T17:45:60Z',
    '2026-02-03T17:45:37.1234Z', '2026-02-03T17:45:37.123+24:00',
  ])('public ISO parser rejects impossible calendar/time instead of rollover: %s', (value) => {
    expect(() => parseDataStudioValueDraft(value, datetime)).toThrow();
  });

  test('does not accept invalid time-picker callbacks or invalid Date instances', () => {
    expect(() => updateDataStudioTemporalTime('', '24:00')).toThrow();
    expect(() => dataStudioCalendarDraft(new Date(NaN))).toThrow();
  });

  test('calendar and local datetime semantics hold in opposite timezone offsets and DST gaps', async () => {
    const script = `import {dataStudioCalendarDate,dataStudioCalendarDraft,parseDataStudioTemporalDraft} from './src/components/data-studio/data-studio-temporal-value';
      const date=dataStudioCalendarDate('2026-02-03');
      let gap=false;try{parseDataStudioTemporalDraft('2026-03-08T02:30:37.123','datetime')}catch{gap=true}
      console.log(JSON.stringify({date:dataStudioCalendarDraft(date),day:date.getDate(),iso:parseDataStudioTemporalDraft('2026-02-03T17:45:37.123','datetime'),gap}));`;
    const cases = [
      ['America/New_York', '2026-02-03T22:45:37.123Z', true],
      ['Asia/Tokyo', '2026-02-03T08:45:37.123Z', false],
      ['UTC', '2026-02-03T17:45:37.123Z', false],
    ] as const;
    for (const [timezone, iso, gap] of cases) {
      const process = Bun.spawn([Bun.which('bun')!, '-e', script], { env: { TZ: timezone, PATH: Bun.env.PATH }, stdout: 'pipe', stderr: 'pipe' });
      expect(await process.exited).toBe(0);
      expect(JSON.parse(await new Response(process.stdout).text())).toEqual({ date: '2026-02-03', day: 3, iso, gap });
    }
  });
});

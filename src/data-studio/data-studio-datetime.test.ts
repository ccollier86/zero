import { expect, test } from 'bun:test';
import { normalizeDataStudioValueForColumn, type DataStudioColumn } from './index';

const column: DataStudioColumn = { columnId: 'time', key: 'time', label: 'Time', type: 'datetime', required: false };
test.each(['2026-02-30T12:30:00Z', '2025-02-29T01:00:00+02:00', '2026-04-31T23:00:00-05:00'])(
  'datetime rejects impossible calendar date instead of silently normalizing %s', value => {
    expect(() => normalizeDataStudioValueForColumn(column, value))
      .toThrow('datetime value is invalid');
  },
);
test('valid leap-day and offset timestamps retain canonical UTC conversion', () => {
  expect(normalizeDataStudioValueForColumn(column, '2024-02-29T23:00:00-05:00')).toBe('2024-03-01T04:00:00.000Z');
  expect(normalizeDataStudioValueForColumn(column, '2026-04-30T23:00:00Z')).toBe('2026-04-30T23:00:00.000Z');
});

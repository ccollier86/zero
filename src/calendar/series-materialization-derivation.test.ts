/** Pure budget arithmetic and owned SQLite MEMORY tests only. */
import { expect, test } from 'bun:test';
import { CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT as limit, calendarSeriesSelectedProjectionExtraRows } from './series-materialization-derivation';

test('selected projection reserves its exact head/resource cost inside the native256 variable-fact budget', () => {
  expect(limit).toBe(153);
  for (let resources = 1; resources <= 16; resources++) {
    const nativeVersionRows = 1 + 2 * resources, extra = calendarSeriesSelectedProjectionExtraRows(resources);
    expect(extra).toBe(1 + resources);
    expect(extra * 3).toBeLessThanOrEqual(nativeVersionRows * 2);
    const versions = Math.floor(limit / nativeVersionRows);
    expect(limit + versions * extra + 1).toBeLessThanOrEqual(256);
  }
  for (const resources of [0, 17, 1.5, NaN]) expect(() => calendarSeriesSelectedProjectionExtraRows(resources)).toThrow();
});

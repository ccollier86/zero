/** Pure launch-profile metadata only. No factory launch, files or processes. */
import { expect, test } from 'bun:test';
import { calendarSeriesNativeProfile } from './series-native-profile';

test('native Calendar profiles bind distinct exact actor flags and source entries; legacy default remains21', () => {
  const original = calendarSeriesNativeProfile(), selected = calendarSeriesNativeProfile('selected-children-v1');
  expect(original).toEqual({ id: 'materialization-v1', realmVersion: '21', actorEntrypoint: 'series-actor-entry.ts', actorFlag: '--zero-calendar-series-actor', projectionRowLimit: 256 });
  expect(selected).toEqual({ id: 'selected-children-v1', realmVersion: '22', actorEntrypoint: 'series-children-actor-entry.ts', actorFlag: '--zero-calendar-series-children-actor', projectionRowLimit: 153 });
  expect(Object.isFrozen(original)).toBe(true); expect(Object.isFrozen(selected)).toBe(true);
  expect(calendarSeriesNativeProfile('materialization-v1')).toBe(original);
  for (const value of ['constructor', '__proto__', 'toString', '../app/server.ts', '22', null, {}, new String('materialization-v1')]) {
    expect(() => calendarSeriesNativeProfile(value as never)).toThrow();
  }
});

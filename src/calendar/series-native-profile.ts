/** Closed native package profiles, not authored config, arbitrary realm
 * overrides or application-process fallbacks. Neither enables a public API. */
import { CalendarError } from './error';
import { CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT, CALENDAR_SERIES_LEGACY_PROJECTION_ROW_LIMIT } from './series-projection-budgets';

export type CalendarSeriesNativeProfile = 'materialization-v1' | 'selected-children-v1';
const PROFILES = Object.freeze({
  'materialization-v1': Object.freeze({ id: 'materialization-v1', realmVersion: '21', actorEntrypoint: 'series-actor-entry.ts', actorFlag: '--zero-calendar-series-actor', projectionRowLimit: CALENDAR_SERIES_LEGACY_PROJECTION_ROW_LIMIT }),
  'selected-children-v1': Object.freeze({ id: 'selected-children-v1', realmVersion: '22', actorEntrypoint: 'series-children-actor-entry.ts', actorFlag: '--zero-calendar-series-children-actor', projectionRowLimit: CALENDAR_SERIES_SELECTED_PROJECTION_ROW_LIMIT }),
});

export function calendarSeriesNativeProfile(profile: CalendarSeriesNativeProfile = 'materialization-v1') {
  if (typeof profile !== 'string' || !Object.hasOwn(PROFILES, profile)) throw new CalendarError('CALENDAR_CONFIG_INVALID');
  return PROFILES[profile];
}

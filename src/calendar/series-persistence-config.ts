/** Private matching-actor composition for the series profile, never an authored
 * setting or an application entrypoint fallback. Source/dependencies must match
 * the parent package, as for the ordinary Calendar and Jobs actors. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactoryOptions } from '../databases/subprocess-database-executor-factory';
import { assertCalendarDefaultActorRuntime, type CalendarActorOverride, type ResolvedCalendarPersistenceConfig } from './persistence-config';
import { calendarRecord } from './validation';
import { CalendarError } from './error';
import { calendarSeriesNativeProfile, type CalendarSeriesNativeProfile } from './series-native-profile';

export function resolveCalendarSeriesPersistenceConfig(projectRoot: string, trustedActors?: CalendarActorOverride,
  profile: CalendarSeriesNativeProfile = 'materialization-v1'): ResolvedCalendarPersistenceConfig {
  try {
    const selected = calendarSeriesNativeProfile(profile);
    assertCalendarDefaultActorRuntime(import.meta.url, trustedActors);
    let entry = fileURLToPath(new URL('./' + selected.actorEntrypoint, import.meta.url));
    if (!existsSync(entry)) try { entry = join(dirname(Bun.resolveSync('@zero/framework/calendar/server', projectRoot)), selected.actorEntrypoint); }
    catch { /* Missing matching package remains unavailable; never boot the app. */ }
    const actors = trustedActors === undefined ? { launch: { kind: 'source' as const, entrypoint: entry }, env: {} }
      : calendarRecord(trustedActors, ['launch', 'env', 'executor']);
    return Object.freeze({ createExecutor: createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: selected.actorFlag } as SubprocessDatabaseExecutorFactoryOptions),
      defaultActorEntrypoint: trustedActors === undefined ? entry : null });
  } catch (error) {
    if (error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY') throw error;
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
}

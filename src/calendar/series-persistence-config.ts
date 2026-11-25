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

export function resolveCalendarSeriesPersistenceConfig(projectRoot: string, trustedActors?: CalendarActorOverride): ResolvedCalendarPersistenceConfig {
  try {
    assertCalendarDefaultActorRuntime(import.meta.url, trustedActors);
    let entry = fileURLToPath(new URL('./series-actor-entry.ts', import.meta.url));
    if (!existsSync(entry)) try { entry = join(dirname(Bun.resolveSync('@zero/framework/calendar/server', projectRoot)), 'series-actor-entry.ts'); }
    catch { /* Missing matching package remains unavailable; never boot the app. */ }
    const actors = trustedActors === undefined ? { launch: { kind: 'source' as const, entrypoint: entry }, env: {} }
      : calendarRecord(trustedActors, ['launch', 'env', 'executor']);
    return Object.freeze({ createExecutor: createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: '--zero-calendar-series-actor' } as SubprocessDatabaseExecutorFactoryOptions),
      defaultActorEntrypoint: trustedActors === undefined ? entry : null });
  } catch (error) {
    if (error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY') throw error;
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
}

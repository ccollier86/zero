/** Trusted launch composition. Resolution opens no calendar root, file or actor. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubprocessDatabaseExecutorFactory, type SubprocessDatabaseExecutorFactory,
  type SubprocessDatabaseExecutorFactoryOptions } from '../databases/subprocess-database-executor-factory';
import type { ResolvedCalendarConfig } from './config';
import { CalendarError } from './error';
import { calendarRecord } from './validation';

/** Separate trusted setup input, never a browser/delegated CalendarConfig field. */
export type CalendarActorOverride = Omit<SubprocessDatabaseExecutorFactoryOptions, 'actorFlag'>;
export interface ResolvedCalendarPersistenceConfig {
  readonly createExecutor: SubprocessDatabaseExecutorFactory;
  readonly defaultActorEntrypoint: string | null;
}

export function resolveCalendarPersistenceConfig(_config: ResolvedCalendarConfig, projectRoot: string,
  trustedActors?: CalendarActorOverride): ResolvedCalendarPersistenceConfig {
  try {
    assertCalendarDefaultActorRuntime(import.meta.url, trustedActors);
    let entry = fileURLToPath(new URL('./actor-entry.ts', import.meta.url));
    if (!existsSync(entry)) try {
      entry = join(dirname(Bun.resolveSync('@zero/framework/calendar/server', projectRoot)), 'actor-entry.ts');
    } catch { /* open() reports unavailable; the application entry is never a fallback. */ }
    const actors = trustedActors === undefined
      ? { launch: { kind: 'source' as const, entrypoint: entry }, env: {} }
      : calendarRecord(trustedActors, ['launch', 'env', 'executor']);
    return Object.freeze({
      createExecutor: createSubprocessDatabaseExecutorFactory({ ...actors, actorFlag: '--zero-calendar-actor' } as SubprocessDatabaseExecutorFactoryOptions),
      defaultActorEntrypoint: trustedActors === undefined ? entry : null,
    });
  } catch (error) {
    if (error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY') throw error;
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
}

/** A compiled application's process.execPath is not a general Bun source interpreter. */
export function assertCalendarDefaultActorRuntime(moduleUrl: string, trustedActors?: CalendarActorOverride): void {
  if (!/\/\$bunfs\//.test(moduleUrl)) return;
  if (trustedActors === undefined) throw new CalendarError('CALENDAR_NOT_READY');
  const actors = calendarRecord(trustedActors, ['launch', 'env', 'executor']), launch = calendarRecord(actors.launch);
  if (launch.kind === 'source' && (typeof launch.runtimeExecutable !== 'string' || launch.runtimeExecutable === process.execPath)) {
    throw new CalendarError('CALENDAR_NOT_READY');
  }
}

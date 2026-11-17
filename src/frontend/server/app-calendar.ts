/** Opt-in private calendar lifecycle. Guardian/logging settle first; no Jobs, Torrent or provider is implicitly enabled. */
import type { Elysia } from 'elysia';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_CALENDAR_SERVICE,
  ZERO_DATABASE_COMMIT_AUTHORITY,
  ZERO_DATABASE_MANAGER,
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_LOGGING_RUNTIME,
  ZERO_SYSTEM_DB,
} from '../../runtime/service-keys';
import { CalendarRuntime } from '../../calendar/runtime';
import { resolveCalendarPersistenceConfig } from '../../calendar/persistence-config';
import { CalendarService } from '../../calendar/service';
import { createCalendarHttp } from '../../calendar/http';
import { installCalendarLogging } from '../../calendar/logging';
import type { ResolvedConfig } from './types';

export async function mountManagedCalendar(input: {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly config: ResolvedConfig;
  startAuth(): Promise<void>;
}): Promise<void> {
  const { app, runtime, config } = input;
  // Omission/false is wholly inert: no file, schema, route, actor, timer or subscription work.
  if (!config.calendar) return;
  await input.startAuth();
  const manager = runtime.require(ZERO_DATABASE_MANAGER);
  const logging = runtime.get(ZERO_LOGGING_RUNTIME), authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY);
  const persistence = await CalendarRuntime.open({
    config: config.calendar,
    persistence: resolveCalendarPersistenceConfig(config.calendar, config.projectRoot),
    system: runtime.require(ZERO_SYSTEM_DB),
    installAllowed: config.migrate || manager.systemRuntime.sqlite.mode === 'ephemeral',
    authority,
    observability: runtime.require(ZERO_OBSERVABILITY_RUNTIME),
    ...(logging ? { source: coordinator => installCalendarLogging(logging, coordinator, authority.coordinator) } : {}),
  });
  runtime.addCleanup(() => persistence.close());
  const lifetime = new AbortController();
  const service = new CalendarService(persistence, config.calendar, lifetime.signal);
  runtime.addCleanup(async () => {
    // Retire captured facades before releasing their provider; retained calendar state is never removed.
    lifetime.abort();
    runtime.clear(ZERO_CALENDAR_SERVICE, service);
    await service.close();
  });
  runtime.set(ZERO_CALENDAR_SERVICE, service);
  app.use(await createCalendarHttp(runtime));
}

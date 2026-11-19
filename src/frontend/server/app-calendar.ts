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
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_AUTH_TENANCY_SERVICE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
} from '../../runtime/service-keys';
import { CalendarRuntime } from '../../calendar/runtime';
import { resolveCalendarPersistenceConfig } from '../../calendar/persistence-config';
import { CalendarService } from '../../calendar/service';
import { ManagedCalendarParticipantDirectory } from '../../calendar/participants-directory';
import { createCalendarHttp } from '../../calendar/http';
import { installCalendarLogging } from '../../calendar/logging';
import { composeCalendarRuntimeSources, type CalendarRuntimeSourceFactory } from '../../calendar/runtime-sources';
import type { ResolvedConfig } from './types';
import type { LoggingRuntime } from '../../logging/logging-runtime';

export interface ManagedCalendarInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly config: ResolvedConfig;
  readonly signal?: AbortSignal;
  startAuth(): Promise<void>;
}

/** @internal Native owner only; never projected through request services. */
export interface ManagedCalendarProviderOwner {
  readonly persistence: CalendarRuntime;
  /** Exact logging binding installed on this native provider, or disabled. */
  readonly logging: LoggingRuntime | null;
  quiesce(): void;
  drainFacade(): Promise<void>;
  closeProvider(): Promise<void>;
  close(): Promise<void>;
}
export interface ManagedCalendarCoreOwner extends ManagedCalendarProviderOwner { readonly service: CalendarService }

/** @internal Shared core construction. The private integration supplies only its
 * native source and shared teardown owner; ordinary Calendar pays no readiness cost.
 */
export async function prepareManagedCalendarCore(input: ManagedCalendarInput, native: {
  readonly source?: CalendarRuntimeSourceFactory;
  readonly closeWith?: () => Promise<void>;
  readonly integrationWake?: true;
  /** Capture exact ownership before participant/route publication can fail. */
  readonly retainProvider?: (owner: ManagedCalendarProviderOwner) => void;
} = {}): Promise<ManagedCalendarCoreOwner | null> {
  const { app, runtime, config } = input;
  // Omission/false is wholly inert: no file, schema, route, actor, timer or subscription work.
  if (!config.calendar) return null;
  input.signal?.throwIfAborted();
  await input.startAuth();
  input.signal?.throwIfAborted();
  const manager = runtime.require(ZERO_DATABASE_MANAGER);
  const logging = runtime.get(ZERO_LOGGING_RUNTIME), authority = runtime.require(ZERO_DATABASE_COMMIT_AUTHORITY);
  const loggingSource: CalendarRuntimeSourceFactory | undefined = logging
    ? coordinator => installCalendarLogging(logging, coordinator, authority.coordinator) : undefined;
  const source = native.source ? composeCalendarRuntimeSources(...(loggingSource ? [loggingSource] : []), native.source) : loggingSource;
  const persistence = await CalendarRuntime.open({
    config: config.calendar,
    persistence: resolveCalendarPersistenceConfig(config.calendar, config.projectRoot),
    system: runtime.require(ZERO_SYSTEM_DB),
    installAllowed: config.migrate || manager.systemRuntime.sqlite.mode === 'ephemeral',
    authority,
    observability: runtime.require(ZERO_OBSERVABILITY_RUNTIME),
    ...(source ? { source } : {}),
    ...(native.integrationWake ? { integrationWake: true } : {}),
  });
  const lifetime = new AbortController();
  let directory: ManagedCalendarParticipantDirectory | undefined, overrideTargets: ManagedCalendarParticipantDirectory | undefined,
    service: CalendarService | undefined;
  let providerClose: Promise<void> | null = null, unregister: (() => void) | undefined;
  const quiesce = () => {
    lifetime.abort();
    if (service) runtime.clear(ZERO_CALENDAR_SERVICE, service);
  };
  const drainFacade = async () => { quiesce(); await service?.close(); };
  const closeProvider = () => {
    if (providerClose) return providerClose;
    const task = (async () => {
      const failures: unknown[] = [];
      try { await drainFacade(); } catch (error) { failures.push(error); }
      try { directory?.close(); } catch (error) { failures.push(error); }
      try { overrideTargets?.close(); } catch (error) { failures.push(error); }
      try { await persistence.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Managed Calendar provider shutdown failed.');
    })();
    providerClose = task;
    // Keep the same quarantined native provider, with permanently retired
    // intake, but permit its exact close to be retried after physical recovery.
    void task.catch(() => { if (providerClose === task) providerClose = null; });
    return task;
  };
  const close = native.closeWith ?? closeProvider;
  try {
    native.retainProvider?.(Object.freeze({ persistence, logging: logging ?? null, quiesce, drainFacade, closeProvider, close }));
    // Register ownership before any fallible facade/route publication. A failed
    // local close keeps this exact shared cleanup registered for later retry.
    unregister = runtime.addCleanup(close);
    // The dependency is composed once from canonical SYSTEM/Guardian owners.
    // Disabled participants do not inspect those stores or install listeners.
    input.signal?.throwIfAborted();
    directory = config.calendar.participants ? new ManagedCalendarParticipantDirectory({
      db: runtime.require(ZERO_SYSTEM_DB), users: runtime.require(ZERO_AUTH_STORE),
      tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE) ?? null,
      kernel: runtime.require(ZERO_AUTHORIZATION_KERNEL), roles: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE) ?? null,
      config: config.calendar, assertCurrent: () => runtime.require(ZERO_AUTH_TOKEN_SERVICE).assertCurrentProfile(),
    }) : undefined;
    // Grant eligibility is independent from which accounts an app permits as
    // appointment attendees. This private projection exposes no extra directory.
    overrideTargets = config.calendar.overrides ? new ManagedCalendarParticipantDirectory({
      db: runtime.require(ZERO_SYSTEM_DB), users: runtime.require(ZERO_AUTH_STORE),
      tenancy: runtime.get(ZERO_AUTH_TENANCY_SERVICE) ?? null,
      kernel: runtime.require(ZERO_AUTHORIZATION_KERNEL), roles: runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE) ?? null,
      config: { ...config.calendar, participants: { userEligibility: 'user' } },
      assertCurrent: () => runtime.require(ZERO_AUTH_TOKEN_SERVICE).assertCurrentProfile(),
    }) : undefined;
    service = new CalendarService(persistence, config.calendar, lifetime.signal, directory, overrideTargets);
    // For a native integration this subordinate registration delegates to the
    // same shared close; it can never close Calendar below Jobs/Torrent work.
    runtime.set(ZERO_CALENDAR_SERVICE, service);
    app.use(await createCalendarHttp(runtime));
    input.signal?.throwIfAborted();
    return Object.freeze({ persistence, logging: logging ?? null, service, quiesce, drainFacade, closeProvider, close });
  } catch (error) {
    // Factory failure is still inside beforeRecovery. Clean local state, never
    // recursively invoke the shared Workflow stop from its own preparation.
    try { await closeProvider(); unregister?.(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Managed Calendar preparation and cleanup failed.'); }
    throw error;
  }
}

export async function mountManagedCalendar(input: ManagedCalendarInput): Promise<void> {
  await prepareManagedCalendarCore(input);
}

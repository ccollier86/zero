/** Managed startup and shutdown for the durable ReactiveDB function host. */

import type { Elysia } from 'elysia';
import {
  DatabaseAutomationDispatcher,
} from '../../database-automations/database-automation-dispatcher';
import type { DatabaseAutomationRegistry } from '../../database-automations/database-automations';
import type { DatabaseManager } from '../../databases/database-manager';
import {
  OBS_CODES,
  emitPlatformCodeTo,
} from '../../observability';
import type { PlatformObservabilityRuntime } from '../../observability/types';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ManagedAppDatabaseAutomations } from './app-database-automations';
import {
  createAppDatabaseAutomationSourceAcquirer,
} from './app-database-automation-source';
import type {
  DatabaseAutomationExecutionServerServices,
} from './database-automation-execution-services';
import {
  emitDatabaseAutomationDeliveryEvent,
} from './database-automation-observability';

interface InstallAppDatabaseAutomationDispatcherOptions {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly manager: DatabaseManager;
  readonly automations: ManagedAppDatabaseAutomations;
  readonly actorRegistry: DatabaseAutomationRegistry | null;
  readonly observability: PlatformObservabilityRuntime;
}

/** Install recovery only when at least one configured plane has a durable outbox. */
export function installAppDatabaseAutomationDispatcher(
  options: InstallAppDatabaseAutomationDispatcherOptions,
): DatabaseAutomationDispatcher<
  DatabaseAutomationExecutionServerServices
> | null {
  const catalog = options.automations.catalog;
  if (!catalog) return null;

  const dispatcher = new DatabaseAutomationDispatcher<
    DatabaseAutomationExecutionServerServices
  >({
    catalog,
    leaseOwner: `dba:${crypto.randomUUID()}`,
    acquire: createAppDatabaseAutomationSourceAcquirer({
      runtime: options.runtime,
      manager: options.manager,
      automations: options.automations,
      actorRegistry: options.actorRegistry,
    }),
    emit: (source, event) => emitDatabaseAutomationDeliveryEvent(
      options.observability,
      source,
      event,
    ),
    onError: (error) => emitPlatformCodeTo(
      options.observability,
      OBS_CODES.DATABASE_AUTOMATION_DISPATCH_FAILED,
      { error },
    ),
  });
  let started = false;

  options.app.onStart(() => {
    dispatcher.start();
    started = true;
    emitPlatformCodeTo(
      options.observability,
      OBS_CODES.DATABASE_AUTOMATION_DISPATCHER_STARTED,
    );
  });
  options.runtime.addCleanup(async () => {
    await dispatcher.close();
    if (started) {
      emitPlatformCodeTo(
        options.observability,
        OBS_CODES.DATABASE_AUTOMATION_DISPATCHER_STOPPED,
      );
    }
  });
  return dispatcher;
}

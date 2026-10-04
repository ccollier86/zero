/** Trusted source acquisition for the managed ReactiveDB automation host. */

import type {
  DatabaseAutomationAcquiredSource,
} from '../../database-automations/database-automation-dispatcher';
import type {
  DatabaseAutomationSourceRecord,
} from '../../database-automations/automation-source-catalog-contract';
import type {
  DatabaseAutomationRegistry,
} from '../../database-automations/database-automations';
import {
  createPinnedDatabaseAutomationDeliverySource,
} from '../../database-automations/database-automation-pinned-source';
import { createDatabaseRef } from '../../databases/database-file';
import {
  acquireDatabaseAutomationSourceForRecovery,
  assertDatabaseAutomationSourceAuthorityCurrent,
  type DatabaseManager,
} from '../../databases/database-manager';
import {
  createCoordinatorDatabaseAutomationDeliverySource,
} from '../../databases/database-coordinator-automation-delivery-source';
import { DatabaseError } from '../../databases/database-error';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import type { ManagedAppDatabaseAutomations } from './app-database-automations';
import {
  createDatabaseAutomationExecutionServiceProvider,
  type DatabaseAutomationExecutionServerServices,
} from './database-automation-execution-services';

export interface AppDatabaseAutomationSourceAcquirerOptions {
  readonly runtime: ZeroAppRuntime;
  readonly manager: DatabaseManager;
  readonly automations: ManagedAppDatabaseAutomations;
  readonly actorRegistry: DatabaseAutomationRegistry | null;
}

/** Build one exact, catalog-fenced source acquirer for the host dispatcher. */
export function createAppDatabaseAutomationSourceAcquirer(
  options: AppDatabaseAutomationSourceAcquirerOptions,
): (
  source: DatabaseAutomationSourceRecord,
) => Promise<DatabaseAutomationAcquiredSource<
  DatabaseAutomationExecutionServerServices
>> {
  return async (source) => {
    assertDatabaseAutomationSourceAuthorityCurrent(options.manager, source);
    const services = createDatabaseAutomationExecutionServiceProvider({
      source,
      runtime: options.runtime,
      assertCurrentAuthority: () =>
        assertDatabaseAutomationSourceAuthorityCurrent(options.manager, source),
    });

    if (source.sourceKind === 'application') {
      const application = options.automations.application;
      const registry = options.automations.applicationRegistry;
      if (source.sourceRef !== createDatabaseRef('default')
        || source.logicalSourceId !== 'application'
        || !application
        || !registry) {
        throw sourceUnavailable('Application automation source is unavailable.');
      }
      return Object.freeze({
        delivery: createPinnedDatabaseAutomationDeliverySource(application, {
          establishClaimDurability: () => establishPinnedClaimDurability(
            options.manager,
          ),
        }),
        registry,
        services,
        release: () => undefined,
      });
    }

    if (!options.actorRegistry) {
      throw sourceUnavailable('Fabric automation registry is unavailable.');
    }
    const lease = await acquireDatabaseAutomationSourceForRecovery(
      options.manager,
      source,
    );
    if (!lease) {
      throw sourceUnavailable('Catalogued automation source is not ready.');
    }
    try {
      return Object.freeze({
        delivery: createCoordinatorDatabaseAutomationDeliverySource(lease),
        registry: options.actorRegistry,
        services,
        release: () => lease.release(),
      });
    } catch (cause) {
      try {
        await lease.release();
      } catch (cleanupCause) {
        throw new DatabaseError(
          'DATABASE_EXECUTOR_FAILED',
          'Database automation source acquisition cleanup failed.',
          {
            cause: new AggregateError(
              [cause, cleanupCause],
              'Database automation source acquisition and cleanup failed.',
            ),
            retryable: false,
            outcome: 'unknown',
          },
        );
      }
      throw cause;
    }
  };
}

/** A hot pinned claim must reach its snapshot before host effects are exposed. */
function establishPinnedClaimDurability(manager: DatabaseManager): void {
  const sqlite = manager.appRuntime.sqlite;
  if (sqlite.mode !== 'hot') return;
  try {
    const snapshot = sqlite.snapshot;
    if (!snapshot?.isEnabled) {
      throw new Error('Hot application snapshot boundary is unavailable.');
    }
    const result = snapshot.snapshotSyncDetailed();
    if (result.status !== 'written') {
      throw result.status === 'failed'
        ? result.error
        : new Error('Hot application claim snapshot was not written.');
    }
  } catch (cause) {
    throw new DatabaseError(
      'DATABASE_OUTCOME_UNKNOWN',
      'Hot application automation claim durability is unknown.',
      { cause, retryable: false, outcome: 'unknown' },
    );
  }
}

function sourceUnavailable(message: string): DatabaseError {
  return new DatabaseError('DATABASE_NOT_READY', message, {
    retryable: true,
    outcome: 'not-started',
    details: { component: 'database-automation-dispatcher' },
  });
}

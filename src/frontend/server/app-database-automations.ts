/** Managed construction for pinned and Fabric ReactiveDB automations. */

import {
  DatabaseAutomationRuntime,
} from '../../database-automations/database-automation-runtime';
import {
  DatabaseAutomationSourceCatalog,
} from '../../database-automations/automation-source-catalog-store';
import type { DatabaseAutomationRegistry } from '../../database-automations/database-automations';
import type { DatabaseRuntime } from '../../databases/database-runtime';
import { DatabaseError } from '../../databases/database-error';
import { createDatabaseRef } from '../../databases/database-file';
import type { ResolvedConfig } from './types';

export interface ManagedAppDatabaseAutomations {
  readonly application: DatabaseAutomationRuntime | null;
  readonly applicationRegistry: DatabaseAutomationRegistry | null;
  readonly catalog: DatabaseAutomationSourceCatalog | null;
}

/** Release partially or fully constructed automation ownership exactly once. */
export function closeManagedAppDatabaseAutomations(
  automations: ManagedAppDatabaseAutomations,
): void {
  const failures: unknown[] = [];
  try {
    automations.application?.close();
  } catch (error) {
    failures.push(error);
  }
  try {
    automations.catalog?.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'Managed database automation cleanup failed.',
    );
  }
}

/**
 * Install transaction interception before the application database is
 * published. A source catalog exists only when at least one plane can enqueue
 * durable work.
 */
export function createManagedAppDatabaseAutomations(input: {
  readonly config: ResolvedConfig;
  readonly systemRuntime: DatabaseRuntime;
  readonly applicationRuntime: DatabaseRuntime;
}): ManagedAppDatabaseAutomations {
  const applicationRegistry = input.config.databaseAutomations ?? null;
  const actorRegistry = input.config.databaseTopology.mode === 'multiple'
    ? input.config.databaseTopology.realm.automations ?? null
    : null;
  const applicationDurable = hasDurableFunctions(applicationRegistry);
  const actorDurable = hasDurableFunctions(actorRegistry);
  let catalog: DatabaseAutomationSourceCatalog | null = null;
  let application: DatabaseAutomationRuntime | null = null;

  try {
    if ((applicationDurable || actorDurable)
      && input.systemRuntime.sqlite.mode === 'ephemeral') {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Durable database functions require a crash-durable system database for source recovery.',
        {
          retryable: false,
          outcome: 'not-started',
          details: { component: 'database-automations' },
        },
      );
    }
    if (applicationDurable
      && input.applicationRuntime.sqlite.mode === 'hot'
      && !input.applicationRuntime.sqlite.snapshot?.isEnabled) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Durable application database functions require hot snapshots to be enabled.',
        {
          retryable: false,
          outcome: 'not-started',
          details: { component: 'database-automations' },
        },
      );
    }
    if (applicationDurable || actorDurable) {
      catalog = new DatabaseAutomationSourceCatalog({
        runtime: input.systemRuntime,
      });
    }
    if (applicationRegistry) {
      application = new DatabaseAutomationRuntime({
        db: input.applicationRuntime.db,
        registry: applicationRegistry,
        realmName: 'application',
        // The pinned application database has no actor realm. Its admitted
        // automation manifest is the exact execution-relevant realm identity.
        realmFingerprint: applicationRegistry.fingerprint,
        storageMode: input.applicationRuntime.sqlite.mode,
        outbox: { enabled: applicationDurable },
      });
    }
    if (applicationDurable) {
      catalog!.register({
        sourceRef: createDatabaseRef('default'),
        sourceKind: 'application',
        logicalSourceId: 'application',
        authority: {
          scopeKind: 'application',
          scopeId: 'application',
          tenantId: null,
        },
      });
    }
    return Object.freeze({
      application,
      applicationRegistry,
      catalog,
    });
  } catch (error) {
    let cleanupFailure: unknown | null = null;
    try {
      closeManagedAppDatabaseAutomations({
        application,
        applicationRegistry,
        catalog,
      });
    } catch (cleanupError) {
      cleanupFailure = cleanupError;
    }
    if (cleanupFailure === null) throw error;
    throw new AggregateError(
      [error, cleanupFailure],
      'Database automation startup and cleanup failed.',
    );
  }
}

function hasDurableFunctions(
  registry: DatabaseAutomationRegistry | null,
): boolean {
  return registry?.listFunctions().some(({ mode }) => mode === 'durable') ?? false;
}

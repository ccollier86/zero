/**
 * database-actor-bootstrap.ts
 *
 * Dedicated-process bootstrap for the database actor server. Importing this
 * module has no side effects; ambient observability is muted only while the
 * explicitly invoked subprocess session is running and is restored afterward.
 */

import {
  getPlatformSink,
  setPlatformSink,
  type PlatformSink,
} from '../observability';
import {
  DATABASE_ACTOR_CHILD_FLAG,
  normalizeDatabaseActorFlag,
  parseDatabaseActorInvocation,
} from './database-actor-entry-contract';
import { DatabaseError } from './database-error';
import type { DatabaseRealm } from './database-realm';
import {
  createDatabaseActorServer,
  type DatabaseActorRuntime,
  type DatabaseActorServerOptions,
} from './database-actor-runtime';
import type { SubprocessDatabaseServer } from './subprocess-database-server';

const SILENT_ACTOR_SINK: PlatformSink = Object.freeze({ emit() {} });

export interface RunDatabaseActorSubprocessOptions
  extends Omit<DatabaseActorServerOptions, 'realm' | 'transport'> {
  /** Load the app realm from code bundled/imported by this child entrypoint. */
  readonly loadRealm: () => DatabaseRealm | Promise<DatabaseRealm>;
  /** Default true: do not emit path-bearing platform events from the child. */
  readonly suppressAmbientObservability?: boolean;
}

export interface RunningDatabaseActorSubprocess {
  readonly actor: DatabaseActorRuntime;
  readonly server: SubprocessDatabaseServer;
}

export interface RunDatabaseActorIfRequestedOptions {
  /** Realm imported by this same application entry in the actor process. */
  readonly realm: DatabaseRealm;
  /** Full process argument vector. Defaults to process.argv. */
  readonly argv?: readonly string[];
  /** Private marker shared with the parent command factory. */
  readonly actorFlag?: string;
  readonly maxInFlight?: number;
  /** Default true: suppress path-bearing ambient events inside actor children. */
  readonly suppressAmbientObservability?: boolean;
}

/**
 * Run the database actor branch of a shared application entrypoint.
 *
 * Returns false only when the private marker is absent. Once the marker is
 * present, malformed arguments or a missing Bun parent IPC channel fail
 * closed, so callers can safely gate normal startup with:
 *
 * `if (!await runDatabaseActorIfRequested({ realm })) await startApp()`
 */
export async function runDatabaseActorIfRequested(
  options: RunDatabaseActorIfRequestedOptions,
): Promise<boolean> {
  const actorFlag = normalizeDatabaseActorFlag(
    options.actorFlag ?? DATABASE_ACTOR_CHILD_FLAG,
  );
  const invocation = parseDatabaseActorInvocation(
    options.argv ?? process.argv,
    actorFlag,
  );
  if (!invocation) return false;

  if (typeof Bun !== 'object'
    || typeof process.send !== 'function'
    || process.connected !== true) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_START_FAILED',
      'Database actor requires a Bun parent IPC channel.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  if (options.maxInFlight !== undefined
    && (!Number.isSafeInteger(options.maxInFlight)
      || options.maxInFlight <= 0)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database actor launch configuration is invalid.',
    );
  }
  if (options.suppressAmbientObservability !== undefined
    && typeof options.suppressAmbientObservability !== 'boolean') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database actor launch configuration is invalid.',
    );
  }

  try {
    await runDatabaseActorSubprocess({
      role: invocation.role,
      slot: invocation.slot,
      loadRealm: () => options.realm,
      ...(options.maxInFlight === undefined
        ? {}
        : { maxInFlight: options.maxInFlight }),
      ...(options.suppressAmbientObservability === undefined
        ? {}
        : {
            suppressAmbientObservability:
              options.suppressAmbientObservability,
          }),
    });
    return true;
  } catch (error) {
    if (error instanceof DatabaseError) throw error;
    throw new DatabaseError(
      'DATABASE_EXECUTOR_START_FAILED',
      'Database actor could not start.',
      { retryable: false, outcome: 'not-started' },
    );
  }
}

/**
 * Run one actor over the Bun IPC channel until its parent shuts it down.
 *
 * Realm functions are intentionally loaded in the child and never serialized.
 * This helper is for a dedicated child entrypoint; direct/same-process tests
 * should construct DatabaseActorRuntime or createDatabaseActorServer instead.
 */
export async function runDatabaseActorSubprocess(
  options: RunDatabaseActorSubprocessOptions,
): Promise<RunningDatabaseActorSubprocess> {
  const suppress = options.suppressAmbientObservability ?? true;
  const previousSink = suppress ? getPlatformSink() : null;
  if (suppress) setPlatformSink(SILENT_ACTOR_SINK);
  try {
    const realm = await options.loadRealm();
    const created = createDatabaseActorServer({
      role: options.role,
      slot: options.slot,
      realm,
      ...(options.maxInFlight === undefined
        ? {}
        : { maxInFlight: options.maxInFlight }),
    });
    await created.server.run();
    return created;
  } finally {
    if (previousSink) setPlatformSink(previousSink);
  }
}

/**
 * database-actor-binding.ts
 *
 * Owns actor-local SQLite binding acquisition, physical/logical identity
 * verification, hot durability, and ordered release. Dispatch and IPC remain
 * in database-actor-runtime.ts.
 */

import { createPlatformSQLiteService } from '../persistence';
import { DatabaseError } from './database-error';
import { DatabaseActorAutomationSession } from './database-actor-automation-session';
import { DatabaseActorAuthorityCommitGuard } from './database-actor-authority-commit-guard';
import {
  acquireDatabaseActorLiveness,
  type DatabaseActorLivenessGuard,
} from './database-actor-liveness';
import {
  prepareDatabaseBindingIdentity,
  readDatabaseBindingIdentity,
  type DatabaseBindingIdentity,
} from './database-binding-identity';
import type {
  DatabaseActorBindPayload,
  DatabaseActorPlacementConfig,
} from './database-actor-protocol';
import { writerOpenFailed } from './database-actor-error-boundary';
import type { DatabaseRef } from './database-file';
import {
  openDatabaseFileIdentityGuard,
  type DatabaseFileIdentityGuard,
  type DatabaseFileIdentityProof,
} from './database-file-identity';
import {
  createDatabaseRealmOperationCatalog,
  type DatabaseRealm,
} from './database-realm';
import { DatabaseReaderRuntime } from './database-reader-runtime';
import { DatabaseRuntime } from './database-runtime';
import { DatabaseTenantSyncSnapshotSessionStore } from './database-tenant-sync-snapshot-session';
import { DatabaseWriterOperationEngine } from './database-writer-engine';
import { identityAnchorReactiveTableSchemas } from '../auth/identity-projection-reactive-schema';
import { defineIdentityAnchorSQLiteTables } from '../auth/identity-projection-schema';
import { hasGuardianPresenceRealm } from '../presence/presence-realm';
import { PRESENCE_PROJECTION_SCHEMAS, registerPresenceProjectionTables } from '../presence/presence-schema';
import { presenceProjectionSchemaReady } from '../presence/presence-projection-schema';
import {
  inspectGuardianReferenceSchema,
  type GuardianReferenceSchemaReader,
} from '../schema/guardian-references';

export interface DatabaseActorWriterBinding {
  readonly role: 'writer';
  readonly databaseRef: DatabaseRef;
  readonly placement: DatabaseActorPlacementConfig;
  readonly runtime: DatabaseRuntime;
  readonly engine: DatabaseWriterOperationEngine;
  readonly automationSession: DatabaseActorAutomationSession | null;
  readonly authorityCommitGuard: DatabaseActorAuthorityCommitGuard | null;
  readonly snapshotSessions: DatabaseTenantSyncSnapshotSessionStore;
  readonly openedFileIdentity: DatabaseFileIdentityProof;
  readonly bindingIdentity: DatabaseBindingIdentity;
  readonly livenessGuard: DatabaseActorLivenessGuard;
  fileGuard: DatabaseFileIdentityGuard | null;
}

export interface DatabaseActorReaderBinding {
  readonly role: 'reader';
  readonly databaseRef: DatabaseRef;
  readonly placement: DatabaseActorPlacementConfig;
  readonly runtime: DatabaseReaderRuntime;
  readonly openedFileIdentity: DatabaseFileIdentityProof;
  readonly bindingIdentity: DatabaseBindingIdentity;
  readonly livenessGuard: DatabaseActorLivenessGuard;
  fileGuard: DatabaseFileIdentityGuard;
}

export interface DatabaseActorHotSnapshotCallbacks {
  readonly onStart: () => void;
  readonly onFinish: () => void;
  readonly onDirty: () => void;
  readonly onClean: () => void;
  readonly onFailure: () => void;
}

export type DatabaseActorBinding =
  | DatabaseActorWriterBinding
  | DatabaseActorReaderBinding;

/** Open and verify the sole writer binding for an actor generation. */
export function openWriterBinding(
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
  callbacks: DatabaseActorHotSnapshotCallbacks,
): DatabaseActorWriterBinding {
  const { ringBufferDepth, ...sqliteOptions } = payload.sqlite;
  let sqlite: ReturnType<typeof createPlatformSQLiteService> | null = null;
  let runtime: DatabaseRuntime | null = null;
  let engine: DatabaseWriterOperationEngine | null = null;
  let automationSession: DatabaseActorAutomationSession | null = null;
  let authorityCommitGuard: DatabaseActorAuthorityCommitGuard | null = null;
  let snapshotSessions: DatabaseTenantSyncSnapshotSessionStore | null = null;
  let livenessGuard: DatabaseActorLivenessGuard | null = null;
  let fileGuard: DatabaseFileIdentityGuard | null = null;
  let openedFileIdentity: DatabaseFileIdentityProof | null = null;
  try {
    livenessGuard = acquireDatabaseActorLiveness(payload.actorLiveness);
    fileGuard = openDatabaseFileIdentityGuard(payload.filePath, {
      access: 'readwrite',
      expected: payload.fileIdentity,
    });
    openedFileIdentity = fileGuard.proof;
    sqlite = createPlatformSQLiteService({
      mode: payload.placement.mode,
      path: payload.filePath,
      ...(payload.placement.mode === 'hot'
        ? {
            snapshotPath: payload.filePath,
            snapshotEnabled: true,
            hotMaxBytes: payload.placement.maxBytes,
            ...(payload.placement.durability === 'periodic'
              ? { snapshotIntervalMs: payload.placement.snapshotIntervalMs }
              : {}),
          }
        : {}),
      emitTelemetry: false,
      ...sqliteOptions,
    }, payload.placement.mode === 'hot'
      && payload.placement.durability === 'periodic'
      ? {
          onPeriodicSnapshotStart: callbacks.onStart,
          onPeriodicSnapshotFinish: callbacks.onFinish,
          onPeriodicDurabilityDirty: callbacks.onDirty,
          onPeriodicDurabilityClean: callbacks.onClean,
          onPeriodicSnapshotFailure: callbacks.onFailure,
          periodicSnapshotTimeoutMs: payload.placement.snapshotTimeoutMs,
        }
      : {});
    // Bun SQLite accepts only a pathname. Retain the no-follow descriptor and
    // compare again immediately after open to close ordinary swap/rename races.
    fileGuard.assertCurrent();
    let bindingIdentity = readDatabaseBindingIdentity(
      sqlite.raw,
      payload.databaseRef,
      realm.name,
    );
    if (bindingIdentity.instanceId !== payload.instanceId) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database writer binding identity does not match.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    if (realm.guardianAnchorRequirements.length > 0) {
      // Framework FK anchors must exist before realm tables are prepared and
      // before any reader generation can observe this database schema.
      defineIdentityAnchorSQLiteTables(sqlite.raw);
    }
    runtime = DatabaseRuntime.open({
      id: payload.databaseRef,
      role: 'named',
      sqlite,
      ownsSQLite: true,
      ...(ringBufferDepth === undefined
        ? {}
        : { reactive: { ringBufferDepth } }),
      migrations: realm.migrations,
      migrate: true,
      tables: {
        ...identityAnchorReactiveTableSchemas(realm.guardianAnchorRequirements),
        ...realm.tables,
      },
      migrationLog: () => undefined,
    });
    assertActorGuardianReferenceStorage(runtime.sqlite.raw, realm);
    if (hasGuardianPresenceRealm(realm)) {
      if (!presenceProjectionSchemaReady(runtime.db)) throw new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Guardian presence projection schema is incompatible.');
      registerPresenceProjectionTables(runtime.db);
    }
    bindingIdentity = readDatabaseBindingIdentity(
      runtime.sqlite.raw,
      payload.databaseRef,
      realm.name,
    );
    if (bindingIdentity.instanceId !== payload.instanceId) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database writer binding identity changed during startup.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    if (payload.placement.mode === 'hot') {
      // Migration durability atomically replaces the snapshot path. Verify the
      // newly published image against the immutable logical binding before the
      // admitted source descriptor is released.
      fileGuard = replaceHotFileGuard(
        fileGuard,
        payload,
        realm,
        bindingIdentity,
      );
    } else {
      fileGuard.assertCurrent();
    }
    engine = new DatabaseWriterOperationEngine({ runtime, realm });
    snapshotSessions = new DatabaseTenantSyncSnapshotSessionStore({
      runtime,
      catalog: createDatabaseRealmOperationCatalog(realm),
    });
    if (payload.placement.mode === 'file'
      || payload.placement.durability === 'periodic') {
      runtime.start();
    }
    automationSession = realm.automations
      ? new DatabaseActorAutomationSession({
          db: runtime.db,
          registry: realm.automations,
          realmName: realm.name,
          realmFingerprint: realm.fingerprint,
          storageMode: payload.placement.mode,
          readOnlyTables: [...Object.keys(
            identityAnchorReactiveTableSchemas(realm.guardianAnchorRequirements),
          ), ...Object.keys(PRESENCE_PROJECTION_SCHEMAS), '_guardian_presence_projection_binding', 'guardian_presence_current'],
        })
      : null;
    // Runtime startup may perform framework-owned maintenance transactions.
    // Install the request revision guard only after startup is complete so no
    // maintenance write can inherit or require ambient request authority.
    authorityCommitGuard = payload.authorityCommitFence
      ? DatabaseActorAuthorityCommitGuard.open(
          runtime.db,
          payload.authorityCommitFence,
        )
      : null;
    return {
      role: 'writer',
      databaseRef: payload.databaseRef,
      placement: payload.placement,
      runtime,
      engine,
      automationSession,
      authorityCommitGuard,
      snapshotSessions,
      openedFileIdentity: openedFileIdentity,
      bindingIdentity,
      livenessGuard,
      fileGuard,
    };
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    // Remove request authority before framework-owned snapshot cleanup opens
    // its own maintenance transaction. No request revision may leak into or
    // be required by binding teardown.
    if (authorityCommitGuard) {
      attemptClose(() => authorityCommitGuard!.close(), cleanupFailures);
    }
    if (snapshotSessions) {
      attemptClose(() => snapshotSessions!.close(), cleanupFailures);
    }
    if (automationSession) {
      attemptClose(() => automationSession!.close(), cleanupFailures);
    }
    if (engine) attemptClose(() => engine!.close(), cleanupFailures);
    if (runtime) {
      attemptClose(() => runtime!.close(), cleanupFailures);
    } else if (sqlite) {
      // DatabaseRuntime.open owns startup cleanup. Retrying its discard-only
      // boundary is safe after a partial abort; normal close could publish a
      // rejected hot image or checkpoint partially initialized work.
      attemptClose(() => sqlite!.abort(), cleanupFailures);
    }
    if (cleanupFailures.length === 0 && fileGuard) {
      attemptClose(() => fileGuard!.release(), cleanupFailures);
    }
    if (cleanupFailures.length === 0 && livenessGuard) {
      attemptClose(() => livenessGuard!.release(), cleanupFailures);
    }
    if (cleanupFailures.length > 0 || error instanceof AggregateError) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database writer actor startup cleanup failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    if (error instanceof DatabaseError) throw error;
    throw writerOpenFailed(error);
  }
}

/** Reject an existing actor image whose Guardian metadata and SQLite FKs diverge. */
function assertActorGuardianReferenceStorage(
  database: GuardianReferenceSchemaReader,
  realm: DatabaseRealm,
): void {
  for (const [table, schema] of Object.entries(realm.tables)) {
    const issue = inspectGuardianReferenceSchema(schema, {
      database,
      tableName: table,
    })[0];
    if (!issue) continue;
    throw new DatabaseError(
      'DATABASE_SCHEMA_MISMATCH',
      'Database actor Guardian reference schema does not match its configured realm.',
      {
        retryable: false,
        outcome: 'not-started',
        details: {
          component: 'guardian-identity-projection',
          reason: 'reference-storage-invalid',
          table,
          field: issue.field,
          issue: issue.code,
        },
      },
    );
  }
}

/** Open and verify a read-only file/WAL binding. */
export function openReaderBinding(
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
): DatabaseActorReaderBinding {
  let livenessGuard: DatabaseActorLivenessGuard | null = null;
  let fileGuard: DatabaseFileIdentityGuard | null = null;
  let runtime: DatabaseReaderRuntime | null = null;
  try {
    livenessGuard = acquireDatabaseActorLiveness(payload.actorLiveness);
    fileGuard = openDatabaseFileIdentityGuard(payload.filePath, {
      access: 'read',
      expected: payload.fileIdentity,
    });
    runtime = DatabaseReaderRuntime.open({
      filePath: payload.filePath,
      realm,
      databaseRef: payload.databaseRef,
      instanceId: payload.instanceId,
      ...(payload.sqlite.busyTimeout === undefined
        ? {}
        : { busyTimeoutMs: payload.sqlite.busyTimeout }),
    });
    fileGuard.assertCurrent();
    return {
      role: 'reader',
      databaseRef: payload.databaseRef,
      placement: payload.placement,
      runtime,
      openedFileIdentity: fileGuard.proof,
      bindingIdentity: runtime.bindingIdentity,
      livenessGuard,
      fileGuard,
    };
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    if (runtime) attemptClose(() => runtime!.close(), cleanupFailures);
    if (cleanupFailures.length === 0 && fileGuard) {
      attemptClose(() => fileGuard!.release(), cleanupFailures);
    }
    if (cleanupFailures.length === 0 && livenessGuard) {
      attemptClose(() => livenessGuard!.release(), cleanupFailures);
    }
    if (cleanupFailures.length > 0) {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database reader actor startup cleanup failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    throw error;
  }
}

/** Establish the first durable image before publishing a hot binding. */
export function establishInitialHotDurability(
  binding: DatabaseActorBinding,
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
): void {
  if (binding.role !== 'writer' || binding.placement.mode !== 'hot') return;
  const result = binding.runtime.sqlite.snapshot?.snapshotSyncDetailed();
  if (result?.status !== 'written') {
    throw new DatabaseError(
      'DATABASE_OPEN_FAILED',
      'Hot database actor could not establish its initial durability boundary.',
      { retryable: true, outcome: 'not-started' },
    );
  }
  binding.fileGuard = replaceHotFileGuard(
    binding.fileGuard,
    payload,
    realm,
    binding.bindingIdentity,
  );
}

/** Release the verified final readiness-image proof immediately before publish. */
export function releaseHotOpenedFileGuard(binding: DatabaseActorBinding): void {
  if (binding.role !== 'writer'
    || binding.placement.mode !== 'hot'
    || !binding.fileGuard) return;
  binding.fileGuard.assertCurrent();
  binding.fileGuard.release();
  binding.fileGuard = null;
}

/** Enforce the configured hot durability boundary for one fresh write. */
export function establishHotWriteDurability(
  binding: DatabaseActorBinding,
  replayed: boolean,
): void {
  if (replayed || binding.role !== 'writer' || binding.placement.mode !== 'hot') {
    return;
  }
  try {
    if (binding.placement.durability === 'on-write') {
      const result = binding.runtime.sqlite.snapshot?.snapshotSyncDetailed();
      if (result?.status !== 'written') throw result?.status === 'failed'
        ? result.error
        : new Error('Hot database snapshot did not establish durability.');
    } else {
      if (hotImageBytes(binding.runtime) > binding.placement.maxBytes) {
        throw new RangeError('Hot database exceeds its configured memory bound.');
      }
      if (binding.placement.durability === 'periodic') {
        const snapshot = binding.runtime.sqlite.snapshot;
        if (!snapshot) {
          throw new Error('Periodic hot database is missing its snapshot boundary.');
        }
        snapshot.recordPeriodicCommit();
        if (snapshot.requiresPeriodicWriteFence()) {
          const result = snapshot.snapshotSyncDetailed();
          if (result.status !== 'written') throw result.status === 'failed'
            ? result.error
            : new Error('Periodic hot snapshot did not establish durability.');
        }
      }
    }
  } catch (error) {
    throw new DatabaseError(
      'DATABASE_OUTCOME_UNKNOWN',
      'Hot database commit could not establish its configured durability boundary.',
      {
        cause: error,
        retryable: false,
        outcome: 'unknown',
      },
    );
  }
}

/** Compare exact actor placement proofs. */
export function sameActorPlacement(
  left: DatabaseActorPlacementConfig,
  right: DatabaseActorPlacementConfig,
): boolean {
  return left.mode === right.mode
    && (left.mode === 'file'
      || (right.mode === 'hot'
        && left.durability === right.durability
        && left.maxBytes === right.maxBytes
        && left.snapshotIntervalMs === right.snapshotIntervalMs
        && left.snapshotTimeoutMs === right.snapshotTimeoutMs));
}

/** Close database ownership in strict order and release restart fencing last. */
export function closeActorBinding(binding: DatabaseActorBinding): void {
  const failures: unknown[] = [];
  if (binding.role === 'writer') {
    // Teardown transactions are framework reconciliation, not request data
    // commits. Detach the per-request authority guard first so cleanup cannot
    // inherit stale or absent ambient request state.
    if (binding.authorityCommitGuard) {
      attemptClose(() => binding.authorityCommitGuard!.close(), failures);
    }
    attemptClose(() => binding.snapshotSessions.close(), failures);
    if (binding.automationSession) {
      attemptClose(() => binding.automationSession!.close(), failures);
    }
    attemptClose(() => binding.engine.close(), failures);
    attemptClose(() => binding.runtime.close(), failures);
  } else {
    attemptClose(() => binding.runtime.close(), failures);
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Database actor binding cleanup failed.');
  }
  if (binding.fileGuard) {
    binding.fileGuard.release();
    if (binding.role === 'writer') binding.fileGuard = null;
  }
  // A replacement coordinator remains fenced until every handle and retained
  // physical proof is settled.
  binding.livenessGuard.release();
}

/** Read the durable sequence published by either binding role. */
export function actorBindingSequence(binding: DatabaseActorBinding): number {
  return binding.role === 'writer'
    ? binding.runtime.db.currentSeq
    : binding.runtime.currentSeq;
}

function openPublishedHotBindingGuard(
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
  expected: DatabaseBindingIdentity,
): DatabaseFileIdentityGuard {
  const guard = openDatabaseFileIdentityGuard(payload.filePath, {
    access: 'readwrite',
  });
  try {
    const published = prepareDatabaseBindingIdentity({
      filePath: payload.filePath,
      fileIdentity: guard.proof,
      databaseRef: payload.databaseRef,
      realmName: realm.name,
      initialize: false,
    });
    guard.assertCurrent();
    if (published.instanceId !== expected.instanceId
      || published.instanceId !== payload.instanceId) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Published hot database binding identity does not match.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    return guard;
  } catch (error) {
    guard.release();
    throw error;
  }
}

/**
 * Replace one retained hot-image proof without ever leaving startup unguarded.
 * The old descriptor remains open until the newly published inode and logical
 * binding have both been verified.
 */
function replaceHotFileGuard(
  previous: DatabaseFileIdentityGuard | null,
  payload: DatabaseActorBindPayload,
  realm: DatabaseRealm,
  expected: DatabaseBindingIdentity,
): DatabaseFileIdentityGuard {
  const next = openPublishedHotBindingGuard(payload, realm, expected);
  if (!previous) return next;
  try {
    previous.release();
    return next;
  } catch (error) {
    try {
      next.release();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Database hot-image proof replacement failed.',
      );
    }
    throw error;
  }
}

function hotImageBytes(runtime: DatabaseRuntime): number {
  const pageCount = runtime.sqlite.raw.query('PRAGMA page_count').get() as {
    page_count?: unknown;
  } | null;
  const pageSize = runtime.sqlite.raw.query('PRAGMA page_size').get() as {
    page_size?: unknown;
  } | null;
  if (!Number.isSafeInteger(pageCount?.page_count)
    || !Number.isSafeInteger(pageSize?.page_size)) {
    throw new Error('Hot database did not report a bounded image size.');
  }
  const bytes = (pageCount!.page_count as number) * (pageSize!.page_size as number);
  return Number.isSafeInteger(bytes) ? bytes : Number.MAX_SAFE_INTEGER;
}

function attemptClose(close: () => void, failures: unknown[]): void {
  try {
    close();
  } catch (error) {
    failures.push(error);
  }
}

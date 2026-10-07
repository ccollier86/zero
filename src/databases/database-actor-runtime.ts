/**
 * database-actor-runtime.ts
 *
 * Actor-local binding and dispatch for exactly one database file at a time.
 * The parent supplies a physical path only to the trusted bind operation; all
 * later commands are authorized solely by the opaque bound database reference.
 */

import { DatabaseError } from './database-error';
import { hasGuardianPresenceRealm } from '../presence/presence-realm';
import { PresenceProjectionStore } from '../presence/presence-projection-store';
import { validateDatabasePresenceProjectionPayload } from './database-presence-projection-protocol';
import type { PresenceProjectionReceipt } from '../presence/presence-publication';
import { createTenantDatabaseRef } from './database-binding-ref';
import {
  establishHotAutomationClaimDurability,
} from './database-actor-automation-durability';
import {
  databaseActorAutomationOperationKind,
} from './database-actor-automation-session';
import {
  DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
  validateDatabaseActorAutomationOutboxPayload,
  type DatabaseActorAutomationOutboxResult,
} from './database-automation-actor-protocol';
import {
  actorBindingSequence,
  closeActorBinding,
  establishHotWriteDurability,
  establishInitialHotDurability,
  openReaderBinding,
  openWriterBinding,
  releaseHotOpenedFileGuard,
  sameActorPlacement,
  type DatabaseActorBinding,
  type DatabaseActorWriterBinding,
} from './database-actor-binding';
import {
  asExecutorValue,
  invalidActorResult,
  privacySafeActorError,
  validateBindResult,
} from './database-actor-error-boundary';
import {
  DATABASE_ACTOR_OPERATIONS,
  validateDatabaseActorBindPayload,
  validateDatabaseActorBindResult,
  validateDatabaseActorExecutePayload,
  validateDatabaseActorFindReceiptPayload,
  validateDatabaseActorReplayPayload,
  validateDatabaseActorUnbindPayload,
  type DatabaseActorBindResult,
  type DatabaseActorPlacementConfig,
  type DatabaseActorRole,
} from './database-actor-protocol';
import type { DatabaseRef } from './database-file';
import { sameDatabaseFileIdentity } from './database-file-identity';
import {
  createDatabaseSequenceToken,
  type DatabaseOperation,
  type DatabaseWriteOperation,
} from './database-operations';
import {
  attachDatabaseActorReceiptCompaction,
  validateDatabaseActorExecuteResult,
  validateDatabaseActorReplayResult,
  validateDatabaseActorTrustedWriteResult,
} from './database-actor-result-validation';
import { createDatabaseRealmOperationCatalog, type DatabaseRealm } from './database-realm';
import {
  type DatabaseChangeReplayResult,
} from './database-writer-engine';
import {
  validateDatabaseActorTenantSyncSnapshotAbortPayload,
  validateDatabaseActorTenantSyncSnapshotBeginPayload,
  validateDatabaseActorTenantSyncSnapshotPagePayload,
  type DatabaseActorTenantSyncSnapshotAbortResult,
  type DatabaseActorTenantSyncSnapshotBeginResult,
  type DatabaseActorTenantSyncSnapshotPageResult,
} from './database-tenant-sync-snapshot-protocol';
import type {
  DatabaseExecutorEvent,
  DatabaseExecutorOperationKind,
  DatabaseExecutorValue,
} from './database-executor';
import type { DatabaseTrustedReceiptLookup } from './database-trusted-writer';
import {
  DatabaseIdentityProjectionActorSession,
  validateDatabaseIdentityProjectionPayload,
  type DatabaseIdentityProjectionResult,
} from './database-identity-projection-actor';
import {
  SubprocessDatabaseServer,
  type DatabaseExecutorServerRequest,
  type SubprocessDatabaseServerOptions,
} from './subprocess-database-server';

const REALM_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SCHEMA_CHECKSUM_PATTERN = /^[0-9a-f]{64}$/u;
const ACTOR_CLOSE_RETRY_DELAYS_MS = Object.freeze([25, 50, 100, 200, 400]);

export type DatabaseActorRuntimeState =
  | 'unbound'
  | 'bound'
  | 'closing'
  | 'failed'
  | 'closed';

export interface DatabaseActorRuntimeOptions {
  /** Capability class fixed by the child entrypoint, never by request data. */
  readonly role: DatabaseActorRole;
  /** Realm imported independently inside this actor process. */
  readonly realm: DatabaseRealm;
  /** Closed actor lifecycle signals; never receives paths or raw errors. */
  readonly onEvent?: (event: DatabaseExecutorEvent) => void;
}

export interface DatabaseActorRuntimeDiagnostics {
  readonly state: DatabaseActorRuntimeState;
  readonly role: DatabaseActorRole;
  readonly databaseRef: DatabaseRef | null;
  readonly placement: DatabaseActorPlacementConfig | null;
  readonly realmFingerprint: string;
}

export interface DatabaseActorServerOptions extends DatabaseActorRuntimeOptions {
  readonly slot: number;
  readonly maxInFlight?: number;
  /** Test/embedding seam. Production actors use Bun process IPC. */
  readonly transport?: SubprocessDatabaseServerOptions['transport'];
}

export interface DatabaseActorServer {
  readonly actor: DatabaseActorRuntime;
  readonly server: SubprocessDatabaseServer;
}

/**
 * Synchronous database-specific handler hosted behind SubprocessDatabaseServer.
 *
 * SQLite operations intentionally remain synchronous so a request cannot
 * interleave a bind, operation, or unbind transition on this actor's handle.
 */
export class DatabaseActorRuntime implements Disposable {
  readonly role: DatabaseActorRole;
  readonly realm: DatabaseRealm;

  private readonly catalog;
  private binding: DatabaseActorBinding | null = null;
  private state: DatabaseActorRuntimeState = 'unbound';
  private closeRequested = false;
  private hotDurabilityFailureReported = false;
  private readonly identityProjectionSession =
    new DatabaseIdentityProjectionActorSession();
  private readonly onEvent: ((event: DatabaseExecutorEvent) => void) | null;

  constructor(options: DatabaseActorRuntimeOptions) {
    if (options.role !== 'writer' && options.role !== 'reader') {
      throw new TypeError('Database actor role must be writer or reader.');
    }
    if (!options.realm
      || !REALM_FINGERPRINT_PATTERN.test(options.realm.fingerprint)
      || !SCHEMA_CHECKSUM_PATTERN.test(options.realm.schemaChecksum)) {
      throw new TypeError('Database actor realm must be a defined database realm.');
    }
    if (options.onEvent !== undefined && typeof options.onEvent !== 'function') {
      throw new TypeError('Database actor event listener must be a function.');
    }
    this.role = options.role;
    this.realm = options.realm;
    this.catalog = createDatabaseRealmOperationCatalog(options.realm);
    this.onEvent = options.onEvent ?? null;
  }

  /** Validate and execute one already-framed server request. */
  handle(request: DatabaseExecutorServerRequest): DatabaseExecutorValue {
    try {
      this.assertAccepting();
      switch (request.operation) {
        case DATABASE_ACTOR_OPERATIONS.bindWriter:
          return asExecutorValue(this.bind(request, 'writer'));
        case DATABASE_ACTOR_OPERATIONS.bindReader:
          return asExecutorValue(this.bind(request, 'reader'));
        case DATABASE_ACTOR_OPERATIONS.execute:
          return this.execute(request);
        case DATABASE_ACTOR_OPERATIONS.replay:
          return asExecutorValue(this.replay(request));
        case DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotBegin:
          return asExecutorValue(this.tenantSyncSnapshotBegin(request));
        case DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotPage:
          return asExecutorValue(this.tenantSyncSnapshotPage(request));
        case DATABASE_ACTOR_OPERATIONS.tenantSyncSnapshotAbort:
          return asExecutorValue(this.tenantSyncSnapshotAbort(request));
        case DATABASE_ACTOR_OPERATIONS.findReceipt:
          return asExecutorValue(this.findReceipt(request));
        case DATABASE_ACTOR_OPERATIONS.identityProjection:
          return asExecutorValue(this.identityProjection(request));
        case DATABASE_ACTOR_OPERATIONS.presenceProjection:
          return asExecutorValue(this.presenceProjection(request));
        case DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION:
          return asExecutorValue(this.automationOutbox(request));
        case DATABASE_ACTOR_OPERATIONS.unbind:
          return this.unbind(request);
        default:
          throw new DatabaseError(
            'DATABASE_OPERATION_UNSUPPORTED',
            'Database actor operation is unsupported.',
          );
      }
    } catch (error) {
      throw privacySafeActorError(error);
    }
  }

  /** Close the current binding once; a failed cleanup never becomes closed. */
  close(): void {
    if (this.state === 'closed') return;
    this.closeRequested = true;
    this.state = 'closing';
    try {
      if (this.binding) {
        closeActorBinding(this.binding);
        this.binding = null;
      }
      this.identityProjectionSession.reset();
      this.state = 'closed';
    } catch {
      this.state = 'failed';
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor cleanup failed.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }

  diagnostics(): DatabaseActorRuntimeDiagnostics {
    return Object.freeze({
      state: this.state,
      role: this.role,
      databaseRef: this.binding?.databaseRef ?? null,
      placement: this.binding?.placement ?? null,
      realmFingerprint: this.realm.fingerprint,
    });
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private bind(
    request: DatabaseExecutorServerRequest,
    requestedRole: DatabaseActorRole,
  ): DatabaseActorBindResult {
    const payload = validateDatabaseActorBindPayload(request.payload);
    if (requestedRole !== this.role) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Database actor cannot change roles.',
      );
    }
    requireOperationKind(
      request.kind,
      requestedRole === 'writer' ? 'write' : 'read',
    );
    if (this.binding) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Database actor is already bound.',
      );
    }
    this.identityProjectionSession.reset();
    if (payload.realmFingerprint !== this.realm.fingerprint) {
      throw new DatabaseError(
        'DATABASE_SCHEMA_MISMATCH',
        'Database actor realm fingerprint does not match.',
      );
    }
    if (this.role === 'reader' && payload.placement.mode !== 'file') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not support hot placement.',
      );
    }

    let candidate: DatabaseActorBinding | null = null;
    try {
      candidate = this.role === 'writer'
        ? openWriterBinding(
            payload,
            this.realm,
            {
              onStart: () => this.emitHotPeriodicSnapshotLifecycle(
                'hot-periodic-snapshot-started',
              ),
              onFinish: () => this.emitHotPeriodicSnapshotLifecycle(
                'hot-periodic-snapshot-finished',
              ),
              onDirty: () => this.emitHotPeriodicSnapshotLifecycle(
                'hot-periodic-durability-dirty',
              ),
              onClean: () => this.emitHotPeriodicSnapshotLifecycle(
                'hot-periodic-durability-clean',
              ),
              onFailure: () => this.failHotPeriodicDurability(),
            },
          )
        : openReaderBinding(payload, this.realm);
      establishInitialHotDurability(candidate, payload, this.realm);
      const result = validateBindResult(() => validateDatabaseActorBindResult({
        databaseRef: candidate!.databaseRef,
        role: candidate!.role,
        fileIdentity: candidate!.openedFileIdentity,
        instanceId: candidate!.bindingIdentity.instanceId,
        placement: candidate!.placement,
        realmFingerprint: this.realm.fingerprint,
        schemaChecksum: this.realm.schemaChecksum,
        sequence: createDatabaseSequenceToken(actorBindingSequence(candidate!)),
        syncEpoch: candidate!.role === 'writer'
          ? candidate!.runtime.db.syncEpoch
          : null,
      }));
      if (result.databaseRef !== payload.databaseRef
        || result.role !== this.role
        || !sameDatabaseFileIdentity(
          result.fileIdentity,
          payload.fileIdentity,
        )
        || result.instanceId !== payload.instanceId
        || !sameActorPlacement(result.placement, payload.placement)
        || result.realmFingerprint !== payload.realmFingerprint
        || result.schemaChecksum !== this.realm.schemaChecksum) {
        throw new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Database actor readiness proof is invalid.',
          { retryable: false, outcome: 'unknown' },
        );
      }
      // Hot snapshots replace their inode. Retain the verified final readiness
      // image until every logical/protocol assertion above has succeeded.
      releaseHotOpenedFileGuard(candidate);
      this.binding = candidate;
      this.state = 'bound';
      return result;
    } catch (error) {
      if (candidate) {
        try {
          closeActorBinding(candidate);
        } catch {
          // Retain ownership so a later close hook can retry cleanup. Never
          // discard a possibly-live SQLite authority after a failed bind.
          this.binding = candidate;
          this.closeRequested = true;
          this.state = 'failed';
          throw new DatabaseError(
            'DATABASE_EXECUTOR_FAILED',
            'Database actor failed to clean up an incomplete binding.',
            { retryable: false, outcome: 'unknown' },
          );
        }
      }
      if (error instanceof DatabaseError && error.outcome === 'unknown') {
        // Startup cleanup could not prove release of every owned resource. Stop
        // accepting work; the parent will terminate this process, whose exit is
        // the authoritative release of any otherwise unreachable OS locks.
        this.closeRequested = true;
        this.state = 'failed';
      }
      throw error;
    }
  }

  private execute(
    request: DatabaseExecutorServerRequest,
  ): DatabaseExecutorValue {
    const payload = validateDatabaseActorExecutePayload(
      request.payload,
      this.catalog,
    );
    const binding = this.requireBinding(payload.databaseRef);
    const expectedKind = operationKind(payload.operation);
    requireOperationKind(request.kind, expectedKind);

    const execute = () => binding.role === 'reader'
      ? binding.runtime.execute(payload.operation)
      : binding.engine.execute(
        payload.operation,
        payload.logicalReceiptFingerprint,
      );
    let value;
    if (isWriteOperation(payload.operation) && binding.role === 'writer') {
      if (binding.authorityCommitGuard) {
        value = binding.authorityCommitGuard.run(
          payload.authorityRevision,
          execute,
        );
      } else {
        rejectUnexpectedAuthorityRevision(payload.authorityRevision);
        value = execute();
      }
    } else {
      value = execute();
    }
    if (payload.logicalReceiptFingerprint === undefined) {
      const result = validateDatabaseActorExecuteResult(
        value,
        payload.operation,
        this.catalog,
      );
      if (isWriteOperation(payload.operation)) {
        if (!('replayed' in result)) throw invalidActorResult();
        this.establishHotWriteDurability(binding, result.replayed);
      }
      return asExecutorValue(attachDatabaseActorReceiptCompaction(
        result,
        binding.role === 'writer'
          ? binding.engine.takeReceiptCompaction()
          : null,
      ));
    }
    if (!isWriteOperation(payload.operation)) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database actor trusted receipt operation is invalid.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    const result = validateDatabaseActorTrustedWriteResult(
      value,
      payload.operation.idempotencyKey,
      this.catalog,
    );
    this.establishHotWriteDurability(binding, result.replayed);
    return asExecutorValue(attachDatabaseActorReceiptCompaction(
      result,
      binding.role === 'writer'
        ? binding.engine.takeReceiptCompaction()
        : null,
    ));
  }

  private replay(
    request: DatabaseExecutorServerRequest,
  ): DatabaseChangeReplayResult {
    const payload = validateDatabaseActorReplayPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    requireOperationKind(request.kind, 'read');
    if (binding.role !== 'writer') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not replay writer changes.',
      );
    }
    return validateDatabaseActorReplayResult(
      binding.engine.replayChanges(payload.afterSeq, payload.limit),
      payload,
    );
  }

  private tenantSyncSnapshotBegin(
    request: DatabaseExecutorServerRequest,
  ): DatabaseActorTenantSyncSnapshotBeginResult {
    const payload = validateDatabaseActorTenantSyncSnapshotBeginPayload(
      request.payload,
      this.catalog,
    );
    const binding = this.requireWriterSnapshotBinding(payload.databaseRef, request);
    return binding.snapshotSessions.begin(payload);
  }

  private tenantSyncSnapshotPage(
    request: DatabaseExecutorServerRequest,
  ): DatabaseActorTenantSyncSnapshotPageResult {
    const payload = validateDatabaseActorTenantSyncSnapshotPagePayload(
      request.payload,
      this.catalog,
    );
    const binding = this.requireWriterSnapshotBinding(payload.databaseRef, request);
    return binding.snapshotSessions.page(payload);
  }

  private tenantSyncSnapshotAbort(
    request: DatabaseExecutorServerRequest,
  ): DatabaseActorTenantSyncSnapshotAbortResult {
    const payload = validateDatabaseActorTenantSyncSnapshotAbortPayload(
      request.payload,
      this.catalog,
    );
    const binding = this.requireWriterSnapshotBinding(payload.databaseRef, request);
    return binding.snapshotSessions.abort(payload);
  }

  private requireWriterSnapshotBinding(
    databaseRef: DatabaseRef,
    request: DatabaseExecutorServerRequest,
  ): DatabaseActorWriterBinding {
    const binding = this.requireBinding(databaseRef);
    requireOperationKind(request.kind, 'read');
    if (binding.role !== 'writer') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not create tenant Sync snapshot sessions.',
      );
    }
    return binding;
  }

  private findReceipt(
    request: DatabaseExecutorServerRequest,
  ): DatabaseTrustedReceiptLookup {
    const payload = validateDatabaseActorFindReceiptPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    requireOperationKind(request.kind, 'read');
    if (binding.role !== 'writer') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not inspect writer receipts.',
      );
    }
    return binding.engine.findReceipt(
      payload.idempotencyKey,
      payload.logicalReceiptFingerprint,
    );
  }

  private presenceProjection(request: DatabaseExecutorServerRequest): PresenceProjectionReceipt {
    const payload = validateDatabasePresenceProjectionPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef); requireOperationKind(request.kind, 'write');
    if (binding.role !== 'writer' || !hasGuardianPresenceRealm(this.realm)
      || payload.publication.scopeKind !== 'tenant' || createTenantDatabaseRef(payload.publication.scopeId) !== binding.databaseRef) throw new DatabaseError(
      'DATABASE_OPERATION_UNSUPPORTED', 'The actor does not admit Guardian presence projection.');
    if (payload.authorityRevision !== undefined && payload.authorityRevision !== payload.publication.sourceAuthorityRevision) {
      throw new DatabaseError('DATABASE_AUTHORITY_CHANGED', 'Presence directory authority changed.', { outcome: 'not-committed' });
    }
    const execute = () => {
      try { return new PresenceProjectionStore(binding.runtime.db).apply(payload.publication); }
      catch (error) {
        if (error instanceof DatabaseError) throw error;
        throw new DatabaseError('DATABASE_SCHEMA_MISMATCH', 'Guardian presence projection is incompatible.', { outcome: 'not-committed' });
      }
    };
    const result = binding.authorityCommitGuard ? binding.authorityCommitGuard.run(payload.authorityRevision, execute) : execute();
    this.establishHotWriteDurability(binding, false); return result;
  }

  private identityProjection(
    request: DatabaseExecutorServerRequest,
  ): DatabaseIdentityProjectionResult {
    const payload = validateDatabaseIdentityProjectionPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    requireOperationKind(request.kind, 'write');
    if (binding.role !== 'writer') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not project identity anchors.',
      );
    }
    if (this.realm.guardianAnchorRequirements.length === 0) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Database realm does not declare Guardian identity references.',
      );
    }
    const execute = () => this.identityProjectionSession.execute(
      binding.runtime.db,
      payload,
    );
    const result = binding.authorityCommitGuard
      ? binding.authorityCommitGuard.runAuthorityNeutral(execute)
      : execute();
    if (payload.action !== 'inspect') {
      this.establishHotWriteDurability(binding, false);
    }
    return result;
  }

  private automationOutbox(
    request: DatabaseExecutorServerRequest,
  ): DatabaseActorAutomationOutboxResult {
    const payload = validateDatabaseActorAutomationOutboxPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    const operationKind = databaseActorAutomationOperationKind(payload);
    requireOperationKind(request.kind, operationKind);
    if (binding.role !== 'writer') {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Readonly database actors do not manage automation delivery.',
      );
    }
    if (!binding.automationSession) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Database realm does not declare automations.',
      );
    }

    const execute = () => binding.automationSession!.execute(payload);
    let result: DatabaseActorAutomationOutboxResult;
    try {
      result = operationKind === 'write' && binding.authorityCommitGuard
        ? binding.authorityCommitGuard.runAuthorityNeutral(execute)
        : execute();
    } catch (error) {
      if (operationKind === 'write') {
        this.establishHotWriteDurability(binding, false);
      }
      throw error;
    }

    if (payload.action === 'claim' && result !== null) {
      this.establishHotAutomationClaimDurability(binding);
    } else if (operationKind === 'write') {
      this.establishHotWriteDurability(binding, false);
    }
    return result;
  }

  private unbind(request: DatabaseExecutorServerRequest): null {
    const payload = validateDatabaseActorUnbindPayload(request.payload);
    const binding = this.requireBinding(payload.databaseRef);
    requireOperationKind(request.kind, 'read');
    try {
      closeActorBinding(binding);
      this.binding = null;
      this.identityProjectionSession.reset();
      this.state = 'unbound';
      return null;
    } catch {
      this.closeRequested = true;
      this.state = 'failed';
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor could not release its binding.',
        { retryable: false, outcome: 'unknown' },
      );
    }
  }

  private requireBinding(databaseRef: DatabaseRef): DatabaseActorBinding {
    if (!this.binding) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Database actor is not bound.',
      );
    }
    if (this.binding.databaseRef !== databaseRef) {
      throw new DatabaseError(
        'DATABASE_AUTHORITY_CHANGED',
        'Database actor capability does not match its binding.',
      );
    }
    this.binding.livenessGuard.assertCurrent();
    this.binding.fileGuard?.assertCurrent();
    return this.binding;
  }

  private assertAccepting(): void {
    if (this.state === 'closing' || this.state === 'failed') {
      throw new DatabaseError(
        'DATABASE_EXECUTOR_FAILED',
        'Database actor is unavailable.',
        { retryable: false, outcome: 'unknown' },
      );
    }
    if (this.closeRequested || this.state === 'closed') {
      throw new DatabaseError('DATABASE_CLOSED', 'Database actor is closed.');
    }
  }

  private establishHotWriteDurability(
    binding: DatabaseActorBinding,
    replayed: boolean,
  ): void {
    try {
      establishHotWriteDurability(binding, replayed);
    } catch (error) {
      this.closeRequested = true;
      this.state = 'failed';
      throw error;
    }
  }

  private establishHotAutomationClaimDurability(
    binding: DatabaseActorWriterBinding,
  ): void {
    try {
      establishHotAutomationClaimDurability(binding);
    } catch (error) {
      this.closeRequested = true;
      this.state = 'failed';
      throw error;
    }
  }

  private failHotPeriodicDurability(): void {
    if (this.hotDurabilityFailureReported
      || this.state !== 'bound'
      || this.binding?.role !== 'writer'
      || this.binding.placement.mode !== 'hot'
      || this.binding.placement.durability !== 'periodic') return;
    this.hotDurabilityFailureReported = true;
    this.closeRequested = true;
    this.state = 'failed';
    try {
      this.onEvent?.(Object.freeze({
        type: 'hot-periodic-durability-failed',
      }));
    } catch {
      // The actor is already failed; observers cannot reopen its work lane.
    }
  }

  private emitHotPeriodicSnapshotLifecycle(
    type:
      | 'hot-periodic-snapshot-started'
      | 'hot-periodic-snapshot-finished'
      | 'hot-periodic-durability-dirty'
      | 'hot-periodic-durability-clean',
  ): void {
    if (this.state !== 'bound'
      || this.binding?.role !== 'writer'
      || this.binding.placement.mode !== 'hot'
      || this.binding.placement.durability !== 'periodic') return;
    try {
      this.onEvent?.(Object.freeze({ type }));
    } catch {
      // Lifecycle observers cannot alter snapshot or actor state.
    }
  }
}

function rejectUnexpectedAuthorityRevision(
  authorityRevision: number | undefined,
): void {
  if (authorityRevision === undefined) return;
  throw new DatabaseError(
    'DATABASE_PROTOCOL_ERROR',
    'Database actor received authority revision without a commit fence.',
    { retryable: false, outcome: 'not-started' },
  );
}

/** Compose the database handler and strict IPC server without starting either. */
export function createDatabaseActorServer(
  options: DatabaseActorServerOptions,
): DatabaseActorServer {
  let server: SubprocessDatabaseServer | null = null;
  const actor = new DatabaseActorRuntime({
    ...options,
    onEvent: (event) => {
      switch (event.type) {
        case 'hot-periodic-snapshot-started':
          server?.reportHotPeriodicSnapshotStarted();
          break;
        case 'hot-periodic-snapshot-finished':
          server?.reportHotPeriodicSnapshotFinished();
          break;
        case 'hot-periodic-durability-dirty':
          server?.reportHotPeriodicDurabilityDirty();
          break;
        case 'hot-periodic-durability-clean':
          server?.reportHotPeriodicDurabilityClean();
          break;
        case 'hot-periodic-durability-failed':
          server?.reportHotPeriodicDurabilityFailure();
          break;
      }
      try {
        options.onEvent?.(event);
      } catch {
        // The transport relay above remains authoritative for actor failure.
      }
    },
  });
  server = new SubprocessDatabaseServer({
    role: options.role,
    slot: options.slot,
    // One synchronous SQLite lane per actor. Cross-file concurrency comes from
    // separate actor processes, not overlapping work on one connection.
    maxInFlight: options.maxInFlight ?? 1,
    ...(options.transport === undefined
      ? {}
      : { transport: options.transport }),
    handle: (request) => actor.handle(request),
    close: () => closeActorWithRetries(actor),
  });
  return Object.freeze({ actor, server });
}

async function closeActorWithRetries(actor: DatabaseActorRuntime): Promise<void> {
  let lastFailure: unknown = null;
  for (let attempt = 0; attempt <= ACTOR_CLOSE_RETRY_DELAYS_MS.length; attempt += 1) {
    if (attempt > 0) {
      await delay(ACTOR_CLOSE_RETRY_DELAYS_MS[attempt - 1]!);
    }
    try {
      actor.close();
      return;
    } catch (error) {
      lastFailure = error;
    }
  }
  throw new DatabaseError(
    'DATABASE_EXECUTOR_FAILED',
    'Database actor cleanup failed after bounded retries.',
    {
      cause: lastFailure,
      retryable: false,
      outcome: 'unknown',
    },
  );
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function operationKind(operation: DatabaseOperation): DatabaseExecutorOperationKind {
  return operation.type === 'get'
    || operation.type === 'list'
    || operation.type === 'find'
    || operation.type === 'query'
    ? 'read'
    : 'write';
}

function isWriteOperation(
  operation: DatabaseOperation,
): operation is DatabaseWriteOperation {
  return operation.type === 'mutate'
    || operation.type === 'batch'
    || operation.type === 'command';
}

function requireOperationKind(
  actual: DatabaseExecutorOperationKind,
  expected: DatabaseExecutorOperationKind,
): void {
  if (actual !== expected) {
    throw new DatabaseError(
      'DATABASE_PROTOCOL_ERROR',
      'Database actor operation classification is invalid.',
      { retryable: false, outcome: 'unknown' },
    );
  }
}

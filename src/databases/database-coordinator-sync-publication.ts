/** Tenant-Sync capability accounting, authority fencing, and wakeup fanout. */

import type { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  assertDatabaseCommitAuthorityCurrent,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import type {
  DatabaseCoordinatorEntry,
  DatabaseCoordinatorSyncBindingHandle,
  DatabaseTenantSyncIdentity,
} from './database-coordinator-entry';
import { authorityUnavailable } from './database-coordinator-errors';
import { DatabaseError } from './database-error';
import type { DatabaseId } from './database-file';
import type { DatabaseObservability } from './database-observability';
import {
  createDatabaseSequenceToken,
  type DatabaseCommitResult,
  type DatabaseWriteOperation,
} from './database-operations';
import type { DatabaseTenantSyncWakeup } from './database-tenant-sync';
import type { DatabaseExecutor } from './database-executor';

interface DatabaseCoordinatorSyncPublicationOptions {
  readonly authorityCommitCoordinator: AuthorityCommitCoordinator | null;
  readonly requireCommitAuthority: boolean;
  readonly assertStarted: () => void;
  readonly currentEntry: (id: DatabaseId) => DatabaseCoordinatorEntry | undefined;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

export class DatabaseCoordinatorSyncPublication {
  readonly #authorityCommitCoordinator: AuthorityCommitCoordinator | null;
  readonly #requireCommitAuthority: boolean;
  readonly #assertStarted: () => void;
  readonly #currentEntry: (
    id: DatabaseId,
  ) => DatabaseCoordinatorEntry | undefined;
  readonly #emit: DatabaseCoordinatorSyncPublicationOptions['emit'];

  constructor(options: DatabaseCoordinatorSyncPublicationOptions) {
    this.#authorityCommitCoordinator = options.authorityCommitCoordinator;
    this.#requireCommitAuthority = options.requireCommitAuthority;
    this.#assertStarted = options.assertStarted;
    this.#currentEntry = options.currentEntry;
    this.#emit = options.emit;
  }

  cancelReservation(entry: DatabaseCoordinatorEntry): void {
    if (entry.tenantSyncBindingSlots <= entry.syncBindings.size) return;
    entry.tenantSyncBindingSlots -= 1;
  }

  activate(
    entry: DatabaseCoordinatorEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void {
    if (entry.tenantSyncBindingSlots <= entry.syncBindings.size
      || entry.syncBindings.has(binding)) {
      throw new DatabaseError(
        'DATABASE_PROTOCOL_ERROR',
        'Database tenant Sync reservation is invalid.',
        { retryable: false, outcome: 'not-started' },
      );
    }
    entry.syncBindings.add(binding);
  }

  release(
    entry: DatabaseCoordinatorEntry,
    binding: DatabaseCoordinatorSyncBindingHandle,
  ): void {
    if (!entry.syncBindings.delete(binding)) return;
    if (entry.tenantSyncBindingSlots > 0) entry.tenantSyncBindingSlots -= 1;
  }

  assertAuthority(
    entry: DatabaseCoordinatorEntry,
    commitAuthority: DatabaseCommitAuthority | null,
  ): undefined {
    this.#assertStarted();
    if (this.#currentEntry(entry.id) !== entry) throw authorityUnavailable();
    if (!commitAuthority) {
      if (this.#requireCommitAuthority) throw authorityUnavailable();
      return undefined;
    }
    const coordinator = this.#authorityCommitCoordinator;
    if (!coordinator) throw authorityUnavailable();
    assertDatabaseCommitAuthorityCurrent(
      commitAuthority,
      coordinator,
      entry.databaseRef,
    );
    return undefined;
  }

  requireIdentity(
    entry: DatabaseCoordinatorEntry,
    writer: DatabaseExecutor,
  ): DatabaseTenantSyncIdentity {
    const identity = entry.syncIdentity;
    if (!identity
      || entry.writer !== writer
      || identity.generation !== writer.diagnostics().generation) {
      throw new DatabaseError(
        'DATABASE_NOT_READY',
        'Database tenant Sync binding is unavailable.',
        { retryable: true, outcome: 'not-started' },
      );
    }
    return identity;
  }

  advanceSequence(entry: DatabaseCoordinatorEntry, sequence: number): void {
    const identity = entry.syncIdentity;
    if (!identity || sequence <= identity.sequence) return;
    entry.syncIdentity = Object.freeze({ ...identity, sequence });
  }

  publishCommit(
    entry: DatabaseCoordinatorEntry,
    operation: DatabaseWriteOperation,
    result: DatabaseCommitResult,
  ): void {
    if (result.replayed) return;
    const identity = entry.syncIdentity;
    const writer = entry.writer;
    if (!identity || !writer || entry.state !== 'ready'
      || writer.diagnostics().generation !== identity.generation) return;
    const throughSeq = result.sequence.seq;
    if (throughSeq <= identity.sequence) return;
    const afterSeq = identity.sequence;
    entry.syncIdentity = Object.freeze({ ...identity, sequence: throughSeq });
    const wakeup: DatabaseTenantSyncWakeup = Object.freeze({
      type: 'changes',
      databaseRef: entry.databaseRef,
      syncEpoch: identity.syncEpoch,
      generation: identity.generation,
      afterSeq,
      throughSeq,
      idempotencyKey: operation.idempotencyKey,
    });
    for (const binding of [...entry.syncBindings]) binding.notify(wakeup);
    if (entry.syncBindings.size > 0) {
      this.#emit({
        type: 'change-wakeup',
        databaseRef: entry.databaseRef,
        placement: entry.placement.mode,
        role: 'writer',
        slot: entry.slot,
        generation: identity.generation,
        sequenceStart: afterSeq + 1,
        sequenceEnd: throughSeq,
      });
    }
  }

  publishReset(
    entry: DatabaseCoordinatorEntry,
    identity: DatabaseTenantSyncIdentity,
  ): void {
    const wakeup: DatabaseTenantSyncWakeup = Object.freeze({
      type: 'reset',
      databaseRef: entry.databaseRef,
      syncEpoch: identity.syncEpoch,
      generation: identity.generation,
      sequence: createDatabaseSequenceToken(identity.sequence),
    });
    for (const binding of [...entry.syncBindings]) binding.notify(wakeup);
  }

  invalidate(entry: DatabaseCoordinatorEntry): void {
    for (const binding of [...entry.syncBindings]) {
      binding.coordinatorClosed();
    }
    entry.syncBindings.clear();
  }
}

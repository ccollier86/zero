/** Commit-authority acquisition validation and unknown-outcome lease holding. */

import type {
  AuthorityCommitCoordinator,
  AuthorityCommitLease,
} from './authority-commit-coordinator';
import {
  isDatabaseCommitAuthority,
  isDatabaseCommitAuthorityFor,
  type DatabaseCommitAuthority,
} from './database-commit-authority';
import type { DatabaseAcquireOptions } from './database-coordinator-contract';
import { authorityUnavailable, safeCoordinatorError } from './database-coordinator-errors';
import { DatabaseError } from './database-error';
import type { DatabaseExecutor } from './database-executor';
import { createDatabaseRef, type DatabaseId } from './database-file';
import type { DatabaseObservability } from './database-observability';

interface DatabaseCoordinatorAuthorityOptions {
  readonly coordinator: AuthorityCommitCoordinator | null;
  readonly required: boolean;
  readonly emit: (event: Parameters<DatabaseObservability['emit']>[0]) => void;
}

export class DatabaseCoordinatorAuthority {
  readonly #options: DatabaseCoordinatorAuthorityOptions;
  #heldLeases = 0;

  constructor(options: DatabaseCoordinatorAuthorityOptions) {
    this.#options = options;
  }

  get heldLeases(): number {
    return this.#heldLeases;
  }

  resolve(
    id: DatabaseId,
    options: DatabaseAcquireOptions,
  ): DatabaseCommitAuthority | null {
    if (!options || typeof options !== 'object') {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database acquisition options are invalid.',
      );
    }
    const authority = options.commitAuthority;
    if (authority === undefined) {
      if (this.#options.required) throw authorityUnavailable();
      return null;
    }
    const coordinator = this.#options.coordinator;
    if (!coordinator) {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        'Database commit authority is not configured.',
      );
    }
    if (!isDatabaseCommitAuthority(authority)
      || !isDatabaseCommitAuthorityFor(
        authority,
        coordinator,
        createDatabaseRef(id),
      )) {
      throw authorityUnavailable();
    }
    return authority;
  }

  holdUntilSettlement(
    lease: AuthorityCommitLease,
    executor: DatabaseExecutor,
  ): void {
    this.#heldLeases += 1;
    void executor.settled().then(() => {
      try {
        lease.release();
        this.#heldLeases = Math.max(0, this.#heldLeases - 1);
      } catch (error) {
        this.#emitFailure(error);
      }
    }, (error) => {
      // A rejected settlement proof cannot safely release commit authority.
      this.#emitFailure(error);
    });
  }

  #emitFailure(error: unknown): void {
    this.#options.emit({
      type: 'coordinator-failed',
      phase: 'commit',
      error: safeCoordinatorError(error),
    });
  }
}

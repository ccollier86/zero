/** Trusted parent-side authority revision and actor-bind capability. */

import {
  readAuthAuthorityRevision,
} from '../auth/auth-authority-revision';
import { ReactiveDB } from '../sync/reactive-db';
import type {
  DatabaseActorAuthorityCommitFenceConfig,
} from './database-actor-protocol';
import { DatabaseError } from './database-error';
import { proveDatabaseSystemHandleBinding } from './database-system-handle-binding';

/**
 * Internal capability joining one open Guardian DB to its canonical file.
 *
 * Only createApp constructs this object. The coordinator receives the opaque
 * capability, never a request-derived path or revision.
 */
export class DatabaseActorAuthorityContext {
  readonly #systemDB: ReactiveDB;
  readonly #binding: DatabaseActorAuthorityCommitFenceConfig;

  constructor(systemDB: ReactiveDB, systemDatabasePath: string) {
    if (!(systemDB instanceof ReactiveDB)
      || typeof systemDatabasePath !== 'string'
      || systemDatabasePath.length === 0) {
      throw invalidConfiguration();
    }

    let binding: ReturnType<typeof proveDatabaseSystemHandleBinding>;
    try {
      binding = proveDatabaseSystemHandleBinding(systemDB, systemDatabasePath);
    } catch (error) {
      if (error instanceof DatabaseError && error.outcome === 'unknown') {
        throw error;
      }
      throw invalidConfiguration();
    }
    this.#binding = Object.freeze({
      systemDatabasePath: binding.canonicalPath,
      systemDatabaseIdentity: binding.fileIdentity,
    });
    this.#systemDB = systemDB;
  }

  /** Capture before the request's synchronous live-authority check. */
  captureRevision(): number {
    let revision: number | null;
    try {
      revision = readAuthAuthorityRevision(this.#systemDB);
    } catch {
      throw authorityUnavailable();
    }
    if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
      throw authorityUnavailable();
    }
    return revision as number;
  }

  /** Detached, structured-clone-safe bind data for a writer generation. */
  actorBinding(): DatabaseActorAuthorityCommitFenceConfig {
    return this.#binding;
  }
}

function invalidConfiguration(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database actor authority context is invalid.',
    { retryable: false, outcome: 'not-started' },
  );
}

function authorityUnavailable(): DatabaseError {
  return new DatabaseError(
    'DATABASE_AUTHORITY_CHANGED',
    'Database authority revision is unavailable.',
    { retryable: false, outcome: 'not-started' },
  );
}

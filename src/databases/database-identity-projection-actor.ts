/** Framework-only Guardian anchor session and dispatch inside a writer actor. */

import { IdentityAnchorStore } from '../auth/identity-anchor-store';
import { identityProjectionError } from '../auth/identity-projection-error';
import type { ReactiveDB } from '../sync/reactive-db';
import { asDatabaseProjectionError } from './database-identity-projection-errors';
import type {
  DatabaseIdentityProjectionPayload,
  DatabaseIdentityProjectionResult,
} from './database-identity-projection-protocol';

export { asIdentityProjectionError } from './database-identity-projection-errors';
export {
  validateDatabaseIdentityProjectionPayload,
  validateDatabaseIdentityProjectionResult,
} from './database-identity-projection-protocol';
export type {
  DatabaseIdentityProjectionAction,
  DatabaseIdentityProjectionPayload,
  DatabaseIdentityProjectionResult,
} from './database-identity-projection-protocol';

/** One binding-generation cache; schema/binding validation runs only once. */
export class DatabaseIdentityProjectionActorSession {
  private target: IdentityAnchorStore | null = null;
  private installationId: string | null = null;
  private targetId: string | null = null;

  execute(
    db: ReactiveDB,
    input: DatabaseIdentityProjectionPayload,
  ): DatabaseIdentityProjectionResult {
    try {
      if (!this.target) {
        this.target = new IdentityAnchorStore(db, {
          installationId: input.installationId,
          targetId: input.targetId,
        }, { schemaInitialized: true });
        this.installationId = input.installationId;
        this.targetId = input.targetId;
      } else if (this.installationId !== input.installationId
        || this.targetId !== input.targetId) {
        throw identityProjectionError('IDENTITY_PROJECTION_TARGET_MISMATCH');
      }
      return executeWithTarget(this.target, input);
    } catch (error) {
      throw asDatabaseProjectionError(error);
    }
  }

  reset(): void {
    this.target = null;
    this.installationId = null;
    this.targetId = null;
  }
}

/** Execute against the actor-owned handle; no path or raw SQL crosses IPC. */
export function executeDatabaseIdentityProjection(
  db: ReactiveDB,
  input: DatabaseIdentityProjectionPayload,
): DatabaseIdentityProjectionResult {
  return new DatabaseIdentityProjectionActorSession().execute(db, input);
}

function executeWithTarget(
  target: IdentityAnchorStore,
  input: DatabaseIdentityProjectionPayload,
): DatabaseIdentityProjectionResult {
  switch (input.action) {
    case 'inspect':
      return target.inspect();
    case 'apply':
      return target.apply(input.delivery!);
    case 'mark-ready':
      target.markReady();
      return null;
  }
}

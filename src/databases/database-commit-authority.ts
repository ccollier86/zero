/**
 * database-commit-authority.ts
 *
 * Mints opaque, process-local authority contexts for tenant-database writes.
 * The final live-authority check remains in the app process and is invoked
 * only after the mutation reaches the head of its writer FIFO and holds the
 * shared authority commit gate.
 */

import { DatabaseError } from './database-error';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  createDatabaseRef,
  type DatabaseRef,
} from './database-file';

declare const databaseCommitAuthorityBrand: unique symbol;

/** Opaque trusted context captured by authentication/tenant routing. */
export type DatabaseCommitAuthority = Readonly<{
  readonly [databaseCommitAuthorityBrand]: true;
}>;

/**
 * A live authority check must finish on the current stack. Requiring the
 * literal `undefined` return type prevents async and value-returning callbacks
 * from satisfying the contract through TypeScript's special `void` rule.
 */
export type DatabaseCommitAuthorityCheck = () => undefined;

interface DatabaseCommitAuthorityRecord {
  readonly owner: AuthorityCommitCoordinator;
  readonly databaseRef: DatabaseRef;
  readonly check: DatabaseCommitAuthorityCheck;
}

const authorityRecords = new WeakMap<object, DatabaseCommitAuthorityRecord>();

/**
 * Capture a synchronous live-authority resolver without exposing it through
 * the database operation or actor protocol.
 */
export function createDatabaseCommitAuthority(
  owner: AuthorityCommitCoordinator,
  databaseId: string,
  check: DatabaseCommitAuthorityCheck,
): DatabaseCommitAuthority {
  if (!(owner instanceof AuthorityCommitCoordinator)) {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database commit authority owner is invalid.',
    );
  }
  if (typeof check !== 'function') {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database commit authority check must be a function.',
    );
  }
  let databaseRef: DatabaseRef;
  try {
    databaseRef = createDatabaseRef(databaseId);
  } catch {
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database commit authority binding is invalid.',
    );
  }
  const authority = Object.freeze(Object.create(null)) as DatabaseCommitAuthority;
  authorityRecords.set(authority, Object.freeze({ owner, databaseRef, check }));
  return authority;
}

/** True only for a context minted by this process-local module instance. */
export function isDatabaseCommitAuthority(
  value: unknown,
): value is DatabaseCommitAuthority {
  return typeof value === 'object'
    && value !== null
    && authorityRecords.has(value);
}

/** True only when the opaque context was minted for this exact binding. */
export function isDatabaseCommitAuthorityFor(
  value: unknown,
  owner: AuthorityCommitCoordinator,
  databaseRef: DatabaseRef,
): value is DatabaseCommitAuthority {
  if (typeof value !== 'object' || value === null) return false;
  const record = authorityRecords.get(value);
  return record?.owner === owner && record.databaseRef === databaseRef;
}

/**
 * Re-resolve live authority. Any application failure is deliberately reduced
 * to the stable fail-closed authority error without retaining its cause.
 */
export function assertDatabaseCommitAuthorityCurrent(
  authority: DatabaseCommitAuthority,
  owner: AuthorityCommitCoordinator,
  databaseRef: DatabaseRef,
): void {
  const record = typeof authority === 'object' && authority !== null
    ? authorityRecords.get(authority)
    : undefined;
  if (!record || record.owner !== owner || record.databaseRef !== databaseRef) {
    throw new DatabaseError(
      'DATABASE_AUTHORITY_CHANGED',
      'Database commit authority is unavailable.',
      { retryable: false, outcome: 'not-started' },
    );
  }

  let result: unknown;
  try {
    result = record.check();
  } catch {
    throw new DatabaseError(
      'DATABASE_AUTHORITY_CHANGED',
      'Database commit authority changed before execution.',
      { retryable: false, outcome: 'not-started' },
    );
  }

  if (result !== undefined) {
    // A misconfigured async check may already have returned a rejected promise.
    // Observe it before failing setup so it cannot become an unhandled rejection.
    void Promise.resolve(result).catch(() => undefined);
    throw new DatabaseError(
      'DATABASE_CONFIG_INVALID',
      'Database commit authority checks must be synchronous.',
    );
  }
}

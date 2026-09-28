import { describe, expect, test } from 'bun:test';

import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import {
  assertDatabaseCommitAuthorityCurrent,
  createDatabaseCommitAuthority,
  isDatabaseCommitAuthority,
  isDatabaseCommitAuthorityFor,
} from './database-commit-authority';
import { DatabaseError } from './database-error';
import { createDatabaseRef } from './database-file';

const DATABASE_ID = 'tenant-a';
const DATABASE_REF = createDatabaseRef(DATABASE_ID);

describe('database commit authority', () => {
  test('mints an opaque frozen context and invokes its live check', () => {
    const owner = new AuthorityCommitCoordinator();
    let checks = 0;
    const authority = createDatabaseCommitAuthority(
      owner,
      DATABASE_ID,
      () => {
        checks += 1;
        return undefined;
      },
    );

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Object.keys(authority)).toEqual([]);
    expect(isDatabaseCommitAuthority(authority)).toBe(true);
    expect(isDatabaseCommitAuthorityFor(authority, owner, DATABASE_REF)).toBe(true);
    expect(isDatabaseCommitAuthorityFor(
      authority,
      owner,
      createDatabaseRef('tenant-b'),
    )).toBe(false);
    assertDatabaseCommitAuthorityCurrent(authority, owner, DATABASE_REF);
    expect(checks).toBe(1);
  });

  test('rejects forged contexts and strips application errors and causes', () => {
    const owner = new AuthorityCommitCoordinator();
    expectAuthorityFailure(() => (
      assertDatabaseCommitAuthorityCurrent({} as never, owner, DATABASE_REF)
    ), 'DATABASE_AUTHORITY_CHANGED');

    const authority = createDatabaseCommitAuthority(owner, DATABASE_ID, () => {
      throw new Error('/private/tenant/path secret-value');
    });
    const error = captureError(
      () => assertDatabaseCommitAuthorityCurrent(authority, owner, DATABASE_REF),
    );
    expect(error.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(error.message).not.toContain('secret-value');
    expect(error.cause).toBeUndefined();
    expect(error.details).toEqual({});

    expectAuthorityFailure(
      () => assertDatabaseCommitAuthorityCurrent(
        authority,
        owner,
        createDatabaseRef('tenant-b'),
      ),
      'DATABASE_AUTHORITY_CHANGED',
    );
  });

  test('rejects asynchronous checks as a configuration error', () => {
    const owner = new AuthorityCommitCoordinator();
    const authority = createDatabaseCommitAuthority(
      owner,
      DATABASE_ID,
      (() => Promise.resolve()) as unknown as () => undefined,
    );
    expectAuthorityFailure(
      () => assertDatabaseCommitAuthorityCurrent(authority, owner, DATABASE_REF),
      'DATABASE_CONFIG_INVALID',
    );
  });

  test('rejects a token owned by another coordinator even for the same database', () => {
    const owner = new AuthorityCommitCoordinator();
    const otherOwner = new AuthorityCommitCoordinator();
    const authority = createDatabaseCommitAuthority(
      owner,
      DATABASE_ID,
      () => undefined,
    );

    expect(isDatabaseCommitAuthorityFor(
      authority,
      otherOwner,
      DATABASE_REF,
    )).toBe(false);
    expectAuthorityFailure(
      () => assertDatabaseCommitAuthorityCurrent(
        authority,
        otherOwner,
        DATABASE_REF,
      ),
      'DATABASE_AUTHORITY_CHANGED',
    );
  });

  test('rejects value-returning checks as a configuration error', () => {
    const owner = new AuthorityCommitCoordinator();
    const authority = createDatabaseCommitAuthority(
      owner,
      DATABASE_ID,
      (() => 'unexpected') as unknown as () => undefined,
    );
    expectAuthorityFailure(
      () => assertDatabaseCommitAuthorityCurrent(authority, owner, DATABASE_REF),
      'DATABASE_CONFIG_INVALID',
    );
  });

  test('reduces hostile DatabaseError messages and causes from application checks', () => {
    const owner = new AuthorityCommitCoordinator();
    const authority = createDatabaseCommitAuthority(owner, DATABASE_ID, () => {
      throw new DatabaseError(
        'DATABASE_CONFIG_INVALID',
        '/private/tenant/path secret-value',
        { cause: new Error('hidden-cause') },
      );
    });
    const error = captureError(
      () => assertDatabaseCommitAuthorityCurrent(authority, owner, DATABASE_REF),
    );

    expect(error.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(error.message).not.toContain('secret-value');
    expect(error.cause).toBeUndefined();
    expect(error.details).toEqual({});
  });

  test('observes rejected asynchronous checks before reporting configuration failure', async () => {
    const owner = new AuthorityCommitCoordinator();
    let rejectionWasDelivered = false;
    const rejectedThenable = {
      then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        rejectionWasDelivered = true;
        reject(new Error('private rejection'));
      },
    };
    const authority = createDatabaseCommitAuthority(
      owner,
      DATABASE_ID,
      (() => rejectedThenable) as unknown as () => undefined,
    );
    expectAuthorityFailure(
      () => assertDatabaseCommitAuthorityCurrent(authority, owner, DATABASE_REF),
      'DATABASE_CONFIG_INVALID',
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(rejectionWasDelivered).toBe(true);
  });
});

function expectAuthorityFailure(
  operation: () => unknown,
  code: DatabaseError['code'],
): void {
  expect(captureError(operation).code).toBe(code);
}

function captureError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

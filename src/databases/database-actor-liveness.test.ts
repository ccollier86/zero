import { afterEach, describe, expect, test } from 'bun:test';
import { linkSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireDatabaseActorLiveness,
  probeDatabaseActorLiveness,
} from './database-actor-liveness';
import { DatabaseError } from './database-error';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('database actor liveness fence', () => {
  test('blocks replacement startup until every old actor releases its SHARED lease', () => {
    const root = createRoot();
    const binding = probeDatabaseActorLiveness(root);
    const first = acquireDatabaseActorLiveness(binding);
    const second = acquireDatabaseActorLiveness(binding);
    try {
      expectConflict(() => probeDatabaseActorLiveness(root));
      first.release();
      expectConflict(() => probeDatabaseActorLiveness(root));
      second.release();
      const replacement = probeDatabaseActorLiveness(root);
      expect(replacement.filePath).toBe(binding.filePath);
      expect(replacement.fileIdentity).toEqual(binding.fileIdentity);
      expect(replacement.generation).not.toBe(binding.generation);
    } finally {
      first.release();
      second.release();
    }
  });

  test('rejects a delayed stale bind after replacement startup rotates authority', () => {
    const root = createRoot();
    const stale = probeDatabaseActorLiveness(root);
    const replacement = probeDatabaseActorLiveness(root);

    const error = captureDatabaseError(
      () => acquireDatabaseActorLiveness(stale),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_AUTHORITY_CHANGED',
      retryable: false,
      outcome: 'not-started',
      details: {},
    });

    const current = acquireDatabaseActorLiveness(replacement);
    current.release();
  });

  test('rejects a hardlink alias before an actor can acquire authority', () => {
    const root = createRoot();
    const binding = probeDatabaseActorLiveness(root);
    linkSync(binding.filePath, `${binding.filePath}.alias`);
    const error = captureDatabaseError(
      () => acquireDatabaseActorLiveness(binding),
    );
    expect(error).toMatchObject({
      code: 'DATABASE_OPEN_FAILED',
      retryable: false,
      outcome: 'not-started',
      details: { phase: 'identity' },
    });
  });
});

function createRoot(): string {
  const root = realpathSync.native(
    mkdtempSync(join(tmpdir(), 'zero-database-actor-liveness-')),
  );
  roots.push(root);
  return root;
}

function expectConflict(operation: () => unknown): void {
  const error = captureDatabaseError(operation);
  expect(error).toMatchObject({
    code: 'DATABASE_CONFLICT',
    retryable: true,
    outcome: 'not-started',
  });
}

function captureDatabaseError(operation: () => unknown): DatabaseError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}

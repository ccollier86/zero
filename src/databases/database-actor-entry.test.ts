import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import {
  runDatabaseActorIfRequested,
} from './database-actor-bootstrap';
import {
  DATABASE_ACTOR_CHILD_FLAG,
  parseDatabaseActorInvocation,
} from './database-actor-entry-contract';
import { DatabaseError } from './database-error';
import {
  buildDatabaseActorCommand,
  createSubprocessDatabaseExecutorFactory,
} from './subprocess-database-executor-factory';
import { databaseActorFixtureRealm } from './test-fixtures/database-actor-realm';

const SAME_ENTRY_FIXTURE_URL = new URL(
  './test-fixtures/database-actor-same-entry.ts',
  import.meta.url,
);
const SAME_ENTRY_FIXTURE_PATH = fileURLToPath(SAME_ENTRY_FIXTURE_URL);

describe('database actor same-entry contract', () => {
  test('returns false without actor side effects when the private marker is absent', async () => {
    await expect(runDatabaseActorIfRequested({
      realm: databaseActorFixtureRealm,
      argv: [process.execPath, SAME_ENTRY_FIXTURE_PATH, '--ordinary-app-flag'],
    })).resolves.toBe(false);
  });

  test('parses only one exact tail invocation with a canonical slot', () => {
    expect(parseDatabaseActorInvocation([
      process.execPath,
      SAME_ENTRY_FIXTURE_PATH,
      DATABASE_ACTOR_CHILD_FLAG,
      'writer',
      '42',
    ])).toEqual({ role: 'writer', slot: 42 });
    expect(parseDatabaseActorInvocation([
      '/app/server',
      '--ordinary-app-flag',
    ])).toBeNull();
  });

  test.each([
    { tail: [DATABASE_ACTOR_CHILD_FLAG] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'writer'] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'admin', '0'] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'reader', '-1'] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'reader', '01'] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'reader', '1.0'] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'reader', '9007199254740992'] },
    { tail: [DATABASE_ACTOR_CHILD_FLAG, 'reader', '0', '--trailing'] },
    { tail: [
      DATABASE_ACTOR_CHILD_FLAG,
      DATABASE_ACTOR_CHILD_FLAG,
      'reader',
      '0',
    ] },
  ])('fails closed for malformed actor argv %#', async ({ tail }) => {
    const secret = 'private-tenant-path-and-secret';
    const result = runDatabaseActorIfRequested({
      realm: databaseActorFixtureRealm,
      argv: [secret, ...tail],
    });
    const error = await captureDatabaseError(result);
    expect(error.code).toBe('DATABASE_CONFIG_INVALID');
    expect(`${error.message}\n${JSON.stringify(error)}`).not.toContain(secret);
  });

  test('fails before actor startup when invoked directly without parent IPC', async () => {
    const error = await captureDatabaseError(runDatabaseActorIfRequested({
      realm: databaseActorFixtureRealm,
      argv: [
        process.execPath,
        SAME_ENTRY_FIXTURE_PATH,
        DATABASE_ACTOR_CHILD_FLAG,
        'reader',
        '7',
      ],
    }));
    expect(error).toMatchObject({
      code: 'DATABASE_EXECUTOR_START_FAILED',
      outcome: 'not-started',
      retryable: false,
    });
  });

  test('a direct same-entry process without IPC exits fail-closed', async () => {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        '--no-env-file',
        SAME_ENTRY_FIXTURE_PATH,
        DATABASE_ACTOR_CHILD_FLAG,
        'writer',
        '3',
      ],
      env: {},
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    expect(await child.exited).toBe(70);
  });
});

describe('database actor subprocess executor factory', () => {
  test('builds source, bundle, and explicit-prefix commands with a hermetic source runtime and actor suffix', () => {
    expect(buildDatabaseActorCommand({
      launch: {
        kind: 'source',
        entrypoint: SAME_ENTRY_FIXTURE_URL,
      },
      role: 'writer',
      slot: 4,
    })).toEqual([
      process.execPath,
      '--no-env-file',
      SAME_ENTRY_FIXTURE_PATH,
      DATABASE_ACTOR_CHILD_FLAG,
      'writer',
      '4',
    ]);

    expect(buildDatabaseActorCommand({
      launch: {
        kind: 'bundle',
        entrypoint: '/opt/zero/application',
      },
      role: 'reader',
      slot: 0,
    })).toEqual([
      '/opt/zero/application',
      DATABASE_ACTOR_CHILD_FLAG,
      'reader',
      '0',
    ]);

    expect(buildDatabaseActorCommand({
      launch: {
        kind: 'command-prefix',
        commandPrefix: [process.execPath, '/opt/zero/wrapper.ts', '--fixed'],
      },
      actorFlag: '--zero-private-database-child',
      role: 'writer',
      slot: 9,
    })).toEqual([
      process.execPath,
      '/opt/zero/wrapper.ts',
      '--fixed',
      '--zero-private-database-child',
      'writer',
      '9',
    ]);
  });

  test('rejects ambiguous, relative, exotic, and secret-bearing launch inputs safely', () => {
    const secret = 'super-secret-entrypoint';
    expectConfigError(() => buildDatabaseActorCommand({
      launch: { kind: 'source', entrypoint: `./${secret}.ts` },
      role: 'writer',
      slot: 0,
    }), secret);
    expectConfigError(() => buildDatabaseActorCommand({
      launch: {
        kind: 'command-prefix',
        commandPrefix: [process.execPath, DATABASE_ACTOR_CHILD_FLAG],
      },
      role: 'writer',
      slot: 0,
    }));
    expectConfigError(() => buildDatabaseActorCommand({
      launch: { kind: 'bundle', entrypoint: '/opt/zero/application' },
      role: 'writer',
      slot: -1,
    }));

    let getterCalled = false;
    const env = Object.defineProperty({}, secret, {
      enumerable: true,
      get() {
        getterCalled = true;
        return secret;
      },
    });
    expectConfigError(() => createSubprocessDatabaseExecutorFactory({
      launch: { kind: 'source', entrypoint: SAME_ENTRY_FIXTURE_PATH },
      env: env as Record<string, string>,
    }), secret);
    expect(getterCalled).toBe(false);
  });

  test('runs the same source entry over IPC with only its explicit environment', async () => {
    const inheritedName = 'ZERO_DATABASE_ACTOR_TEST_INHERITED_SECRET';
    const previousInherited = process.env[inheritedName];
    process.env[inheritedName] = 'must-not-reach-child';

    const mutableEntrypoint = new URL(SAME_ENTRY_FIXTURE_URL);
    const mutableLaunch = {
      kind: 'source' as const,
      entrypoint: mutableEntrypoint,
    };
    const mutableEnv = {
      ZERO_DATABASE_ACTOR_VERIFY_ENV: '1',
      ZERO_DATABASE_ACTOR_TEST_ALLOWED: 'allowed',
    };
    const createExecutor = createSubprocessDatabaseExecutorFactory({
      launch: mutableLaunch,
      env: mutableEnv,
      executor: {
        maxInFlight: 1,
        startupTimeoutMs: 2_000,
        operationTimeoutMs: 2_000,
        shutdownAckTimeoutMs: 1_000,
        shutdownExitTimeoutMs: 1_000,
        sigtermTimeoutMs: 500,
        sigkillTimeoutMs: 500,
      },
    });

    // Construction detaches all launch inputs from later caller mutation.
    mutableEntrypoint.pathname = '/private/path/that-must-not-be-used.ts';
    mutableEnv.ZERO_DATABASE_ACTOR_TEST_ALLOWED = 'mutated';

    const executor = createExecutor({ role: 'reader', slot: 11 });
    try {
      await executor.start();
      expect(executor.diagnostics()).toMatchObject({
        state: 'ready',
        slot: 11,
      });
    } finally {
      await executor.close();
      if (previousInherited === undefined) delete process.env[inheritedName];
      else process.env[inheritedName] = previousInherited;
    }
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      exitCode: 0,
      lastFailureCode: null,
    });
  });
});

async function captureDatabaseError(
  promise: Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError.');
}

function expectConfigError(operation: () => unknown, hidden?: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({ code: 'DATABASE_CONFIG_INVALID' });
    if (hidden) {
      expect(`${(error as Error).message}\n${JSON.stringify(error)}`)
        .not.toContain(hidden);
    }
    return;
  }
  throw new Error('Expected a configuration error.');
}

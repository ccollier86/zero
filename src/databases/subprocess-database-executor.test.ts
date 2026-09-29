import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';
import { DatabaseError } from './database-error';
import { SubprocessDatabaseExecutor } from './subprocess-database-executor';

const FIXTURE_PATH = fileURLToPath(new URL(
  './test-fixtures/database-executor-child.ts',
  import.meta.url,
));

describe('SubprocessDatabaseExecutor', () => {
  test('accepts the portable JavaScript timer ceiling for every executor deadline', async () => {
    const executor = createExecutor({
      startupTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      operationTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      shutdownAckTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      shutdownExitTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      sigtermTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
      sigkillTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS,
    });

    expect(executor.diagnostics()).toMatchObject({ state: 'created' });
    await executor.close();
  });

  test('rejects executor deadlines above the portable JavaScript timer ceiling', () => {
    const fields = [
      'startupTimeoutMs',
      'operationTimeoutMs',
      'shutdownAckTimeoutMs',
      'shutdownExitTimeoutMs',
      'sigtermTimeoutMs',
      'sigkillTimeoutMs',
    ] as const satisfies readonly (keyof TestExecutorOptions)[];

    for (const field of fields) {
      expect(() => createExecutor({
        [field]: MAX_RUNTIME_TIMER_INTERVAL_MS + 1,
      })).toThrow(
        `${field} must not exceed ${MAX_RUNTIME_TIMER_INTERVAL_MS}`,
      );
    }
  });

  test('bounds each per-operation timer override before dispatch', async () => {
    const executor = createExecutor();
    try {
      await executor.start();
      expect(await executor.execute<string>({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'portable-timer-boundary', delayMs: 0 },
      }, { timeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS })).toBe(
        'portable-timer-boundary',
      );
      await expect(executor.execute({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'must-not-dispatch', delayMs: 0 },
      }, { timeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS + 1 })).rejects.toThrow(
        `timeoutMs must not exceed ${MAX_RUNTIME_TIMER_INTERVAL_MS}`,
      );
      expect(executor.diagnostics()).toMatchObject({
        state: 'ready',
        inFlight: 0,
      });
    } finally {
      await executor.close();
    }
  });

  test('correlates out-of-order responses to their original requests', async () => {
    const executor = createExecutor();
    try {
      await executor.start();
      const slow = executor.execute<string>({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'slow', delayMs: 40 },
      });
      const fast = executor.execute<string>({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'fast', delayMs: 0 },
      });

      expect(await Promise.all([slow, fast])).toEqual(['slow', 'fast']);
      expect(executor.diagnostics()).toMatchObject({
        state: 'ready',
        inFlight: 0,
      });
    } finally {
      await executor.close();
    }
  });

  test('enforces the configured maximum in-flight request bound', async () => {
    const executor = createExecutor({ maxInFlight: 1 });
    try {
      await executor.start();
      const first = executor.execute<string>({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'first', delayMs: 50 },
      });

      expect(executor.diagnostics().inFlight).toBe(1);
      const rejected = executor.execute({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'second', delayMs: 0 },
      });
      await expectDatabaseError(rejected, 'DATABASE_BACKPRESSURE', 'not-started');
      expect(await first).toBe('first');
    } finally {
      await executor.close();
    }
  });

  test.each([
    ['malformed', 'an extended response'],
    ['unknown-response', 'an unknown request id'],
    ['stale-generation', 'a stale generation'],
    ['invalid-value', 'a success value outside the transport contract'],
    ['cyclic-value', 'a cyclic success graph'],
    ['oversized-value', 'a success value over the transport byte bound'],
  ] as const)('fails the channel on %s (%s)', async (operation) => {
    const executor = createExecutor();
    try {
      await executor.start();
      const result = executor.execute({
        operation,
        kind: 'read',
        payload: null,
      });
      await expectDatabaseError(result, 'DATABASE_PROTOCOL_ERROR', 'unknown');
      expect(executor.diagnostics()).toMatchObject({
        state: 'failed',
        inFlight: 0,
        lastFailureCode: 'DATABASE_PROTOCOL_ERROR',
      });
    } finally {
      await executor.close();
    }
  });

  test('drains work and performs acknowledged cooperative shutdown', async () => {
    const executor = createExecutor();
    await executor.start();
    const result = executor.execute<string>({
      operation: 'echo',
      kind: 'read',
      payload: { value: 'drained', delayMs: 30 },
    });

    const closing = executor.close();
    expect(await result).toBe('drained');
    await closing;
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      inFlight: 0,
      disconnectObserved: true,
      exitObserved: true,
      settled: true,
      exitCode: 0,
      signalCode: null,
      lastFailureCode: null,
    });
  });

  test('classifies an interrupted in-flight write as outcome unknown', async () => {
    const executor = createExecutor();
    try {
      await executor.start();
      const result = executor.execute({
        operation: 'exit',
        kind: 'write',
        payload: null,
      });
      const error = await captureDatabaseError(result);
      expect(error.code).toBe('DATABASE_EXECUTOR_FAILED');
      expect(error.outcome).toBe('unknown');
      expect(error.retryable).toBe(false);
      expect(executor.diagnostics().lastFailureCode).toBe(
        'DATABASE_EXECUTOR_FAILED',
      );
    } finally {
      await executor.close();
    }
  });

  test('fails and settles on the exact payload-free hot durability signal', async () => {
    const executor = createExecutor();
    const events: unknown[] = [];
    executor.setEventListener((event) => events.push(event));
    try {
      await executor.start();
      const result = executor.execute({
        operation: 'hot-periodic-durability-failed',
        kind: 'write',
        payload: null,
      });
      await expectDatabaseError(result, 'DATABASE_EXECUTOR_FAILED', 'unknown');
      expect(events).toEqual([{ type: 'hot-periodic-durability-failed' }]);
      expect(executor.diagnostics()).toMatchObject({
        state: 'failed',
        lastFailureCode: 'DATABASE_EXECUTOR_FAILED',
      });
      await executor.settled();
    } finally {
      await executor.close();
    }
  });

  test('relays exact periodic snapshot watchdog boundaries without payloads', async () => {
    const executor = createExecutor();
    const events: unknown[] = [];
    executor.setEventListener((event) => events.push(event));
    try {
      await executor.start();
      await executor.execute({
        operation: 'hot-periodic-snapshot-cycle',
        kind: 'read',
        payload: null,
      });
      expect(events).toEqual([
        { type: 'hot-periodic-snapshot-started' },
        { type: 'hot-periodic-snapshot-finished' },
      ]);
      expect(JSON.stringify(events)).not.toContain('payload');
    } finally {
      await executor.close();
    }
  });

  test('relays exact periodic acknowledged-write boundaries without payloads', async () => {
    const executor = createExecutor();
    const events: unknown[] = [];
    executor.setEventListener((event) => events.push(event));
    try {
      await executor.start();
      await executor.execute({
        operation: 'hot-periodic-durability-cycle',
        kind: 'write',
        payload: null,
      });
      expect(events).toEqual([
        { type: 'hot-periodic-durability-dirty' },
        { type: 'hot-periodic-durability-clean' },
      ]);
      expect(JSON.stringify(events)).not.toContain('payload');
    } finally {
      await executor.close();
    }
  });

  test('fails and reaps a child that misses the startup deadline', async () => {
    const executor = createExecutor({
      mode: 'never-ready',
      startupTimeoutMs: 30,
    });
    try {
      await expectDatabaseError(
        executor.start(),
        'DATABASE_EXECUTOR_START_FAILED',
        'not-started',
      );
      expect(executor.diagnostics()).toMatchObject({
        state: 'failed',
        inFlight: 0,
        lastFailureCode: 'DATABASE_EXECUTOR_START_FAILED',
      });
    } finally {
      await executor.close();
    }
  });

  test('marks an operation timeout unknown and stops the executor', async () => {
    const executor = createExecutor({ operationTimeoutMs: 30 });
    try {
      await executor.start();
      const result = executor.execute({
        operation: 'never',
        kind: 'write',
        payload: null,
      });
      await expectDatabaseError(
        result,
        'DATABASE_OPERATION_TIMEOUT',
        'unknown',
      );
      expect(executor.diagnostics()).toMatchObject({
        state: 'failed',
        lastFailureCode: 'DATABASE_OPERATION_TIMEOUT',
      });
    } finally {
      await executor.close();
    }
  });

  test('keeps settlement pending after timeout until close observes process exit', async () => {
    const executor = createExecutor({
      mode: 'ignore-sigterm',
      operationTimeoutMs: 20,
      sigtermTimeoutMs: 100,
      sigkillTimeoutMs: 500,
    });
    try {
      await executor.start();
      let settlementObserved = false;
      const settlement = executor.settled().then(() => {
        settlementObserved = true;
      });
      const result = executor.execute({
        operation: 'never',
        kind: 'write',
        payload: null,
      });

      await expectDatabaseError(
        result,
        'DATABASE_OPERATION_TIMEOUT',
        'unknown',
      );
      expect(settlementObserved).toBe(false);
      expect(executor.diagnostics()).toMatchObject({
        state: 'failed',
        exitObserved: false,
        settled: false,
      });

      let closeResolved = false;
      const closing = executor.close().then(() => {
        closeResolved = true;
      });
      await Bun.sleep(10);
      expect(closeResolved).toBe(false);
      expect(settlementObserved).toBe(false);

      await closing;
      await settlement;
      expect(executor.diagnostics()).toMatchObject({
        state: 'closed',
        exitObserved: true,
        settled: true,
      });
    } finally {
      if (!executor.diagnostics().settled) await executor.settled();
    }
  });

  test('quarantines an un-settled generation and exposes its later exact exit', async () => {
    const executor = createExecutor(
      {
        operationTimeoutMs: 10,
        sigtermTimeoutMs: 10,
        sigkillTimeoutMs: 10,
      },
      UnsettledTerminationExecutor,
    );
    await executor.start();
    const settlement = executor.settled();
    const result = executor.execute({
      operation: 'exit-later',
      kind: 'write',
      payload: { delayMs: 150 },
    });
    await expectDatabaseError(
      result,
      'DATABASE_OPERATION_TIMEOUT',
      'unknown',
    );

    const closeError = await captureDatabaseError(executor.close());
    expect(closeError.code).toBe('DATABASE_EXECUTOR_FAILED');
    expect(closeError.outcome).toBe('unknown');
    expect(closeError.details.phase).toBe('termination-settlement');
    expect(executor.diagnostics()).toMatchObject({
      state: 'quarantined',
      exitObserved: false,
      settled: false,
    });

    await settlement;
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      exitObserved: true,
      settled: true,
    });
  });

  test('retries an unsettled close instead of caching its rejected promise', async () => {
    const executor = createExecutor(
      {
        operationTimeoutMs: 10,
        sigtermTimeoutMs: 50,
        sigkillTimeoutMs: 50,
      },
      RetryableTerminationExecutor,
    ) as RetryableTerminationExecutor;
    await executor.start();
    const result = executor.execute({
      operation: 'exit-later',
      kind: 'write',
      payload: { delayMs: 5_000 },
    });
    await expectDatabaseError(result, 'DATABASE_OPERATION_TIMEOUT', 'unknown');

    const first = await captureDatabaseError(executor.close());
    expect(first.details.phase).toBe('termination-settlement');
    expect(executor.diagnostics()).toMatchObject({
      state: 'quarantined',
      settled: false,
    });

    executor.allowTermination();
    await executor.close();
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      settled: true,
    });
  });

  test('rejects cyclic, exotic, accessor, proxy, and over-limit request values', async () => {
    const executor = createExecutor();
    try {
      await executor.start();
      const cycle: Record<string, unknown> = {};
      cycle.self = cycle;
      let getterCalled = false;
      const accessor = Object.defineProperty({}, 'privateValue', {
        enumerable: true,
        get() {
          getterCalled = true;
          return 'must-not-run';
        },
      });
      const invalidValues = [
        cycle,
        new Map([['not', 'portable']]),
        accessor,
        new Proxy({ value: 'not-inspected' }, {}),
        'x'.repeat(1024 * 1024 + 1),
        new Array(10_001).fill(null),
      ];

      for (const payload of invalidValues) {
        await expect(executor.execute({
          operation: 'echo',
          kind: 'read',
          payload: payload as never,
        })).rejects.toBeInstanceOf(TypeError);
      }
      expect(getterCalled).toBe(false);
      expect(executor.diagnostics()).toMatchObject({
        state: 'ready',
        inFlight: 0,
      });
    } finally {
      await executor.close();
    }
  });

  test('does not hang a concurrent close when transport failure rejects the drain', async () => {
    const executor = createExecutor();
    await executor.start();
    const result = executor.execute({
      operation: 'exit',
      kind: 'write',
      payload: null,
    });
    const closing = executor.close();

    await expectDatabaseError(result, 'DATABASE_EXECUTOR_FAILED', 'unknown');
    await closing;
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      inFlight: 0,
      lastFailureCode: 'DATABASE_EXECUTOR_FAILED',
    });
  });

  test('finishes an in-progress startup before cooperatively closing', async () => {
    const executor = createExecutor({ mode: 'delayed-ready' });
    const starting = executor.start();
    const closing = executor.close();

    await starting;
    await closing;
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      inFlight: 0,
      exitCode: 0,
      lastFailureCode: null,
    });
    await expectDatabaseError(
      executor.start(),
      'DATABASE_CLOSED',
      'not-started',
    );
  });

  test('does not expose the spawn command, nonce, paths, or arguments in diagnostics', async () => {
    const secretArgument = 'not-for-diagnostics-7f43b';
    const environmentSecret = 'not-for-diagnostics-2a14e';
    const parentOnlyName = 'ZERO_EXECUTOR_PARENT_ONLY_991F';
    const previousParentValue = process.env[parentOnlyName];
    process.env[parentOnlyName] = 'must-not-be-inherited';
    const executor = createExecutor({
      secretArgument,
      env: {
        ZERO_EXECUTOR_ALLOWED: 'visible-to-child',
        ZERO_EXECUTOR_ENV_SECRET: environmentSecret,
      },
    });
    try {
      await executor.start();
      const childEnvironment = await executor.execute<{
        readonly allowed: string | null;
        readonly configuredSecret: string | null;
        readonly parentOnly: string | null;
      }>({
        operation: 'environment',
        kind: 'read',
        payload: null,
      });
      expect(childEnvironment).toEqual({
        allowed: 'visible-to-child',
        configuredSecret: environmentSecret,
        parentOnly: null,
      });
      const diagnostics = executor.diagnostics();
      const serialized = JSON.stringify(diagnostics);
      expect(serialized).not.toContain(secretArgument);
      expect(serialized).not.toContain(environmentSecret);
      expect(serialized).not.toContain(FIXTURE_PATH);
      expect(serialized).not.toContain(process.execPath);
      expect(Object.keys(diagnostics).sort()).toEqual([
        'disconnectObserved',
        'exitCode',
        'exitObserved',
        'generation',
        'inFlight',
        'lastFailureCode',
        'maxInFlight',
        'settled',
        'signalCode',
        'slot',
        'state',
      ]);
    } finally {
      await executor.close();
      if (previousParentValue === undefined) {
        delete process.env[parentOnlyName];
      } else {
        process.env[parentOnlyName] = previousParentValue;
      }
    }
  });
});

interface TestExecutorOptions {
  readonly mode?: 'normal' | 'never-ready' | 'delayed-ready' | 'ignore-sigterm';
  readonly maxInFlight?: number;
  readonly startupTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
  readonly shutdownAckTimeoutMs?: number;
  readonly shutdownExitTimeoutMs?: number;
  readonly secretArgument?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly sigtermTimeoutMs?: number;
  readonly sigkillTimeoutMs?: number;
}

function createExecutor(
  options: TestExecutorOptions = {},
  Executor = SubprocessDatabaseExecutor,
): SubprocessDatabaseExecutor {
  const command: [string, ...string[]] = [
    process.execPath,
    FIXTURE_PATH,
    options.mode ?? 'normal',
  ];
  if (options.secretArgument) command.push(options.secretArgument);
  return new Executor({
    command,
    env: options.env ?? { ZERO_EXECUTOR_TEST: '1' },
    role: 'database-executor-test',
    slot: 3,
    maxInFlight: options.maxInFlight ?? 4,
    startupTimeoutMs: options.startupTimeoutMs ?? 1_000,
    operationTimeoutMs: options.operationTimeoutMs ?? 1_000,
    shutdownAckTimeoutMs: options.shutdownAckTimeoutMs ?? 500,
    shutdownExitTimeoutMs: options.shutdownExitTimeoutMs ?? 500,
    sigtermTimeoutMs: options.sigtermTimeoutMs ?? 500,
    sigkillTimeoutMs: options.sigkillTimeoutMs ?? 500,
  });
}

class UnsettledTerminationExecutor extends SubprocessDatabaseExecutor {
  protected override async terminateWithEscalation(): Promise<boolean> {
    return false;
  }
}

class RetryableTerminationExecutor extends SubprocessDatabaseExecutor {
  private terminationAllowed = false;

  allowTermination(): void {
    this.terminationAllowed = true;
  }

  protected override async terminateWithEscalation(): Promise<boolean> {
    if (!this.terminationAllowed) return false;
    return await super.terminateWithEscalation();
  }
}

async function expectDatabaseError(
  promise: Promise<unknown>,
  code: DatabaseError['code'],
  outcome: DatabaseError['outcome'],
): Promise<void> {
  const error = await captureDatabaseError(promise);
  expect(error.code).toBe(code);
  expect(error.outcome).toBe(outcome);
}

async function captureDatabaseError(
  promise: Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError rejection.');
}

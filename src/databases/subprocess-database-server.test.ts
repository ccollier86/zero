import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';

import {
  DatabaseError,
  isSerializedDatabaseError,
} from './database-error';
import type { DatabaseExecutorValue } from './database-executor';
import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  SubprocessDatabaseExecutor,
  type SubprocessDatabaseExecutorEvent,
} from './subprocess-database-executor';
import {
  SubprocessDatabaseServer,
  type SubprocessDatabaseServerTransport,
} from './subprocess-database-server';

const ROLE = 'database-server-test';
const SLOT = 4;
const SESSION = Object.freeze({
  protocol: DATABASE_EXECUTOR_PROTOCOL_KIND,
  version: DATABASE_EXECUTOR_PROTOCOL_VERSION,
  nonce: '6ba7b810-9dad-4d1c-80b4-00c04fd430c8',
  role: ROLE,
  slot: SLOT,
  generation: 17,
});
const E2E_FIXTURE_PATH = fileURLToPath(new URL(
  './test-fixtures/database-executor-server-child.ts',
  import.meta.url,
));

describe('SubprocessDatabaseServer', () => {
  test('handles requests and serializes errors without leaking thrown values', async () => {
    const transport = new FakeTransport();
    let closeCalls = 0;
    const server = new SubprocessDatabaseServer({
      role: ROLE,
      slot: SLOT,
      transport,
      handle(request) {
        if (request.operation === 'explode') {
          throw new Error('private-handler-value-98c1');
        }
        return request.payload;
      },
      close() {
        closeCalls += 1;
      },
    });

    await startServer(server, transport);
    transport.emitMessage(request(1, 'echo', { value: 'hello' }));
    await waitFor(() => transport.sent.length === 2);
    expect(transport.sent[1]).toMatchObject({
      type: 'response',
      requestId: 1,
      ok: true,
      value: { value: 'hello' },
    });

    transport.emitMessage(request(2, 'explode', null));
    await waitFor(() => transport.sent.length === 3);
    const failure = asRecord(transport.sent[2]);
    expect(failure?.type).toBe('response');
    expect(failure?.ok).toBe(false);
    expect(isSerializedDatabaseError(failure?.error)).toBe(true);
    expect(JSON.stringify(failure)).not.toContain('private-handler-value-98c1');

    transport.emitMessage(shutdown());
    await server.finished();
    expect(transport.sent.at(-1)).toMatchObject({ type: 'shutdown-ack' });
    expect(transport.disconnectCalls).toBe(1);
    expect(closeCalls).toBe(1);
    expect(server.diagnostics()).toMatchObject({
      state: 'closed',
      inFlight: 0,
      handshakeAccepted: true,
      closeHookInvoked: true,
      shutdownAckSent: true,
      lastFailureCode: null,
    });
  });

  test('rejects an extended initial handshake and cleans up once', async () => {
    const transport = new FakeTransport();
    let closeCalls = 0;
    const server = createServer(transport, {
      close: () => { closeCalls += 1; },
    });
    const starting = server.start();
    transport.emitMessage({ ...handshake(), unexpected: true });

    await expectDatabaseError(starting, 'DATABASE_PROTOCOL_ERROR');
    await expectDatabaseError(server.finished(), 'DATABASE_PROTOCOL_ERROR');
    expect(closeCalls).toBe(1);
    expect(transport.disconnectCalls).toBe(1);
    expect(transport.sent).toHaveLength(0);
  });

  test.each([
    ['stale generation', () => ({ ...request(1, 'echo', null), generation: 18 })],
    ['duplicate handshake', () => handshake()],
    ['extended request', () => ({ ...request(1, 'echo', null), extra: true })],
    ['skipped request id', () => request(2, 'echo', null)],
    ['exotic payload', () => ({ ...request(1, 'echo', null), payload: new Map() })],
    ['oversized payload', () => ({
      ...request(1, 'echo', null),
      payload: 'x'.repeat(1024 * 1024 + 1),
    })],
  ] as const)('fails closed on %s', async (_label, createMessage) => {
    const transport = new FakeTransport();
    let handlerCalls = 0;
    let closeCalls = 0;
    const server = createServer(transport, {
      handle: () => {
        handlerCalls += 1;
        return null;
      },
      close: () => { closeCalls += 1; },
    });
    await startServer(server, transport);
    transport.emitMessage(createMessage());

    await expectDatabaseError(server.finished(), 'DATABASE_PROTOCOL_ERROR');
    expect(handlerCalls).toBe(0);
    expect(closeCalls).toBe(1);
    expect(transport.disconnectCalls).toBe(1);
    expect(server.diagnostics()).toMatchObject({
      state: 'failed',
      lastFailureCode: 'DATABASE_PROTOCOL_ERROR',
      shutdownAckSent: false,
    });
  });

  test('stops admission, drains handlers and the close hook, then acknowledges once', async () => {
    const transport = new FakeTransport();
    const handlerDeferred = deferred<DatabaseExecutorValue>();
    const closeDeferred = deferred<void>();
    let handlerCalls = 0;
    let closeCalls = 0;
    const server = createServer(transport, {
      handle: async () => {
        handlerCalls += 1;
        return await handlerDeferred.promise;
      },
      close: async () => {
        closeCalls += 1;
        transport.order.push('close-start');
        await closeDeferred.promise;
        transport.order.push('close-finish');
      },
    });
    await startServer(server, transport);
    transport.emitMessage(request(1, 'slow', null));
    await waitFor(() => handlerCalls === 1);
    transport.emitMessage(shutdown());

    expect(server.diagnostics().state).toBe('draining');
    expect(closeCalls).toBe(0);
    expect(transport.sent.some((message) => message.type === 'shutdown-ack')).toBe(false);

    handlerDeferred.resolve({ done: true });
    await waitFor(() => closeCalls === 1);
    expect(transport.sent[1]).toMatchObject({
      type: 'response',
      requestId: 1,
      ok: true,
    });
    expect(transport.sent.some((message) => message.type === 'shutdown-ack')).toBe(false);

    closeDeferred.resolve(undefined);
    await server.finished();
    expect(transport.order).toEqual([
      'send:ready',
      'send:response',
      'close-start',
      'close-finish',
      'send:shutdown-ack',
      'disconnect',
    ]);
    await server.close();
    expect(closeCalls).toBe(1);
    expect(transport.sent.filter((message) => message.type === 'shutdown-ack')).toHaveLength(1);
  });

  test('does not admit commands received after shutdown begins', async () => {
    const transport = new FakeTransport();
    let handlerCalls = 0;
    const server = createServer(transport, {
      handle: () => {
        handlerCalls += 1;
        return null;
      },
    });
    await startServer(server, transport);
    transport.emitMessage(shutdown());
    transport.emitMessage(request(1, 'too-late', null));

    await expectDatabaseError(server.finished(), 'DATABASE_PROTOCOL_ERROR');
    expect(handlerCalls).toBe(0);
    expect(transport.sent.some((message) => message.type === 'shutdown-ack')).toBe(false);
  });

  test('returns safe failures for handler and output failures without emitting invalid values', async () => {
    const transport = new FakeTransport();
    const server = createServer(transport, {
      handle(request) {
        switch (request.operation) {
          case 'domain-error':
            throw new DatabaseError(
              'DATABASE_CONFLICT',
              'Safe conflict.',
              { retryable: true, outcome: 'not-committed' },
            );
          case 'unknown-error':
            throw new Error('private-actor-stack-value-4b82');
          case 'invalid-output':
            return new Map([['invalid', true]]) as never;
          case 'oversized-output':
            return 'x'.repeat(1024 * 1024 + 1);
          default:
            return null;
        }
      },
    });
    await startServer(server, transport);

    const operations = [
      'domain-error',
      'unknown-error',
      'invalid-output',
      'oversized-output',
    ];
    for (const [index, operation] of operations.entries()) {
      transport.emitMessage(request(index + 1, operation, null));
      await waitFor(() => transport.sent.length === index + 2);
    }

    const failures = transport.sent.slice(1).map(asRecord);
    expect(failures.every((message) => message?.ok === false)).toBe(true);
    expect(asRecord(failures[0]?.error)?.code).toBe('DATABASE_CONFLICT');
    expect(asRecord(failures[1]?.error)?.code).toBe('DATABASE_EXECUTOR_FAILED');
    expect(asRecord(failures[2]?.error)?.code).toBe('DATABASE_PROTOCOL_ERROR');
    expect(asRecord(failures[3]?.error)?.code).toBe('DATABASE_PROTOCOL_ERROR');
    expect(JSON.stringify(failures)).not.toContain('private-actor-stack-value-4b82');
    expect(server.diagnostics()).toMatchObject({ state: 'ready', inFlight: 0 });

    transport.emitMessage(shutdown());
    await server.finished();
  });

  test('suppresses responses and invokes cleanup after parent disconnect', async () => {
    const transport = new FakeTransport();
    const handlerDeferred = deferred<DatabaseExecutorValue>();
    let closeCalls = 0;
    const server = createServer(transport, {
      handle: async () => await handlerDeferred.promise,
      close: () => { closeCalls += 1; },
    });
    await startServer(server, transport);
    transport.emitMessage(request(1, 'slow', null));
    await waitFor(() => server.diagnostics().inFlight === 1);
    transport.emitDisconnect();

    expect(server.diagnostics()).toMatchObject({
      state: 'failed',
      disconnectObserved: true,
      inFlight: 1,
    });
    expect(closeCalls).toBe(0);
    handlerDeferred.resolve({ ignored: true });
    await expectDatabaseError(server.finished(), 'DATABASE_EXECUTOR_FAILED');
    expect(closeCalls).toBe(1);
    expect(transport.sent).toHaveLength(1);
    expect(transport.disconnectCalls).toBe(0);
    await expectDatabaseError(server.close(), 'DATABASE_EXECUTOR_FAILED');
    expect(closeCalls).toBe(1);
  });

  test('uses the production process adapter with the parent executor', async () => {
    const executor = new SubprocessDatabaseExecutor({
      command: [process.execPath, E2E_FIXTURE_PATH],
      env: {},
      role: 'database-server-e2e',
      slot: 9,
      startupTimeoutMs: 1_000,
      operationTimeoutMs: 1_000,
      shutdownAckTimeoutMs: 500,
      shutdownExitTimeoutMs: 500,
      sigtermTimeoutMs: 500,
      sigkillTimeoutMs: 500,
    });
    try {
      await executor.start();
      expect(await executor.execute<{ readonly value: string }>({
        operation: 'echo',
        kind: 'read',
        payload: { value: 'through-process-ipc' },
      })).toEqual({ value: 'through-process-ipc' });
      await expectDatabaseError(executor.execute({
        operation: 'fail',
        kind: 'write',
        payload: null,
      }), 'DATABASE_CONFLICT');
    } finally {
      await executor.close();
    }
    expect(executor.diagnostics()).toMatchObject({
      state: 'closed',
      exitCode: 0,
      lastFailureCode: null,
    });
  });
});

interface CreateServerOverrides {
  readonly handle?: (
    request: Parameters<ConstructorParameters<typeof SubprocessDatabaseServer>[0]['handle']>[0],
  ) => DatabaseExecutorValue | Promise<DatabaseExecutorValue>;
  readonly close?: () => void | Promise<void>;
}

function createServer(
  transport: FakeTransport,
  overrides: CreateServerOverrides = {},
): SubprocessDatabaseServer {
  return new SubprocessDatabaseServer({
    role: ROLE,
    slot: SLOT,
    transport,
    handle: overrides.handle ?? ((request) => request.payload),
    close: overrides.close,
  });
}

async function startServer(
  server: SubprocessDatabaseServer,
  transport: FakeTransport,
): Promise<void> {
  const starting = server.start();
  transport.emitMessage(handshake());
  await starting;
  expect(transport.sent[0]).toMatchObject({ type: 'ready', ...SESSION });
}

function handshake(): Record<string, unknown> {
  return { ...SESSION, type: 'handshake' };
}

function request(
  requestId: number,
  operation: string,
  payload: DatabaseExecutorValue,
): Record<string, unknown> {
  return {
    ...SESSION,
    type: 'request',
    requestId,
    operation,
    operationKind: 'read',
    payload,
  };
}

function shutdown(): Record<string, unknown> {
  return { ...SESSION, type: 'shutdown' };
}

class FakeTransport implements SubprocessDatabaseServerTransport {
  readonly sent: SubprocessDatabaseExecutorEvent[] = [];
  readonly order: string[] = [];
  disconnectCalls = 0;
  private messageListener: ((message: unknown) => void) | null = null;
  private disconnectListener: (() => void) | null = null;

  send(message: SubprocessDatabaseExecutorEvent): void {
    this.sent.push(message);
    this.order.push(`send:${message.type}`);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.order.push('disconnect');
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  offMessage(listener: (message: unknown) => void): void {
    if (this.messageListener === listener) this.messageListener = null;
  }

  onDisconnect(listener: () => void): void {
    this.disconnectListener = listener;
  }

  offDisconnect(listener: () => void): void {
    if (this.disconnectListener === listener) this.disconnectListener = null;
  }

  emitMessage(message: unknown): void {
    this.messageListener?.(message);
  }

  emitDisconnect(): void {
    this.disconnectListener?.();
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 1_000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('Timed out waiting for test state.');
    await Bun.sleep(1);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function expectDatabaseError(
  promise: Promise<unknown>,
  code: DatabaseError['code'],
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe(code);
    return;
  }
  throw new Error('Expected a DatabaseError rejection.');
}

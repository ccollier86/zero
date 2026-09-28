import { describe, expect, test } from 'bun:test';

import { createAsyncDatabaseClient } from './database-client';
import { DatabaseError } from './database-error';
import type {
  AsyncDatabaseOperationExecutor,
  DatabaseOperation,
  DatabaseOperationExecutionOptions,
} from './database-operations';

describe('createAsyncDatabaseClient', () => {
  test('builds bound declarative operations without exposing routing or raw execution', async () => {
    const calls: Array<{
      operation: DatabaseOperation;
      options: DatabaseOperationExecutionOptions | undefined;
    }> = [];
    const executor = createExecutor(calls);
    const client = createAsyncDatabaseClient({ executor });

    expect(Reflect.ownKeys(client)).toEqual([]);
    expect(Object.isFrozen(client)).toBe(true);
    expect('execute' in client).toBe(false);
    expect(JSON.stringify(client)).toBe('{}');

    await client.get('todos', 'a', {
      consistency: { mode: 'strong' },
      queueTimeoutMs: 25,
      operationTimeoutMs: 50,
    });
    await client.list('todos', { limit: 10, after: 'a' });
    await client.query('todos.count', null);
    await client.mutate(
      { type: 'delete', table: 'todos', id: 'a' },
      { idempotencyKey: 'delete:a' },
    );
    await client.batch({
      assertions: [{ type: 'row-exists', table: 'todos', id: 'b' }],
      mutations: [{ type: 'delete', table: 'todos', id: 'b' }],
    }, { idempotencyKey: 'batch:b' });
    await client.command('todos.rename', { id: 'c' }, {
      idempotencyKey: 'command:c',
    });

    expect(calls.map((call) => call.operation.type)).toEqual([
      'get', 'list', 'query', 'mutate', 'batch', 'command',
    ]);
    expect(calls[0]).toEqual({
      operation: {
        type: 'get',
        table: 'todos',
        id: 'a',
        consistency: { mode: 'strong' },
      },
      options: { queueTimeoutMs: 25, operationTimeoutMs: 50 },
    });
    expect(calls[3]!.operation).toMatchObject({
      type: 'mutate',
      idempotencyKey: 'delete:a',
    });
  });

  test('revalidates reads before dispatch and before returning data', async () => {
    const order: string[] = [];
    const executor = {
      async execute() {
        order.push('execute');
        return { value: null, sequence: { seq: 0 } };
      },
    } as unknown as AsyncDatabaseOperationExecutor;
    const client = createAsyncDatabaseClient({
      executor,
      assertReadAuthority() {
        order.push('authority');
        return undefined;
      },
    });

    await client.get('todos', 'a');
    expect(order).toEqual(['authority', 'execute', 'authority']);
  });

  test('fails closed and strips hostile authority failures before and after a read', async () => {
    let checks = 0;
    let dispatches = 0;
    const client = createAsyncDatabaseClient({
      executor: {
        async execute() {
          dispatches += 1;
          return { value: { secret: 'must-not-return' }, sequence: { seq: 1 } };
        },
      } as unknown as AsyncDatabaseOperationExecutor,
      assertReadAuthority() {
        checks += 1;
        if (checks === 2) throw new Error('/private/path secret-value');
        return undefined;
      },
    });

    const error = await captureError(() => client.get('todos', 'a'));
    expect(dispatches).toBe(1);
    expect(error.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(error.outcome).toBeNull();
    expect(error.message).not.toContain('secret-value');
    expect(error.cause).toBeUndefined();
  });

  test('reports a pre-dispatch read-authority failure as not started', async () => {
    let dispatches = 0;
    const client = createAsyncDatabaseClient({
      executor: {
        async execute() {
          dispatches += 1;
          return { value: null, sequence: { seq: 0 } };
        },
      } as unknown as AsyncDatabaseOperationExecutor,
      assertReadAuthority() {
        throw new Error('revoked');
      },
    });

    const error = await captureError(() => client.get('todos', 'a'));
    expect(dispatches).toBe(0);
    expect(error.code).toBe('DATABASE_AUTHORITY_CHANGED');
    expect(error.outcome).toBe('not-started');
  });

  test('rejects value-returning and asynchronous read checks at runtime', async () => {
    const executor = {
      async execute() {
        return { value: null, sequence: { seq: 0 } };
      },
    } as unknown as AsyncDatabaseOperationExecutor;

    const valueClient = createAsyncDatabaseClient({
      executor,
      assertReadAuthority: (() => true) as unknown as () => undefined,
    });
    const valueError = await captureError(() => valueClient.get('todos', 'a'));
    expect(valueError.code).toBe('DATABASE_CONFIG_INVALID');
    expect(valueError.outcome).toBe('not-started');

    let rejectionWasDelivered = false;
    const rejectedThenable = {
      then(_resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        rejectionWasDelivered = true;
        reject(new Error('private rejection'));
      },
    };
    const asyncClient = createAsyncDatabaseClient({
      executor,
      assertReadAuthority: (
        () => rejectedThenable
      ) as unknown as () => undefined,
    });
    const asyncError = await captureError(() => asyncClient.get('todos', 'a'));
    expect(asyncError.code).toBe('DATABASE_CONFIG_INVALID');
    await Promise.resolve();
    await Promise.resolve();
    expect(rejectionWasDelivered).toBe(true);
  });
});

function createExecutor(
  calls: Array<{
    operation: DatabaseOperation;
    options: DatabaseOperationExecutionOptions | undefined;
  }>,
): AsyncDatabaseOperationExecutor {
  return {
    async execute(
      operation: DatabaseOperation,
      options?: DatabaseOperationExecutionOptions,
    ) {
      calls.push({ operation, options });
      return operation.type === 'get'
        || operation.type === 'list'
        || operation.type === 'query'
        ? { value: null, sequence: { seq: 0 } }
        : {
            value: null,
            sequence: { seq: 0 },
            idempotencyKey: operation.idempotencyKey,
            replayed: false,
          };
    },
  } as unknown as AsyncDatabaseOperationExecutor;
}

async function captureError(operation: () => Promise<unknown>): Promise<DatabaseError> {
  try {
    await operation();
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected DatabaseError.');
}

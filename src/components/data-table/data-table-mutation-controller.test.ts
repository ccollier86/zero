import { describe, expect, test } from 'bun:test';
import {
  DataTableMutationController,
  DataTableMutationLifecycleError,
} from './data-table-mutation-controller';

describe('DataTableMutationController', () => {
  test('deduplicates one key and awaits execution plus refresh', async () => {
    const write = deferred<void>();
    const refresh = deferred<void>();
    let writes = 0;
    let refreshes = 0;
    const controller = new DataTableMutationController({
      boundaryKey: 'tenant:alpha',
      refresh: () => {
        refreshes += 1;
        return refresh.promise;
      },
    });
    const operation = {
      key: 'row:one:archive',
      kind: 'row' as const,
      execute: async () => {
        writes += 1;
        await write.promise;
      },
    };

    const first = controller.run(operation);
    const duplicate = controller.run(operation);
    expect(duplicate).toBe(first);
    expect(controller.isPending(operation.key)).toBe(true);
    await flushMicrotasks();
    expect(writes).toBe(1);

    write.resolve();
    await flushMicrotasks();
    expect(refreshes).toBe(1);
    expect(controller.isPending(operation.key)).toBe(true);

    refresh.resolve();
    await first;
    expect(controller.isPending(operation.key)).toBe(false);
    expect(controller.getError(operation.key)).toBeNull();

    await controller.run({ ...operation, refreshOnSuccess: false });
    expect(writes).toBe(2);
  });

  test('stores only safe failure state and retries the exact operation', async () => {
    const presented: string[] = [];
    let reject = true;
    let calls = 0;
    const controller = new DataTableMutationController({
      boundaryKey: 'tenant:alpha',
      onFailure: (failure) => presented.push(JSON.stringify(failure)),
    });
    const operation = {
      key: 'cell:patient-secret:notes',
      kind: 'cell' as const,
      execute: () => {
        calls += 1;
        if (reject) throw new Error('raw patient data must not be presented');
      },
    };

    await expect(controller.run(operation)).rejects.toThrow('raw patient data');
    expect(controller.getError(operation.key)).toEqual({
      code: 'DATA_TABLE_MUTATION_FAILED',
      message: 'The change could not be saved. Try again.',
      kind: 'cell',
      stage: 'execute',
    });
    expect(presented.join(' ')).not.toContain('patient data');

    reject = false;
    await controller.retry(operation.key);
    expect(calls).toBe(2);
    expect(controller.getError(operation.key)).toBeNull();
  });

  test('aborts stale scope work without letting it erase a replacement operation', async () => {
    const stale = deferred<void>();
    const current = deferred<void>();
    let staleSignal: AbortSignal | null = null;
    const controller = new DataTableMutationController({
      boundaryKey: 'tenant:alpha',
    });

    const stalePromise = controller.run({
      key: 'cell:one:name',
      kind: 'cell',
      execute: ({ signal }) => {
        staleSignal = signal;
        return stale.promise;
      },
    });
    await Promise.resolve();
    controller.replaceBoundary('tenant:beta', true);
    const currentPromise = controller.run({
      key: 'cell:one:name',
      kind: 'cell',
      execute: () => current.promise,
    });

    await expect(stalePromise).rejects.toMatchObject({
      code: 'DATA_TABLE_MUTATION_CANCELLED',
    });
    expect((staleSignal as AbortSignal | null)?.aborted).toBe(true);
    expect(controller.isPending('cell:one:name')).toBe(true);

    stale.resolve();
    await Promise.resolve();
    expect(controller.isPending('cell:one:name')).toBe(true);
    current.resolve();
    await currentPromise;
    expect(controller.isPending('cell:one:name')).toBe(false);
  });

  test('retries only refresh after the mutation was already accepted', async () => {
    let writes = 0;
    let refreshes = 0;
    let rejectRefresh = true;
    const controller = new DataTableMutationController({
      boundaryKey: 'tenant:alpha',
      refresh: () => {
        refreshes += 1;
        if (rejectRefresh) throw new Error('refresh unavailable');
      },
    });
    const key = 'row:one:archive';

    await expect(controller.run({
      key,
      kind: 'row',
      execute: () => { writes += 1; },
    })).rejects.toThrow('refresh unavailable');
    expect(writes).toBe(1);
    expect(refreshes).toBe(1);
    expect(controller.getError(key)).toEqual({
      code: 'DATA_TABLE_MUTATION_FAILED',
      message: 'The action completed, but the table could not refresh. Retry refresh.',
      kind: 'row',
      stage: 'refresh',
    });

    rejectRefresh = false;
    await controller.retry(key);
    expect(writes).toBe(1);
    expect(refreshes).toBe(2);
    expect(controller.getError(key)).toBeNull();
  });

  test('keeps different keys concurrent and makes unavailable boundaries fail closed', async () => {
    const alpha = deferred<void>();
    const beta = deferred<void>();
    const controller = new DataTableMutationController({ boundaryKey: 'scope' });
    const first = controller.run({ key: 'a', kind: 'row', execute: () => alpha.promise });
    const second = controller.run({ key: 'b', kind: 'row', execute: () => beta.promise });
    expect(controller.isPending('a')).toBe(true);
    expect(controller.isPending('b')).toBe(true);

    alpha.resolve();
    beta.resolve();
    await Promise.all([first, second]);
    controller.replaceBoundary('transition', false);

    const failure = await controller.run({
      key: 'blocked',
      kind: 'row',
      execute: () => undefined,
    }).catch((cause) => cause);
    expect(failure).toBeInstanceOf(DataTableMutationLifecycleError);
    expect(failure.code).toBe('DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE');
  });
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

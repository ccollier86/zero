import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DataStudioOperationTracker,
  resolveDataStudioAccess,
} from './data-studio-hooks';
import {
  DataStudioMutationError,
  type DataStudioCapabilities,
  type DataStudioMutationOptions,
  type DataStudioRow,
  type DataStudioSdkSurface,
  type DataStudioTable,
} from './data-studio-client';
import { canonicalizeDataStudioMutationInput } from './data-studio-mutation-key';
import {
  settlePostMutationRefreshes,
  useDataStudioMutations,
} from './use-data-studio-mutations';

const capabilities: DataStudioCapabilities = {
  enabled: true,
  scope: 'organization',
  permissions: { read: true, write: true, manage: true },
  limits: {
    maxTables: 10,
    maxRowsPerTable: 100,
    maxColumns: 20,
    maxPageSize: 50,
    maxRowBytes: 262_144,
  },
};

describe('Data Studio controller policy', () => {
  test('presentation capabilities can narrow but never widen server authority', () => {
    expect(resolveDataStudioAccess(capabilities, { canWrite: false })).toEqual({
      canRead: true,
      canWrite: false,
      canManage: true,
    });
    expect(resolveDataStudioAccess({
      ...capabilities,
      permissions: { read: true, write: false, manage: false },
    }, { canWrite: true, canManage: true })).toEqual({
      canRead: true,
      canWrite: false,
      canManage: false,
    });
  });

  test('retains an id only while the same ambiguous mutation is retried', () => {
    const tracker = new DataStudioOperationTracker();
    const first = tracker.begin('replace:row-1:value-a');
    tracker.fail('replace:row-1:value-a', new DataStudioMutationError(
      'unknown outcome',
      first,
      { requiresSameIdempotencyKey: true },
    ));
    expect(tracker.begin('replace:row-1:value-a')).toBe(first);
    expect(tracker.begin('replace:row-1:value-b')).not.toBe(first);

    tracker.succeed('replace:row-1:value-a');
    expect(tracker.begin('replace:row-1:value-a')).not.toBe(first);
  });

  test('drops the retained id after a definitive rejection', () => {
    const tracker = new DataStudioOperationTracker();
    const first = tracker.begin('delete:row-1');
    tracker.fail('delete:row-1', new DataStudioMutationError(
      'revision conflict',
      first,
      { code: 'DATA_STUDIO_REVISION_CONFLICT' },
    ));
    expect(tracker.begin('delete:row-1')).not.toBe(first);
  });

  test('gives concurrent identical operations distinct ids and retains ambiguous generations', () => {
    const tracker = new DataStudioOperationTracker();
    const first = tracker.begin('create:{"name":"same"}');
    const second = tracker.begin('create:{"name":"same"}');
    expect(second).not.toBe(first);

    tracker.fail('create:{"name":"same"}', new DataStudioMutationError(
      'second outcome unknown',
      second,
      { requiresSameIdempotencyKey: true },
    ), second);
    tracker.fail('create:{"name":"same"}', new DataStudioMutationError(
      'first outcome unknown',
      first,
      { requiresSameIdempotencyKey: true },
    ), first);

    // Completion order must not decide retry identity: generations serialize
    // in the order in which the logical operations originally began.
    expect(tracker.begin('create:{"name":"same"}')).toBe(first);
    expect(tracker.begin('create:{"name":"same"}')).toBe(second);
  });

  test('does not let reconciliation failures replace row mutation outcomes', async () => {
    const table: DataStudioTable = {
      tableId: 'table-one',
      key: 'contacts',
      name: 'Contacts',
      description: null,
      status: 'active',
      schema: {
        version: 1,
        columns: [{
          columnId: 'column-name',
          key: 'name',
          label: 'Name',
          type: 'text',
          required: true,
        }],
      },
      schemaRevision: 1,
      revision: 1,
      rowCount: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    const row: DataStudioRow = {
      rowId: 'row-one',
      tableId: table.tableId,
      schemaRevision: 1,
      revision: 1,
      values: { 'column-name': 'Ada' },
      createdAt: 1,
      updatedAt: 1,
    };
    const operationIds: string[] = [];
    let rejectCreate = false;
    let rejectedCreateError: DataStudioMutationError | null = null;
    let rejectDelete = false;
    let rejectedDeleteError: DataStudioMutationError | null = null;
    const surface = {
      async createRow(
        _tableId: string,
        _values: Readonly<Record<string, unknown>>,
        options?: DataStudioMutationOptions,
      ) {
        operationIds.push(options!.operationId!);
        if (rejectCreate) {
          rejectedCreateError = new DataStudioMutationError(
            'create outcome unknown',
            options!.operationId!,
            { requiresSameIdempotencyKey: true },
          );
          throw rejectedCreateError;
        }
        return row;
      },
      async replaceRow(
        _tableId: string,
        _rowId: string,
        _revision: number,
        _values: Readonly<Record<string, unknown>>,
        options?: DataStudioMutationOptions,
      ) {
        operationIds.push(options!.operationId!);
        return { ...row, revision: 2 };
      },
      async deleteRow(
        _tableId: string,
        _rowId: string,
        _revision: number,
        options?: DataStudioMutationOptions,
      ) {
        operationIds.push(options!.operationId!);
        if (rejectDelete) {
          rejectedDeleteError = new DataStudioMutationError(
            'the row changed first',
            options!.operationId!,
            { code: 'DATA_STUDIO_REVISION_CONFLICT' },
          );
          throw rejectedDeleteError;
        }
        return { deleted: true as const, rowId: row.rowId };
      },
    } as unknown as DataStudioSdkSurface;
    let controller!: ReturnType<typeof useDataStudioMutations>;
    const refreshes: string[] = [];
    let pendingMutations = 0;
    let blockedRowRefresh: {
      readonly entered: () => void;
      readonly wait: Promise<void>;
    } | null = null;

    function Capture() {
      controller = useDataStudioMutations({
        surface,
        access: { canRead: true, canWrite: true, canManage: true },
        selectedTable: table,
        selectedRow: row,
        tableStatus: 'active',
        boundaryKey: 'organization:one',
        boundaryKeyRef: { current: 'organization:one' },
        boundaryReadyRef: { current: true },
        selectedTableIdRef: { current: table.tableId },
        operationTracker: { current: new DataStudioOperationTracker() },
        setPendingMutations: (next) => {
          pendingMutations = typeof next === 'function' ? next(pendingMutations) : next;
        },
        setMutationError: () => undefined,
        setCatalogError: () => undefined,
        setTableStatusState: () => undefined,
        setSelectedTableId: () => undefined,
        setSelectedRowId: () => undefined,
        refreshRowsAfterMutation: async () => {
          refreshes.push('rows');
          const blocked = blockedRowRefresh;
          if (blocked) {
            blockedRowRefresh = null;
            blocked.entered();
            await blocked.wait;
            return;
          }
          throw new Error('row refresh unavailable');
        },
        refreshTableAfterMutation: async () => {
          refreshes.push('table');
          throw new Error('table refresh unavailable');
        },
      });
      return null;
    }

    renderToStaticMarkup(createElement(Capture));
    let markRefreshEntered!: () => void;
    let releaseRefresh!: () => void;
    const refreshEntered = new Promise<void>((resolve) => { markRefreshEntered = resolve; });
    const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    blockedRowRefresh = { entered: markRefreshEntered, wait: refreshGate };
    let createSettled = false;
    const create = controller.createRow({ name: 'Ada' }).finally(() => {
      createSettled = true;
    });
    await refreshEntered;
    expect(pendingMutations).toBe(1);
    expect(createSettled).toBe(false);
    releaseRefresh();
    await expect(create).resolves.toEqual(row);
    expect(pendingMutations).toBe(0);
    await expect(controller.replaceRow(row, { name: 'Grace' })).resolves.toMatchObject({
      rowId: row.rowId,
      revision: 2,
    });
    await expect(controller.deleteRow(row)).resolves.toBeUndefined();

    rejectDelete = true;
    let caught: unknown;
    try {
      await controller.deleteRow(row);
    } catch (cause) {
      caught = cause;
    }

    expect(caught).toBe(rejectedDeleteError);
    rejectCreate = true;
    let caughtCreate: unknown;
    try {
      await controller.createRow({ name: 'Possibly committed' });
    } catch (cause) {
      caughtCreate = cause;
    }
    expect(caughtCreate).toBe(rejectedCreateError);
    expect(operationIds).toHaveLength(5);
    expect(new Set(operationIds).size).toBe(5);
    expect(pendingMutations).toBe(0);
    expect(refreshes).toEqual([
      'rows', 'table',
      'rows',
      'rows', 'table',
      'rows', 'table',
      'rows', 'table',
    ]);
  });

  test('bounds a hung post-commit refresh without rejecting the verified mutation', async () => {
    const startedAt = Date.now();
    await expect(settlePostMutationRefreshes(
      'row.replace',
      [() => new Promise(() => {})],
      5,
    )).resolves.toBeUndefined();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});

describe('Data Studio mutation identity canonicalization', () => {
  test('is stable for plain JSON without reading property getters', () => {
    let getterCalls = 0;
    const accessor = Object.defineProperty({}, 'secret', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'leak';
      },
    });

    expect(canonicalizeDataStudioMutationInput({ b: 2, a: [true, null] }))
      .toBe('{"a":[true,null],"b":2}');
    expect(() => canonicalizeDataStudioMutationInput(accessor)).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });

  test('rejects cycles, sparse arrays, symbols, exotic objects, unsafe keys, and surrogates', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = 'value';
    const symbol = { value: 1 } as Record<PropertyKey, unknown>;
    symbol[Symbol('hidden')] = 2;
    const unsafe = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(unsafe, 'constructor', { enumerable: true, value: 'blocked' });

    for (const value of [
      cyclic,
      sparse,
      symbol,
      new Date(),
      unsafe,
      '\ud800',
    ]) {
      expect(() => canonicalizeDataStudioMutationInput(value)).toThrow(TypeError);
    }
  });

  test('closes hostile reflective failures and enforces depth limits', () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error('trap');
      },
    });
    let deep: unknown = null;
    for (let index = 0; index < 40; index += 1) deep = [deep];

    expect(() => canonicalizeDataStudioMutationInput(hostile)).toThrow(TypeError);
    expect(() => canonicalizeDataStudioMutationInput(deep)).toThrow(TypeError);
    expect(() => canonicalizeDataStudioMutationInput('x'.repeat(768 * 1_024 + 1)))
      .toThrow(TypeError);
  });
});

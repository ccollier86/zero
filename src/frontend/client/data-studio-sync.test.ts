import { describe, expect, test } from 'bun:test';
import { DATA_STUDIO_CLIENT_TABLES } from '../../data-studio/data-studio-client-tables';
import {
  createSyncStore,
  createTableSlice,
  routeServerMessage,
} from '../../sync/client/sync-store';
import type { Row } from '../../sync/types';
import {
  subscribeToDataStudioSync,
  type DataStudioReconciliationEvent,
  type DataStudioSyncCollectionSource,
} from './data-studio-sync';

describe('Data Studio Sync reconciliation bridge', () => {
  test('emits bounded catalog and affected-row signals and cleans up', () => {
    const catalog = new FakeCollection();
    const rows = new FakeCollection();
    const source: DataStudioSyncCollectionSource = {
      collection(name) {
        return name === 'data_studio_tables' ? catalog : rows;
      },
    };
    const events: DataStudioReconciliationEvent[] = [];
    const unsubscribe = subscribeToDataStudioSync(source, (event) => events.push(event));
    expect(events).toEqual([
      { kind: 'catalog', tableIds: [] },
      { kind: 'rows', tableIds: [] },
    ]);
    events.length = 0;

    catalog.emit({
      table_record: { table_id: 'table_b', revision: 2 },
    });
    rows.emit({
      row_record: { record_id: 'row_record', table_id: 'table_b', revision: 3 },
    });
    rows.emit({});

    expect(events).toEqual([
      { kind: 'catalog', tableIds: ['table_b'] },
      { kind: 'rows', tableIds: ['table_b'] },
      { kind: 'rows', tableIds: ['table_b'] },
    ]);

    unsubscribe();
    catalog.emit({ table_other: { table_id: 'table_c' } });
    expect(events).toHaveLength(3);
  });

  test('stays read-only and bounds malformed row projections', () => {
    const row = { record_id: 'row_record', table_id: 'table_a', revision: 1 };
    const rows = new FakeCollection({ row_record: row });
    const source: DataStudioSyncCollectionSource = {
      collection(name) {
        return name === 'data_studio_rows' ? rows : null;
      },
    };
    const events: DataStudioReconciliationEvent[] = [];
    subscribeToDataStudioSync(source, (event) => events.push(event));
    events.length = 0;

    rows.emit({ row_record: row });
    rows.emit({ malformed: { record_id: 'malformed', revision: 2 } });

    expect(events).toEqual([
      { kind: 'rows', tableIds: [] },
      { kind: 'rows', tableIds: ['table_a'] },
    ]);
  });

  test('forwards an unseen lazy-row delete as an empty active-table wildcard', () => {
    const rows = new FakeCollection();
    const source: DataStudioSyncCollectionSource = {
      collection(name) {
        return name === 'data_studio_rows' ? rows : null;
      },
    };
    const events: DataStudioReconciliationEvent[] = [];
    subscribeToDataStudioSync(source, (event) => events.push(event));
    events.length = 0;

    // Sync applies DELETE by cloning the lazy table even when that row was
    // never demand-loaded, so both observable projections are empty.
    rows.emit({});

    expect(events).toEqual([{ kind: 'rows', tableIds: [] }]);
  });

  test('observes an update for a lazy row that was never snapshot-loaded', () => {
    const { store } = createSyncStore({ ...DATA_STUDIO_CLIENT_TABLES });
    const catalog = createTableSlice<Row>(store, 'data_studio_tables');
    const rows = createTableSlice<Row>(store, 'data_studio_rows');
    const source: DataStudioSyncCollectionSource = {
      collection(name) {
        const slice = name === 'data_studio_tables' ? catalog : rows;
        return {
          getAll: slice.get,
          subscribe: slice.subscribe,
        };
      },
    };
    const events: DataStudioReconciliationEvent[] = [];
    subscribeToDataStudioSync(source, (event) => events.push(event));
    events.length = 0;

    // Lazy mode omits the initial snapshot, but the socket remains subscribed
    // to the table. The real Sync reducer therefore installs an unseen UPDATE
    // by row id and the Data Studio bridge receives its table invalidation.
    routeServerMessage(store, {
      type: 'sync.change',
      seq: 1,
      table: 'data_studio_rows',
      op: 'UPDATE',
      rowId: 'record_existing',
      row: {
        record_id: 'record_existing',
        table_id: 'table_existing',
        row_id: 'row_existing',
        revision: 2,
      },
      origin: 'remote-writer',
      ts: 1,
    });

    expect(rows.get()).toEqual({
      record_existing: expect.objectContaining({
        table_id: 'table_existing',
        revision: 2,
      }),
    });
    expect(events).toEqual([{
      kind: 'rows',
      tableIds: ['table_existing'],
    }]);
  });

  test('cannot miss a commit interleaved with subscription baseline capture', () => {
    let catalog!: FakeCollection;
    catalog = new FakeCollection({}, () => {
      catalog.emit({
        table_gap: { table_id: 'table_gap', revision: 2 },
      });
    });
    const source: DataStudioSyncCollectionSource = {
      collection(name) {
        return name === 'data_studio_tables' ? catalog : null;
      },
    };
    const events: DataStudioReconciliationEvent[] = [];

    subscribeToDataStudioSync(source, (event) => events.push(event));

    expect(events).toEqual([{ kind: 'catalog', tableIds: ['table_gap'] }]);
  });
});

class FakeCollection {
  private listeners = new Set<(rows: Record<string, Row>) => void>();

  constructor(
    private rows: Record<string, Row> = {},
    private beforeFirstRead?: () => void,
  ) {}

  getAll(): Record<string, Row> {
    const beforeRead = this.beforeFirstRead;
    this.beforeFirstRead = undefined;
    beforeRead?.();
    return this.rows;
  }

  subscribe(callback: (rows: Record<string, Row>) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  emit(rows: Record<string, Row>): void {
    this.rows = rows;
    for (const listener of this.listeners) listener(rows);
  }
}

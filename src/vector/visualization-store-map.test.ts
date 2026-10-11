/** Private projection persistence uses actor operations and never live application databases. */
import { describe, expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { createAsyncDatabaseClient } from '../databases/database-client';
import type { AsyncDatabaseOperationExecutor } from '../databases/database-operation-contracts';
import { defineDatabaseRealm } from '../databases/database-realm';
import { DatabaseRuntime } from '../databases/database-runtime';
import { DatabaseWriterOperationEngine } from '../databases/database-writer-engine';
import { AsyncVectorVisualizationMapStore } from './visualization-store-map';
import { fitVisualizationProjection, transformVisualizationVector, type VisualizationProjection } from './visualization-projection';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_MAP_SCHEMA } from './visualization-schema';
import type { VectorVisualizationMap } from './visualization-types';

function fixture() {
  const realm = defineDatabaseRealm({ name: 'visualization-map-tests', version: '1',
    tables: { [VECTOR_VISUALIZATION_MAPS_TABLE]: VECTOR_VISUALIZATION_MAP_SCHEMA } });
  const runtime = DatabaseRuntime.open({ id: 'visualization-map-tests', role: 'named',
    sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true, tables: realm.tables });
  const engine = new DatabaseWriterOperationEngine({ runtime, realm });
  const client = createAsyncDatabaseClient({ executor: {
    async execute(operation) { return engine.execute(operation); },
  } as AsyncDatabaseOperationExecutor });
  return { runtime, client, store: new AsyncVectorVisualizationMapStore(client, 'corpus:a'),
    close() { engine.close(); runtime.close(); } };
}
function map(projection: VisualizationProjection): VectorVisualizationMap {
  return { revision: 1, projectionId: projection.id, projectionKind: 'pca', dimensions: projection.dimensions,
    points: [], clusters: [], capabilities: { nativeTraversal: false, graph: 'none', liveUpdates: true } };
}

describe('AsyncVectorVisualizationMapStore', () => {
  test('reattaches the exact fitted frame without changing its query coordinates or leaking another corpus', async () => {
    const f = fixture();
    try {
      const projection = fitVisualizationProjection([{ id: 'a', vector: [1, 0, .5] }, { id: 'b', vector: [0, 1, -.5] }]);
      const state = { projection, map: map(projection) };
      await f.store.put('docs', state, 0);
      const attached = await new AsyncVectorVisualizationMapStore(f.client, 'corpus:a').get('docs');
      expect(attached).toEqual(state);
      expect(transformVisualizationVector(attached!.projection, [.25, .5, 0])).toEqual(transformVisualizationVector(projection, [.25, .5, 0]));
      expect(await new AsyncVectorVisualizationMapStore(f.client, 'corpus:b').get('docs')).toBeNull();
      const row = f.runtime.db.prepare(`SELECT projection_json FROM ${VECTOR_VISUALIZATION_MAPS_TABLE}`).get() as { projection_json: string };
      expect(row.projection_json).toContain('deflate-f64le-planes-v1');
      expect(row.projection_json).not.toContain('"mean":');
    } finally { f.close(); }
  });

  test('8192-coordinate artifacts compactly preserve every double rather than rounding fitted axes', async () => {
    const f = fixture();
    try {
      const dimensions = 8_192;
      const projection: VisualizationProjection = {
        id: 'wide-exact', dimensions, inputScale: 1,
        mean: Array.from({ length: dimensions }, (_, i) => Math.sin(i * 1.23456789)),
        axes: [Array.from({ length: dimensions }, (_, i) => Math.cos(i * .987654321) / 100),
          Array.from({ length: dimensions }, (_, i) => Math.sin(i * .876543219) / 100)],
        bounds: { minX: -.5, maxX: .5, minY: -.5, maxY: .5 }, seedIds: ['a', 'b'],
      };
      await f.store.put('wide', { projection, map: map(projection) }, 0);
      const attached = await f.store.get('wide');
      expect(attached!.projection).toEqual(projection);
      const row = f.runtime.db.prepare(`SELECT projection_json FROM ${VECTOR_VISUALIZATION_MAPS_TABLE}`).get() as { projection_json: string };
      expect(new TextEncoder().encode(row.projection_json).byteLength).toBeLessThan(240_000);
    } finally { f.close(); }
  });

  test('CAS fences competing map revisions and malformed/oversized compressed artifacts fail closed', async () => {
    const f = fixture();
    try {
      const projection = fitVisualizationProjection([], { dimensions: 3 });
      await f.store.put('docs', { projection, map: map(projection) }, 0);
      const next = { projection, map: { ...map(projection), revision: 2 } };
      const competing = { projection, map: { ...next.map, clusters: [{ id: 'other', label: 'Other' }] } };
      const results = await Promise.allSettled([f.store.put('docs', next, 1), f.store.put('docs', competing, 1)]);
      expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
      const row = f.runtime.db.prepare(`SELECT map_id FROM ${VECTOR_VISUALIZATION_MAPS_TABLE}`).get() as { map_id: string };
      f.runtime.db.update(VECTOR_VISUALIZATION_MAPS_TABLE, row.map_id, { projection_json: JSON.stringify({
        ...projection, encoding: 'deflate-f64le-v1', dimensions: 1_000_000, data: 'AAAA',
      }) });
      await expect(f.store.get('docs')).rejects.toThrow();
    } finally { f.close(); }
  });
});

/** Query and corpus coordinates must always describe one accepted projection frame. */
import { expect, it } from 'bun:test';
import { VectorVisualizationService } from './visualization-service';
import type { VectorVisualizationServiceOptions } from './visualization-service-context';
import type { VectorVisualizationSnapshot } from './visualization-types';
import type { StoredVectorRecord } from './vector-types';
import { VectorVisualizationMapCoordinator } from './visualization-service-map';
import type { VectorVisualizationMapState } from './visualization-store-map';
import { transformVisualizationVector } from './visualization-projection';

function fixture() {
  const records = new Map<string, StoredVectorRecord>();
  const snapshots = new Map<string, VectorVisualizationSnapshot>();
  const frames = new Map<string, VectorVisualizationMapState>();
  const copy = <T>(value: T): T => structuredClone(value);
  const options: VectorVisualizationServiceOptions = {
    index: 'docs', scopeId: 'tenant:a', dimensions: 3, assertCurrentAuthority() {}, emitCode: () => undefined as never,
    ai: { embed: async () => ({ embedding: [1, 0, 0] }) } as unknown as VectorVisualizationServiceOptions['ai'],
    vectors: {
      async query() { return [...records.values()].map(copy); },
      async fetch(ids) { return (typeof ids === 'string' ? [ids] : ids).flatMap(id => records.has(id) ? [copy(records.get(id)!)] : []); },
      async upsert() { return { ok: true, count: 0, errors: [] }; },
    },
    store: {
      async create(snapshot) { snapshots.set(snapshot.id, copy(snapshot)); return copy(snapshot); },
      async get(id) { return copy(snapshots.get(id) ?? null); },
      async list() { return [...snapshots.values()].map(copy); },
      async compareAndSwap(id, revision, next) {
        if (snapshots.get(id)?.revision !== revision) throw new Error('conflict');
        snapshots.set(id, copy(next)); return copy(next);
      },
    },
    maps: {
      async get(index) { return copy(frames.get(index) ?? null); },
      async put(index, state, revision) {
        if ((frames.get(index)?.map.revision ?? 0) !== revision) throw new Error('conflict');
        frames.set(index, copy(state)); return copy(state);
      },
    },
  };
  return { options, records, frames };
}

it('search projects the query using the final frame after an empty map bootstraps', async () => {
  const f = fixture(), service = new VectorVisualizationService(f.options);
  try {
    const empty = await service.map();
    f.records.set('a', { id: 'a', vector: [1, 0, 0], metadata: {} });
    f.records.set('b', { id: 'b', vector: [-1, 0, 0], metadata: {} });
    const result = await service.search({ text: 'actual query', topK: 2 });
    const frame = f.frames.get('docs')!;
    expect(result.status).toBe('completed');
    expect(result.map?.projectionId).not.toBe(empty.projectionId);
    expect(result.map?.projectionId).toBe(frame.projection.id);
    expect(result.query?.position).toEqual(transformVisualizationVector(frame.projection, [1, 0, 0]));
    expect(result.query?.position).toEqual(result.map?.points.find(point => point.id === 'a')?.position);
  } finally { await service.dispose(); }
});

it('a queued refresh cannot substitute a later frame for an accepted query position', async () => {
  const f = fixture(), coordinator = new VectorVisualizationMapCoordinator(f.options);
  const first = { id: 'a', vector: [1, 0, 0], metadata: {} };
  const second = { id: 'b', vector: [-1, 0, 0], metadata: {} };
  const accepted = coordinator.acceptQuery([first, second], [1, 0, 0]);
  f.records.set('c', { id: 'c', vector: [0, 1, 0], metadata: {} });
  f.records.set('d', { id: 'd', vector: [0, -1, 0], metadata: {} });
  const refreshed = coordinator.get(true);
  const result = await accepted, later = await refreshed;
  expect(result.position).toEqual(result.map.points.find(point => point.id === 'a')!.position);
  expect(later.projectionId).not.toBe(result.map.projectionId);
  expect(result.position).not.toEqual(coordinator.position([1, 0, 0]));
});

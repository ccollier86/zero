/**
 * visualization-service-map.ts
 *
 * Builds a bounded authorized sample from real stored records, retaining the
 * fitted projection across queries and process reattachment. Derived sample
 * neighbors are explicitly not native index traversal or corpus statistics.
 */
import { VectorError } from './vector-error';
import type { StoredVectorRecord } from './vector-types';
import { deriveVisualizationNeighbors, fitVisualizationProjection, transformVisualizationVector } from './visualization-projection';
import type { VectorVisualizationMapState } from './visualization-store-map';
import type { VectorVisualizationMap, VectorVisualizationPoint, VectorVisualizationPosition, VectorVisualizationSource } from './visualization-types';
import { copy, validateEmbedding, type VectorVisualizationServiceOptions } from './visualization-service-context';
import { awaitVisualizationExternal, type VisualizationOperationContext } from './visualization-service-context';
import { emitVectorOperationFailed } from './vector-observability';

/** Owns only one authorized corpus/index map; all actual reads use the supplied VectorScope. */
export class VectorVisualizationMapCoordinator {
  private state: VectorVisualizationMapState | null = null;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: VectorVisualizationServiceOptions) {}

  /** Explicit refresh may refit; ordinary attachment and search never refit an existing frame. */
  get(refresh = false, authorityFence?: () => void): Promise<VectorVisualizationMap> {
    return this.serial(() => this.build([], refresh, authorityFence));
  }

  /** Include actual accepted records without rotating or recentering existing points. */
  accept(records: readonly StoredVectorRecord[], authorityFence?: () => void): Promise<VectorVisualizationMap> {
    return this.serial(() => this.build(records, false, authorityFence));
  }

  /** Capture query coordinates inside the same serialized, accepted projection frame. */
  acceptQuery(records: readonly StoredVectorRecord[], vector: readonly number[], authorityFence?: () => void):
    Promise<{ map: VectorVisualizationMap; position: VectorVisualizationPosition }> {
    return this.serial(async () => {
      const map = await this.build(records, false, authorityFence);
      // No refresh or other operation can change this.state until this work completes.
      return { map, position: this.position(vector) };
    });
  }

  position(vector: readonly number[]) {
    if (!this.state) throw new VectorError('VECTOR_CONFIG_INVALID', 'Visualization map has not been initialized.');
    return transformVisualizationVector(this.state.projection, Array.from(vector));
  }

  private async serial<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work, work);
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  private async build(extra: readonly StoredVectorRecord[], refresh: boolean,
    authorityFence?: () => void): Promise<VectorVisualizationMap> {
    const assertAuthority = () => { this.options.assertCurrentAuthority(); authorityFence?.(); };
    for (let attempt = 0; attempt < 3; attempt++) {
      assertAuthority();
      const persisted = await this.options.maps?.get(this.options.index);
      const before = persisted ?? this.state;
      if (before && before.projection.dimensions !== this.options.dimensions) {
        throw new VectorError('VECTOR_DIMENSION_MISMATCH', 'Stored projection belongs to a different index dimension.');
      }
      const loaded = !before || refresh
        ? await this.options.vectors.query({ topK: this.options.sampleSize ?? 96, includeVector: true })
        : before.map.points.length ? await this.options.vectors.fetch(before.map.points.map(point => point.id), { includeVector: true }) : [];
      assertAuthority();
      const rows = new Map<string, StoredVectorRecord>();
      for (const row of [...loaded, ...extra]) {
        if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 1_024 || !row.vector) {
          throw new VectorError('VECTOR_OPERATION_FAILED', 'Stored map sample is invalid.');
        }
        validateEmbedding(row.vector, this.options.dimensions);
        rows.set(row.id, row);
      }
      // Demand records have priority over old decorative sample points, but the
      // fitted frame is retained even when some original seeds leave the view.
      const demand = new Set(extra.map(row => row.id));
      const records = [...rows.values()].sort((a, b) => Number(demand.has(b.id)) - Number(demand.has(a.id))
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 400);
      // Empty/single/identical-vector frames have no meaningful coordinate
      // system yet. Bootstrap until real variance appears, then keep it fixed.
      const bootstrap = before && before.projection.bounds.minX === before.projection.bounds.maxX
        && before.projection.bounds.minY === before.projection.bounds.maxY;
      const projection = !before || refresh || bootstrap
        ? fitVisualizationProjection(records.map(row => ({ id: row.id, vector: row.vector! })), { dimensions: this.options.dimensions })
        : before.projection;
      const neighbors = deriveVisualizationNeighbors(records.map(row => ({ id: row.id, vector: row.vector! })), 4);
      const points: VectorVisualizationPoint[] = records.map(row => ({
        id: row.id, ...recordPresentation(row, this.options),
        position: transformVisualizationVector(projection, row.vector!), neighborIds: neighbors.neighborIds[row.id], kind: 'stored',
      }));
      const clusterIds = [...new Set(points.flatMap(point => point.clusterId ? [point.clusterId] : []))].sort();
      const map: VectorVisualizationMap = {
        revision: (before?.map.revision ?? 0) + 1, projectionId: projection.id,
        projectionKind: 'pca', dimensions: this.options.dimensions,
        ...(this.options.embeddingModel ? { model: this.options.embeddingModel } : {}), points,
        clusters: clusterIds.map(id => ({ id, label: id })),
        capabilities: { nativeTraversal: false, graph: points.length > 1 ? 'derived-neighbors' : 'none', liveUpdates: true },
      };
      const next = { projection, map };
      if (before && !refresh && JSON.stringify({ ...before.map, revision: 0 }) === JSON.stringify({ ...map, revision: 0 })) {
        this.state = before; return copy(before.map);
      }
      assertAuthority();
      try {
        this.state = this.options.maps ? await this.options.maps.put(this.options.index, next, before?.map.revision ?? 0) : next;
        assertAuthority();
        return copy(this.state.map);
      } catch (error) {
        // Concurrent authorized operations may add points to the same frame.
        // Re-read their winning artifact rather than publishing a new rotation.
        if (attempt === 2 || !this.options.maps) throw error;
        this.state = null;
      }
    }
    throw new VectorError('VECTOR_OPERATION_FAILED', 'Visualization map update could not be admitted.');
  }
}

/** Explicit metadata allowlist; native backup metadata is never copied wholesale. */
export function recordPresentation(record: StoredVectorRecord,
  options: VectorVisualizationServiceOptions): { title: string; source?: VectorVisualizationSource; clusterId?: string } {
  const fields = new Set(options.metadataFields ?? []);
  const text = (key: string, maximum: number): string | undefined => fields.has(key)
    && typeof record.metadata?.[key] === 'string' ? (record.metadata[key] as string).slice(0, maximum) : undefined;
  const title = text('title', 96) || record.id.slice(0, 96);
  const source = text('source_label', 64);
  const sourceId = text('source_id', 256);
  const sourceAbbreviation = text('source_abbreviation', 16);
  const clusterId = text('cluster_id', 64);
  return { title, ...(source ? { source: { label: source,
    ...(sourceId ? { id: sourceId } : {}), ...(sourceAbbreviation ? { abbreviation: sourceAbbreviation } : {}) } } : {}),
    ...(clusterId ? { clusterId } : {}) };
}

/** Operation rows remain bounded even when a standalone map contains a larger sample. */
export function operationMap(map: VectorVisualizationMap, requiredIds: readonly string[] = []): VectorVisualizationMap {
  const required = new Set(requiredIds);
  const points = [...map.points].sort((a, b) => Number(required.has(b.id)) - Number(required.has(a.id)))
    .slice(0, 128);
  const shown = new Set(points.map(point => point.id));
  return { ...map, points: points.map(point => ({ ...point, neighborIds: point.neighborIds?.filter(id => shown.has(id)) })) };
}

/** Map diagnostics cannot turn acknowledged storage or search results into fake failures. */
export async function mapDiagnostic<T>(context: VisualizationOperationContext,
  work: Promise<T>): Promise<T | undefined> {
  try { return await awaitVisualizationExternal(work, context.signal); }
  catch {
    // Do not swallow permission loss, persisted retirement or cancellation.
    await context.ensureCurrent();
    const warning = { code: 'VECTOR_OPERATION_FAILED', message: 'The optional vector map diagnostic is unavailable.' };
    await context.update(snapshot => {
      if (!snapshot.warnings?.some(item => item.code === warning.code && item.message === warning.message)) {
        snapshot.warnings = [...snapshot.warnings ?? [], warning].slice(-4);
      }
    });
    emitVectorOperationFailed(new VectorError('VECTOR_OPERATION_FAILED', warning.message), {
      index: context.options.index, operation: 'visualization.map',
    }, context.options.emitCode);
    return undefined;
  }
}

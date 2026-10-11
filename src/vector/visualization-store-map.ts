/**
 * visualization-store-map.ts
 *
 * Stores private, versioned projection artifacts and their public-safe bounded
 * map using actor-compatible database operations. It neither samples vectors
 * nor grants access to an index; the authorized service supplies both values.
 */
import type { AsyncDatabaseClient, DatabaseOperationRow } from '../databases/database-operation-contracts';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { VectorError } from './vector-error';
import { VECTOR_VISUALIZATION_MAPS_TABLE } from './visualization-schema';
import { transformVisualizationVector, type VisualizationProjection } from './visualization-projection';
import type { VectorVisualizationMap } from './visualization-types';

/** Private fitted frame plus the map the viewer is permitted to receive. */
export interface VectorVisualizationMapState {
  projection: VisualizationProjection;
  map: VectorVisualizationMap;
}

/** Persistence boundary for a stable corpus/index projection across reattachment. */
export interface VectorVisualizationMapStore {
  get(index: string): Promise<VectorVisualizationMapState | null>;
  put(index: string, state: VectorVisualizationMapState, expectedRevision: number): Promise<VectorVisualizationMapState>;
}

/** Exact corpus/index map persistence; the table is never generic client data. */
export class AsyncVectorVisualizationMapStore implements VectorVisualizationMapStore {
  constructor(private readonly client: AsyncDatabaseClient, private readonly scopeId: string) {
    if (!scopeId || scopeId.length > 256) throw invalid();
  }

  async get(index: string): Promise<VectorVisualizationMapState | null> {
    const row = await this.read(index);
    if (!row) return null;
    try {
      const state = { projection: decodeProjection(String(row.projection_json)), map: JSON.parse(String(row.snapshot_json)) };
      validate(state);
      if (row.revision !== state.map.revision) throw invalid();
      return state;
    } catch { throw invalid(); }
  }

  /** Revision zero means strict creation; every later put compares the complete row. */
  async put(index: string, state: VectorVisualizationMapState,
    expectedRevision: number): Promise<VectorVisualizationMapState> {
    validate(state);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0
      || state.map.revision !== expectedRevision + 1) throw invalid();
    const id = mapId(this.scopeId, index);
    const before = await this.read(index);
    if ((before ? before.revision : 0) !== expectedRevision) throw conflict();
    const row: DatabaseOperationRow = { map_id: id, scope_id: this.scopeId, index_name: index,
      revision: state.map.revision, projection_json: encodeProjection(state.projection),
      snapshot_json: encode(state.map), updated_at: new Date().toISOString() };
    await this.client.batch({
      assertions: [before ? { type: 'row-equals', table: VECTOR_VISUALIZATION_MAPS_TABLE, id, row: before }
        : { type: 'row-missing', table: VECTOR_VISUALIZATION_MAPS_TABLE, id }],
      mutations: [before ? { type: 'update', table: VECTOR_VISUALIZATION_MAPS_TABLE, id,
        patch: { revision: row.revision!, projection_json: row.projection_json!,
          snapshot_json: row.snapshot_json!, updated_at: row.updated_at! } }
        : { type: 'create', table: VECTOR_VISUALIZATION_MAPS_TABLE, row }],
    }, { idempotencyKey: `vv:map:${new Bun.CryptoHasher('sha256').update(`${id}:${state.map.revision}`).digest('hex')}` });
    return JSON.parse(JSON.stringify(state));
  }

  private async read(index: string): Promise<DatabaseOperationRow | null> {
    const result = await this.client.get(VECTOR_VISUALIZATION_MAPS_TABLE, mapId(this.scopeId, index),
      { consistency: { mode: 'strong' } });
    const row = result.value;
    if (row && (row.scope_id !== this.scopeId || row.index_name !== index)) throw invalid();
    return row;
  }
}

function mapId(scope: string, index: string): string {
  if (typeof index !== 'string' || !index || index.length > 128 || index.includes('\0')) throw invalid();
  return `vvmap_${new Bun.CryptoHasher('sha256').update(JSON.stringify([scope, index])).digest('hex')}`;
}

function validate(state: VectorVisualizationMapState): void {
  if (!state?.map || !state.projection || state.map.projectionId !== state.projection.id
    || state.map.dimensions !== state.projection.dimensions || !Number.isSafeInteger(state.map.revision)
    || state.map.revision < 1 || !Array.isArray(state.map.points) || state.map.points.length > 400
    || !Array.isArray(state.map.clusters)) throw invalid();
  transformVisualizationVector(state.projection, Array<number>(state.projection.dimensions).fill(0));
  const ids = new Set<string>();
  for (const point of state.map.points) {
    if (!point || typeof point.id !== 'string' || ids.has(point.id) || !point.position
      || !Number.isFinite(point.position.x) || !Number.isFinite(point.position.y)) throw invalid();
    ids.add(point.id);
  }
}

function encode(value: unknown): string {
  let json: string;
  try { json = JSON.stringify(value); } catch { throw invalid(); }
  if (new TextEncoder().encode(json).byteLength > 240_000) throw invalid();
  return json;
}

/** Exact IEEE-754 storage avoids large decimal JSON arrays without changing the fitted frame. */
function encodeProjection(projection: VisualizationProjection): string {
  const values = [...projection.mean, ...projection.axes[0], ...projection.axes[1]];
  const bytes = Buffer.allocUnsafe(values.length * 8);
  values.forEach((value, index) => bytes.writeDoubleLE(value, index * 8));
  const { mean: _mean, axes: _axes, ...header } = projection;
  // Byte planes compress the repeated exponent/sign bytes independently of
  // high-entropy mantissas. This is reversible and preserves every double.
  const planes = Buffer.allocUnsafe(bytes.length);
  for (let byte = 0; byte < 8; byte++) for (let index = 0; index < values.length; index++) {
    planes[byte * values.length + index] = bytes[index * 8 + byte]!;
  }
  return encode({ ...header, encoding: 'deflate-f64le-planes-v1',
    data: deflateRawSync(planes).toString('base64') });
}

function decodeProjection(json: string): VisualizationProjection {
  const encoded = JSON.parse(json);
  // Accept the earlier plain representation while writing only the compact one.
  if (encoded?.encoding === undefined) return encoded;
  if (!['deflate-f64le-v1', 'deflate-f64le-planes-v1'].includes(encoded.encoding) || !Number.isSafeInteger(encoded.dimensions)
    || encoded.dimensions < 0 || encoded.dimensions > 8_192 || typeof encoded.data !== 'string'
    || encoded.data.length > 240_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded.data)) throw invalid();
  const expectedBytes = encoded.dimensions * 3 * 8;
  const inflated = inflateRawSync(Buffer.from(encoded.data, 'base64'), { maxOutputLength: Math.max(1, expectedBytes) });
  if (inflated.length !== expectedBytes) throw invalid();
  const bytes = encoded.encoding === 'deflate-f64le-v1' ? inflated : Buffer.allocUnsafe(inflated.length);
  if (encoded.encoding === 'deflate-f64le-planes-v1') {
    const count = encoded.dimensions * 3;
    for (let byte = 0; byte < 8; byte++) for (let index = 0; index < count; index++) bytes[index * 8 + byte] = inflated[byte * count + index]!;
  }
  const values = Array.from({ length: encoded.dimensions * 3 }, (_, index) => bytes.readDoubleLE(index * 8));
  const { encoding: _encoding, data: _data, ...header } = encoded;
  return { ...header, mean: values.slice(0, encoded.dimensions),
    axes: [values.slice(encoded.dimensions, encoded.dimensions * 2), values.slice(encoded.dimensions * 2)] };
}
function invalid(): VectorError { return new VectorError('VECTOR_CONFIG_INVALID', 'Stored visualization map is invalid or exceeds capacity.'); }
function conflict(): VectorError { return new VectorError('VECTOR_OPERATION_FAILED', 'Visualization map changed before this update.', { conflict: true }); }

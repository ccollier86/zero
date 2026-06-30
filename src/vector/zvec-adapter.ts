/**
 * zvec-adapter.ts
 *
 * Adapter between Zero's stable vector-store contract and the current
 * `@zvec/zvec` Node API. This file owns zvec schema/document/query mapping
 * only; it does not generate embeddings, register routes, or expose zvec
 * objects to app code.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { VECTOR_ZVEC_ID_FIELD } from './vector-constants';
import { VectorError } from './vector-error';
import { buildZvecFilter } from './vector-filter';
import { emitVectorIndexReady } from './vector-observability';
import type {
  ResolvedVectorIndexConfig,
  ResolvedVectorMetadataFieldConfig,
  StoredVectorRecord,
  VectorDeleteResult,
  VectorFetchOptions,
  VectorFilter,
  VectorIndexStore,
  VectorMetadata,
  VectorQueryOptions,
  VectorRecord,
  VectorStats,
  VectorValue,
  VectorWriteResult,
} from './vector-types';
import type {
  ZVecCollection,
  ZVecCollectionSchema,
  ZVecDoc,
  ZVecDocInput,
  ZVecFieldSchema,
  ZVecFlatIndexParams,
  ZVecHnswQueryParams,
  ZVecHnswIndexParams,
  ZVecIVFIndexParams,
  ZVecIVFQueryParams,
  ZVecDiskAnnIndexParams,
  ZVecDiskAnnQueryParams,
  ZVecStatus,
  ZVecVectorSchema,
} from '@zvec/zvec';

type ZvecModule = typeof import('@zvec/zvec');
type ZvecModuleLoader = () => Promise<ZvecModule>;
type ZvecVectorIndexParams =
  | ZVecFlatIndexParams
  | ZVecHnswIndexParams
  | ZVecIVFIndexParams
  | ZVecDiskAnnIndexParams;
type ZvecVectorQueryParams =
  | ZVecHnswQueryParams
  | ZVecIVFQueryParams
  | ZVecDiskAnnQueryParams;

const defaultZvecLoader: ZvecModuleLoader = () => import('@zvec/zvec');

/** Options for constructing a zvec-backed index store. */
export interface ZvecAdapterOptions {
  config: ResolvedVectorIndexConfig;
  loader?: ZvecModuleLoader;
}

/** zvec-backed implementation of one Zero vector index. */
export class ZvecAdapter implements VectorIndexStore {
  readonly config: ResolvedVectorIndexConfig;

  private readonly loader: ZvecModuleLoader;
  private module: ZvecModule | null = null;
  private collection: ZVecCollection | null = null;
  private initialization: Promise<ZVecCollection> | null = null;

  /** Create a lazy zvec adapter for one resolved index config. */
  constructor(options: ZvecAdapterOptions) {
    this.config = options.config;
    this.loader = options.loader ?? defaultZvecLoader;
  }

  /** Insert or update records in zvec after validating vector dimensions. */
  async upsert(records: readonly VectorRecord[]): Promise<VectorWriteResult> {
    if (!records.length) return { ok: true, count: 0, errors: [] };
    const collection = await this.getCollection();
    const docs = records.map((record) => this.toZvecDoc(record));
    const statuses: ZVecStatus[] = [];

    for (let i = 0; i < docs.length; i += this.config.insertBatchSize) {
      const batch = docs.slice(i, i + this.config.insertBatchSize);
      statuses.push(...statusArray(collection.upsertSync(batch)));
    }

    return writeResult(statuses, records.map((record) => record.id));
  }

  /** Query the zvec collection using vector similarity, scalar filters, or both. */
  async query(options: VectorQueryOptions): Promise<StoredVectorRecord[]> {
    const collection = await this.getCollection();
    if (!options.vector && !options.filter) {
      throw new VectorError('VECTOR_FILTER_INVALID', 'Vector query requires a vector, a filter, or both.', {
        index: this.config.name,
      });
    }

    const zvecFilter = buildZvecFilter(options.filter, this.filterableFields(), this.zvecFieldAliases());
    const queryParams: Record<string, unknown> = {
      ...(options.vector
        ? {
            fieldName: this.config.vectorField,
            vector: this.validateVector(options.vector),
          }
        : {}),
      topk: options.topK ?? 10,
      includeVector: options.includeVector ?? false,
    };
    const outputFields = this.outputFields(options.outputFields);
    const params = options.vector ? this.queryParams(options.query) : undefined;
    if (zvecFilter) queryParams.filter = zvecFilter;
    if (outputFields) queryParams.outputFields = outputFields;
    if (params) queryParams.params = params;

    const results = await collection.query(queryParams as Parameters<ZVecCollection['query']>[0]);

    return results
      .map((doc) => this.fromZvecDoc(doc, options.includeVector ?? false))
      .filter((doc) => options.minScore === undefined || (doc.score ?? Number.NEGATIVE_INFINITY) >= options.minScore);
  }

  /** Fetch vector records by id without requiring a similarity query. */
  async fetch(ids: readonly string[], options: VectorFetchOptions = {}): Promise<StoredVectorRecord[]> {
    if (!ids.length) return [];
    const collection = await this.getCollection();
    const fetchParams: Record<string, unknown> = {
      ids: [...ids],
      includeVector: options.includeVector ?? false,
    };
    const outputFields = this.outputFields(options.outputFields);
    if (outputFields) fetchParams.outputFields = outputFields;

    const docs = collection.fetchSync(fetchParams as Parameters<ZVecCollection['fetchSync']>[0]);

    return ids
      .map((id) => docs[id])
      .filter((doc): doc is ZVecDoc => Boolean(doc))
      .map((doc) => this.fromZvecDoc(doc, options.includeVector ?? false));
  }

  /** Delete vector records by id. */
  async delete(ids: readonly string[]): Promise<VectorDeleteResult> {
    if (!ids.length) return { ok: true, count: 0, errors: [] };
    const collection = await this.getCollection();
    const statuses = statusArray(collection.deleteSync([...ids]));
    return deleteResult(statuses, ids);
  }

  /** Delete records matching a structured scalar filter. */
  async deleteWhere(filter: VectorFilter): Promise<VectorDeleteResult> {
    const collection = await this.getCollection();
    const expression = buildZvecFilter(filter, this.filterableFields(), this.zvecFieldAliases());
    if (!expression) {
      throw new VectorError('VECTOR_FILTER_INVALID', 'Vector deleteWhere requires a non-empty filter.', {
        index: this.config.name,
      });
    }

    const before = collection.stats.docCount;
    const status = await collection.deleteByFilter(expression);
    const after = collection.stats.docCount;
    const errors = status.ok ? [] : [{ code: status.code, message: status.message }];

    return {
      ok: status.ok,
      count: status.ok ? Math.max(0, before - after) : 0,
      errors,
    };
  }

  /** Return current zvec index statistics. */
  async stats(): Promise<VectorStats> {
    const collection = await this.getCollection();
    return {
      index: this.config.name,
      path: this.config.path,
      dimensions: this.config.dimensions,
      documentCount: collection.stats.docCount,
      indexCompleteness: collection.stats.indexCompleteness,
    };
  }

  /** Ask zvec to optimize this collection. */
  async optimize(): Promise<void> {
    const collection = await this.getCollection();
    await collection.optimize();
  }

  /** Close the zvec collection if it has been opened. */
  async dispose(): Promise<void> {
    if (!this.collection) return;
    this.collection.closeSync();
    this.collection = null;
    this.initialization = null;
  }

  private async getCollection(): Promise<ZVecCollection> {
    if (this.collection) return this.collection;
    if (!this.initialization) this.initialization = this.initialize();
    return this.initialization;
  }

  private async initialize(): Promise<ZVecCollection> {
    try {
      await mkdir(dirname(this.config.path), { recursive: true });
      this.module = await this.loader();
      const schema = this.createSchema(this.module);
      const options = {
        readOnly: this.config.readOnly,
        enableMMAP: this.config.enableMMAP,
      };
      const mode = await resolveCollectionOpenMode(this.config.path);
      this.collection = mode === 'open'
        ? this.module.ZVecOpen(this.config.path, options)
        : this.module.ZVecCreateAndOpen(this.config.path, schema, options);
      emitVectorIndexReady({
        index: this.config.name,
        documents: this.collection.stats.docCount,
      });
      return this.collection;
    } catch (error) {
      emitPlatformCode(OBS_CODES.VECTOR_INDEX_FAILED, {
        error,
        metadata: { index: this.config.name, path: this.config.path },
      });
      throw new VectorError('VECTOR_OPERATION_FAILED', `Failed to initialize vector index "${this.config.name}".`, {
        index: this.config.name,
      });
    }
  }

  private createSchema(zvec: ZvecModule): ZVecCollectionSchema {
    const fields: ZVecFieldSchema[] = [
      {
        name: VECTOR_ZVEC_ID_FIELD,
        dataType: zvec.ZVecDataType.STRING,
        nullable: false,
        indexParams: {
          indexType: zvec.ZVecIndexType.INVERT,
          enableRangeOptimization: false,
        },
      },
      {
        name: this.config.textField,
        dataType: zvec.ZVecDataType.STRING,
        nullable: true,
      },
      {
        name: this.config.metadataField,
        dataType: zvec.ZVecDataType.STRING,
        nullable: true,
      },
      ...Object.values(this.config.metadata).map((field) => this.metadataFieldSchema(zvec, field)),
    ];

    const vector: ZVecVectorSchema = {
      name: this.config.vectorField,
      dataType: zvec.ZVecDataType.VECTOR_FP32,
      dimension: this.config.dimensions,
      indexParams: this.vectorIndexParams(zvec),
    };

    return new zvec.ZVecCollectionSchema({
      name: this.config.name,
      vectors: vector,
      fields,
    });
  }

  private metadataFieldSchema(zvec: ZvecModule, field: ResolvedVectorMetadataFieldConfig): ZVecFieldSchema {
    return {
      name: field.name,
      dataType: field.type === 'string'
        ? zvec.ZVecDataType.STRING
        : field.type === 'number'
          ? zvec.ZVecDataType.DOUBLE
          : zvec.ZVecDataType.BOOL,
      nullable: field.nullable,
      indexParams: field.indexed
        ? {
            indexType: zvec.ZVecIndexType.INVERT,
            enableRangeOptimization: field.range,
          }
        : undefined,
    };
  }

  private vectorIndexParams(zvec: ZvecModule): ZvecVectorIndexParams {
    const metricType = this.metricType(zvec);
    switch (this.config.indexType) {
      case 'flat':
        return { indexType: zvec.ZVecIndexType.FLAT, metricType };
      case 'ivf':
        return { indexType: zvec.ZVecIndexType.IVF, metricType };
      case 'diskann':
        return { indexType: zvec.ZVecIndexType.DISKANN, metricType };
      case 'hnsw':
      default:
        return { indexType: zvec.ZVecIndexType.HNSW, metricType };
    }
  }

  private queryParams(override: VectorQueryOptions['query']): ZvecVectorQueryParams | undefined {
    const zvec = this.module;
    if (!zvec || this.config.indexType === 'flat') return undefined;
    const query = { ...this.config.query, ...(override ?? {}) };

    switch (this.config.indexType) {
      case 'ivf':
        return {
          indexType: zvec.ZVecIndexType.IVF,
          nprobe: query.nprobe,
          isLinear: query.linear,
          radius: query.radius,
        };
      case 'diskann':
        return {
          indexType: zvec.ZVecIndexType.DISKANN,
          listSize: query.listSize,
          isLinear: query.linear,
          radius: query.radius,
        };
      case 'hnsw':
      default:
        return {
          indexType: zvec.ZVecIndexType.HNSW,
          ef: query.ef,
          isLinear: query.linear,
          radius: query.radius,
        };
    }
  }

  private metricType(zvec: ZvecModule): ZvecModule['ZVecMetricType'][keyof ZvecModule['ZVecMetricType']] {
    if (this.config.metric === 'l2') return zvec.ZVecMetricType.L2;
    if (this.config.metric === 'ip') return zvec.ZVecMetricType.IP;
    return zvec.ZVecMetricType.COSINE;
  }

  private toZvecDoc(record: VectorRecord): ZVecDocInput {
    const metadata = normalizeMetadata(record.metadata);
    const id = requiredId(record.id);
    return {
      id,
      vectors: {
        [this.config.vectorField]: this.validateVector(record.vector),
      },
      fields: this.toZvecFields(id, metadata, record.text),
    };
  }

  private toZvecFields(id: string, metadata: VectorMetadata, text: string | undefined): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      [VECTOR_ZVEC_ID_FIELD]: id,
      [this.config.metadataField]: JSON.stringify(metadata),
    };
    if (text !== undefined) fields[this.config.textField] = text;

    for (const field of Object.values(this.config.metadata)) {
      if (metadata[field.name] != null) {
        fields[field.name] = typedMetadataValue(field, metadata[field.name]);
      }
    }

    return fields;
  }

  private fromZvecDoc(doc: ZVecDoc, includeVector: boolean): StoredVectorRecord {
    const fields = doc.fields ?? {};
    const metadata = parseMetadata(fields[this.config.metadataField]);

    for (const field of Object.values(this.config.metadata)) {
      const value = fields[field.name];
      if (value !== undefined && value !== null) metadata[field.name] = value;
    }

    const text = fields[this.config.textField];
    const vector = includeVector ? vectorToArray(doc.vectors?.[this.config.vectorField]) : undefined;

    return {
      id: doc.id,
      ...(vector ? { vector } : {}),
      ...(typeof text === 'string' ? { text } : {}),
      metadata,
      ...(typeof doc.score === 'number' ? { score: doc.score } : {}),
    };
  }

  private validateVector(vector: VectorValue): VectorValue {
    const length = vector.length;
    if (length !== this.config.dimensions) {
      throw new VectorError(
        'VECTOR_DIMENSION_MISMATCH',
        `Vector for "${this.config.name}" must have ${this.config.dimensions} dimensions.`,
        { index: this.config.name, expected: this.config.dimensions, actual: length }
      );
    }

    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new VectorError('VECTOR_DIMENSION_MISMATCH', 'Vector values must be finite numbers.', {
          index: this.config.name,
        });
      }
    }

    return vector;
  }

  private filterableFields(): ReadonlySet<string> {
    return new Set([
      'id',
      this.config.textField,
      ...Object.keys(this.config.metadata),
    ]);
  }

  private zvecFieldAliases(): Readonly<Record<string, string>> {
    return {
      id: VECTOR_ZVEC_ID_FIELD,
    };
  }

  private outputFields(fields: readonly string[] | undefined): string[] | undefined {
    if (!fields) return undefined;
    const output = new Set([this.config.textField, this.config.metadataField]);
    for (const field of fields) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
        throw new VectorError('VECTOR_FILTER_INVALID', `Invalid vector output field "${field}".`, { field });
      }
      output.add(field);
    }
    return [...output];
  }
}

function requiredId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new VectorError('VECTOR_METADATA_INVALID', 'Vector record id cannot be empty.');
  return trimmed;
}

function normalizeMetadata(metadata: VectorMetadata | undefined): VectorMetadata {
  if (metadata === undefined) return {};
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new VectorError('VECTOR_METADATA_INVALID', 'Vector metadata must be an object.');
  }
  return { ...metadata };
}

function typedMetadataValue(field: ResolvedVectorMetadataFieldConfig, value: unknown): string | number | boolean {
  if (field.type === 'string' && typeof value === 'string') return value;
  if (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
  if (field.type === 'boolean' && typeof value === 'boolean') return value;

  throw new VectorError('VECTOR_METADATA_INVALID', `Vector metadata "${field.name}" must be ${field.type}.`, {
    field: field.name,
    type: field.type,
  });
}

function parseMetadata(value: unknown): VectorMetadata {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function vectorToArray(vector: unknown): number[] | undefined {
  if (!vector) return undefined;
  if (Array.isArray(vector)) return vector;
  if (ArrayBuffer.isView(vector)) return Array.from(vector as Float32Array);
  return undefined;
}

function statusArray(status: ZVecStatus | ZVecStatus[]): ZVecStatus[] {
  return Array.isArray(status) ? status : [status];
}

async function resolveCollectionOpenMode(collectionPath: string): Promise<'create' | 'open'> {
  if (!existsSync(collectionPath)) return 'create';

  const stats = await stat(collectionPath);
  if (stats.isDirectory()) {
    const entries = await readdir(collectionPath);
    if (entries.length === 0) {
      await rm(collectionPath, { recursive: true, force: true });
      return 'create';
    }
  }

  return 'open';
}

function writeResult(statuses: readonly ZVecStatus[], ids: readonly string[]): VectorWriteResult {
  const errors = statuses
    .map((status, index) => ({ status, id: ids[index] }))
    .filter(({ status }) => !status.ok)
    .map(({ status, id }) => ({ id, code: status.code, message: status.message }));

  return {
    ok: errors.length === 0,
    count: statuses.length - errors.length,
    errors,
  };
}

function deleteResult(statuses: readonly ZVecStatus[], ids: readonly string[]): VectorDeleteResult {
  const errors = statuses
    .map((status, index) => ({ status, id: ids[index] }))
    .filter(({ status }) => !status.ok)
    .map(({ status, id }) => ({ id, code: status.code, message: status.message }));

  return {
    ok: errors.length === 0,
    count: statuses.length - errors.length,
    errors,
  };
}

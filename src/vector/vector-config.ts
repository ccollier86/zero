/**
 * vector-config.ts
 *
 * Resolves Zero vector-store configuration from createApp input and process
 * environment. This file owns normalization and validation only; it does not
 * open zvec collections or emit runtime events.
 */

import path from 'node:path';

import { VectorError } from './vector-error';
import { VECTOR_ZVEC_ID_FIELD } from './vector-constants';
import type {
  ResolvedVectorConfig,
  ResolvedVectorIndexConfig,
  ResolvedVectorMetadataFieldConfig,
  VectorConfig,
  VectorIndexConfig,
  VectorMetadataFieldInput,
} from './vector-types';

/** Minimal environment map used to keep config resolution testable. */
export type VectorEnv = Record<string, string | undefined>;

const DEFAULT_DATA_DIR = './data/vector';
const DEFAULT_INDEX = 'default';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_VECTOR_FIELD = 'embedding';
const DEFAULT_TEXT_FIELD = 'text';
const DEFAULT_METADATA_FIELD = '_metadata';
const DEFAULT_BATCH_SIZE = 250;

const DEFAULT_METADATA_FIELDS: Record<string, VectorMetadataFieldInput> = {
  namespace: 'string',
  bucket: 'string',
  tenantId: 'string',
  ownerId: 'string',
  userId: 'string',
  source: 'string',
  type: 'string',
  version: 'string',
  createdAt: 'string',
  updatedAt: 'string',
};

/**
 * Resolve vector config accepted by `createApp()`.
 *
 * Returns false when vectors are omitted or disabled. `vector: true` creates a
 * default dense index using env or platform defaults.
 */
export function resolveVectorConfig(
  input: boolean | VectorConfig | undefined,
  env: VectorEnv = Bun.env
): ResolvedVectorConfig | false {
  if (input === false || input === undefined) return false;

  const config: VectorConfig = input === true ? {} : input;
  const dataDir = normalizePath(env.ZERO_VECTOR_DATA_DIR ?? config.dataDir ?? DEFAULT_DATA_DIR);
  const defaultIndex = normalizeIndexName(config.defaultIndex ?? DEFAULT_INDEX);
  const defaultDimensions = normalizeDimension(
    config.defaultDimensions ?? parseOptionalInteger(env.ZERO_VECTOR_DEFAULT_DIMENSIONS) ?? DEFAULT_DIMENSIONS,
    'defaultDimensions'
  );
  const indexes = resolveIndexes(config.indexes, {
    dataDir,
    defaultIndex,
    defaultDimensions,
  });

  return {
    enabled: true,
    dataDir,
    defaultIndex,
    indexes,
  };
}

function resolveIndexes(
  indexes: Record<string, number | VectorIndexConfig> | undefined,
  defaults: { dataDir: string; defaultIndex: string; defaultDimensions: number }
): Record<string, ResolvedVectorIndexConfig> {
  const input = indexes && Object.keys(indexes).length > 0
    ? indexes
    : { [defaults.defaultIndex]: { dimensions: defaults.defaultDimensions } };
  const resolved: Record<string, ResolvedVectorIndexConfig> = {};

  for (const [rawName, rawConfig] of Object.entries(input)) {
    const name = normalizeIndexName(rawName);
    const config: VectorIndexConfig = typeof rawConfig === 'number'
      ? { dimensions: rawConfig }
      : rawConfig;
    const dimensions = normalizeDimension(config.dimensions ?? defaults.defaultDimensions, `${name}.dimensions`);
    const vectorField = normalizeFieldName(config.vectorField ?? DEFAULT_VECTOR_FIELD, `${name}.vectorField`);
    const textField = normalizeFieldName(config.textField ?? DEFAULT_TEXT_FIELD, `${name}.textField`);
    const metadataField = normalizeFieldName(config.metadataField ?? DEFAULT_METADATA_FIELD, `${name}.metadataField`);
    const metadata = resolveMetadataFields({
      ...DEFAULT_METADATA_FIELDS,
      ...(config.metadata ?? {}),
    });
    ensureNoFieldCollisions(name, [vectorField, textField, metadataField, VECTOR_ZVEC_ID_FIELD], metadata);

    resolved[name] = {
      name,
      dimensions,
      path: normalizePath(config.path ?? path.join(defaults.dataDir, sanitizePathSegment(name))),
      vectorField,
      textField,
      metadataField,
      metadata,
      metric: normalizeChoice(config.metric ?? 'cosine', ['cosine', 'ip', 'l2'], `${name}.metric`),
      indexType: normalizeChoice(config.indexType ?? 'hnsw', ['hnsw', 'flat', 'ivf', 'diskann'], `${name}.indexType`),
      readOnly: config.readOnly ?? false,
      enableMMAP: config.enableMMAP ?? true,
      insertBatchSize: normalizePositiveInteger(config.insertBatchSize ?? DEFAULT_BATCH_SIZE, `${name}.insertBatchSize`),
      query: config.query ?? {},
    };
  }

  if (!resolved[defaults.defaultIndex]) {
    throw new VectorError(
      'VECTOR_CONFIG_INVALID',
      `Vector defaultIndex "${defaults.defaultIndex}" must exist in vector.indexes.`,
      { defaultIndex: defaults.defaultIndex }
    );
  }

  return resolved;
}

function ensureNoFieldCollisions(
  index: string,
  reservedFields: readonly string[],
  metadata: Record<string, ResolvedVectorMetadataFieldConfig>
): void {
  const reserved = new Set<string>();
  for (const field of reservedFields) {
    if (reserved.has(field)) {
      throw new VectorError(
        'VECTOR_CONFIG_INVALID',
        `Vector field "${field}" is configured more than once on "${index}".`,
        { index, field }
      );
    }
    reserved.add(field);
  }

  for (const field of Object.keys(metadata)) {
    if (reserved.has(field)) {
      throw new VectorError(
        'VECTOR_CONFIG_INVALID',
        `Vector metadata field "${field}" collides with a reserved field on "${index}".`,
        { index, field }
      );
    }
  }
}

function resolveMetadataFields(
  fields: Record<string, VectorMetadataFieldInput>
): Record<string, ResolvedVectorMetadataFieldConfig> {
  const resolved: Record<string, ResolvedVectorMetadataFieldConfig> = {};

  for (const [rawName, input] of Object.entries(fields)) {
    const name = normalizeFieldName(rawName, `metadata.${rawName}`);
    const config = typeof input === 'string' ? { type: input } : input;
    if (!['string', 'number', 'boolean'].includes(config.type)) {
      throw new VectorError('VECTOR_CONFIG_INVALID', `Unsupported vector metadata type for "${name}".`, {
        field: name,
        type: config.type,
      });
    }

    resolved[name] = {
      name,
      type: config.type,
      indexed: config.indexed ?? true,
      nullable: config.nullable ?? true,
      range: config.range ?? true,
    };
  }

  return resolved;
}

function normalizeIndexName(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed)) {
    throw new VectorError('VECTOR_CONFIG_INVALID', `Invalid vector index name "${value}".`, { name: value });
  }
  return trimmed;
}

function normalizeFieldName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new VectorError('VECTOR_CONFIG_INVALID', `Invalid vector field name for ${label}.`, { field: value });
  }
  return trimmed;
}

function normalizeDimension(value: number, label: string): number {
  return normalizePositiveInteger(value, label);
}

function normalizePositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new VectorError('VECTOR_CONFIG_INVALID', `Vector ${label} must be a positive integer.`, { value });
  }
  return value;
}

function normalizeChoice<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new VectorError('VECTOR_CONFIG_INVALID', `Vector ${label} is invalid.`, {
      field: label,
    });
  }
  return value as T;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new VectorError('VECTOR_CONFIG_INVALID', 'Vector storage path cannot be empty.');
  }
  return trimmed;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_');
}

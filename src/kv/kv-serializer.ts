/**
 * kv-serializer.ts
 *
 * Serializes and validates KV journal/checkpoint records. This file owns the
 * persistence wire format only; it does not perform filesystem IO or mutate
 * the memory engine.
 */

import { KvError } from './kv-errors';
import { KV_CHECKPOINT_PRUNE_KEY, type KvMutation } from './kv-mutation';
import type { ZeroKvEntry, ZeroKvKind } from './kv-types';
import { snapshotKvValue } from './kv-value';

/** Persistence version written by the current journal and checkpoint stores. */
export const KV_PERSISTENCE_FORMAT_VERSION = 2;

/** Persistence version written by Zero 1.3 and earlier. */
export const KV_LEGACY_PERSISTENCE_FORMAT_VERSION = 1;

/** Persistence versions understood by the current recovery path. */
export type KvPersistenceFormatVersion =
  | typeof KV_LEGACY_PERSISTENCE_FORMAT_VERSION
  | typeof KV_PERSISTENCE_FORMAT_VERSION;

const ZERO_KV_KINDS = new Set<ZeroKvKind>([
  'value',
  'counter',
  'hash',
  'set',
  'list',
  'lease',
  'rate-limit',
]);

/** One append-only journal record. */
export interface KvJournalRecord {
  version: KvPersistenceFormatVersion;
  sequence: number;
  timestamp: number;
  mutation: KvMutation;
  /** Recovery-only diagnostic; never serialized into the WAL. */
  legacyUndefinedValueMigrated?: true;
}

/** Checkpoint payload persisted by the checkpoint store. */
export interface KvCheckpointPayload {
  version: KvPersistenceFormatVersion;
  sequence: number;
  timestamp: number;
  entries: ZeroKvEntry[];
  /** Recovery-only diagnostic; never serialized into the checkpoint. */
  legacyUndefinedEntriesDropped?: number;
}

/** Serialize a journal record as one JSONL line. */
export function serializeKvJournalRecord(record: KvJournalRecord): string {
  return JSON.stringify({
    version: record.version,
    sequence: record.sequence,
    timestamp: record.timestamp,
    mutation: record.mutation,
  }) + '\n';
}

/** Parse and validate one journal JSONL line. */
export function parseKvJournalRecord(line: string): KvJournalRecord {
  return normalizeJournalRecord(parseJson(line, 'journal'));
}

/** Serialize a checkpoint payload. */
export function serializeKvCheckpoint(payload: KvCheckpointPayload): string {
  return JSON.stringify({
    version: payload.version,
    sequence: payload.sequence,
    timestamp: payload.timestamp,
    entries: payload.entries,
  }, null, 2);
}

/** Parse and validate a checkpoint payload. */
export function parseKvCheckpoint(text: string): KvCheckpointPayload {
  return normalizeCheckpointPayload(parseJson(text, 'checkpoint'), true);
}

/** Validate and snapshot an in-memory checkpoint before JSON serialization. */
export function validateKvCheckpointPayload(value: unknown): KvCheckpointPayload {
  return normalizeCheckpointPayload(value, false);
}

function normalizeCheckpointPayload(
  value: unknown,
  allowLegacy: boolean
): KvCheckpointPayload {
  if (!isRecord(value)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint version is invalid.');
  }
  const version = normalizePersistenceVersion(value.version, 'checkpoint', allowLegacy);
  if (!isNonNegativeInteger(value.sequence) || !isFiniteNumber(value.timestamp)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint metadata is invalid.');
  }
  if (!Array.isArray(value.entries)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entries must be an array.');
  }

  const sequence = value.sequence;
  let legacyUndefinedEntriesDropped = 0;
  const entries: ZeroKvEntry[] = [];
  for (const rawEntry of value.entries) {
    const entry = normalizeEntry(
      rawEntry,
      version === KV_LEGACY_PERSISTENCE_FORMAT_VERSION
    );
    if (entry) entries.push(entry);
    else legacyUndefinedEntriesDropped += 1;
  }
  if (entries.some((entry) => entry.version > sequence)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entry version exceeds its sequence.');
  }

  const payload: KvCheckpointPayload = {
    version,
    sequence,
    timestamp: value.timestamp,
    entries,
  };
  if (legacyUndefinedEntriesDropped > 0) {
    payload.legacyUndefinedEntriesDropped = legacyUndefinedEntriesDropped;
  }
  return payload;
}

function normalizeJournalRecord(value: unknown): KvJournalRecord {
  if (!isRecord(value)) {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV journal record version is invalid.');
  }
  const version = normalizePersistenceVersion(value.version, 'journal', true);
  if (!isPositiveInteger(value.sequence) || !isFiniteNumber(value.timestamp)) {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV journal record metadata is invalid.');
  }

  const normalized = normalizeMutation(value.mutation, version);
  const record: KvJournalRecord = {
    version,
    sequence: value.sequence,
    timestamp: value.timestamp,
    mutation: normalized.mutation,
  };
  if (normalized.legacyUndefinedValueMigrated) {
    record.legacyUndefinedValueMigrated = true;
  }
  return record;
}

function normalizeMutation(
  value: unknown,
  version: KvPersistenceFormatVersion
): { mutation: KvMutation; legacyUndefinedValueMigrated?: true } {
  if (!isRecord(value) || typeof value.op !== 'string') {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation shape is invalid.');
  }
  const key = normalizeKey(value.key, 'journal');

  switch (value.op) {
    case 'set': {
      const kind = normalizeKind(value.kind, true, 'journal');
      const expiresAt = normalizeExpiresAt(value.expiresAt, true, 'journal');
      const tombstone = normalizeTombstone(value.tombstone);
      const evaluatedAt = normalizeEvaluatedAt(value.evaluatedAt);
      const pruneAt = normalizePruneAt(value.pruneAt);
      if (
        version === KV_LEGACY_PERSISTENCE_FORMAT_VERSION
        && !Object.prototype.hasOwnProperty.call(value, 'value')
      ) {
        // Zero 1.3 accepted a top-level undefined. JSON omitted that field, so
        // the only lossless upgrade behavior available to the new JSON-value
        // contract is to migrate the unreadable value to an absent key.
        return {
          mutation: { op: 'delete', key, evaluatedAt, pruneAt },
          legacyUndefinedValueMigrated: true,
        };
      }
      return {
        mutation: {
          op: 'set',
          key,
          value: normalizeValue(value.value, 'journal'),
          kind,
          expiresAt,
          tombstone,
          evaluatedAt,
          pruneAt,
        },
      };
    }
    case 'delete': {
      const maintenance = normalizeMaintenance(value.maintenance, version);
      const evaluatedAt = normalizeEvaluatedAt(value.evaluatedAt);
      const pruneAt = normalizePruneAt(value.pruneAt);
      if (
        maintenance === 'prune'
        && (
          key !== KV_CHECKPOINT_PRUNE_KEY
          || pruneAt === undefined
          || evaluatedAt !== pruneAt
        )
      ) {
        throw new KvError('KV_JOURNAL_CORRUPT', 'KV checkpoint prune mutation is invalid.');
      }
      return {
        mutation: {
          op: 'delete',
          key,
          maintenance,
          evaluatedAt,
          pruneAt,
        },
      };
    }
    case 'expire':
      return {
        mutation: {
          op: 'expire',
          key,
          expiresAt: normalizeRequiredExpiresAt(value.expiresAt, 'journal'),
          tombstone: normalizeTombstone(value.tombstone),
          evaluatedAt: normalizeEvaluatedAt(value.evaluatedAt),
          pruneAt: normalizePruneAt(value.pruneAt),
        },
      };
    case 'increment':
      if (typeof value.delta !== 'number' || !Number.isFinite(value.delta)) {
        throw new KvError('KV_JOURNAL_CORRUPT', 'KV increment mutation delta is invalid.');
      }
      if (value.result !== undefined && !isFiniteNumber(value.result)) {
        throw new KvError('KV_JOURNAL_CORRUPT', 'KV increment mutation result is invalid.');
      }
      return {
        mutation: {
          op: 'increment',
          key,
          delta: value.delta,
          result: value.result,
          expiresAt: normalizeExpiresAt(value.expiresAt, true, 'journal'),
          tombstone: normalizeTombstone(value.tombstone),
          evaluatedAt: normalizeEvaluatedAt(value.evaluatedAt),
          pruneAt: normalizePruneAt(value.pruneAt),
        },
      };
    default:
      throw new KvError('KV_JOURNAL_CORRUPT', `Unsupported KV mutation op "${value.op}".`);
  }
}

function normalizeEntry(value: unknown, allowLegacyMissingValue: boolean): ZeroKvEntry | null {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entry shape is invalid.');
  }
  if (!isNonNegativeInteger(value.version)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entry version is invalid.');
  }

  const entry = {
    key: normalizeKey(value.key, 'checkpoint'),
    kind: normalizeKind(value.kind, false, 'checkpoint'),
    expiresAt: normalizeRequiredExpiresAt(value.expiresAt, 'checkpoint'),
    version: value.version,
    createdAt: normalizeNumber(value.createdAt, 'createdAt'),
    updatedAt: normalizeNumber(value.updatedAt, 'updatedAt'),
    lastAccessedAt: normalizeNumber(value.lastAccessedAt, 'lastAccessedAt'),
    sizeBytes: normalizeNumber(value.sizeBytes, 'sizeBytes'),
  };
  if (
    allowLegacyMissingValue
    && !Object.prototype.hasOwnProperty.call(value, 'value')
  ) {
    return null;
  }
  return { ...entry, value: normalizeValue(value.value, 'checkpoint') };
}

function normalizePersistenceVersion(
  value: unknown,
  source: 'journal' | 'checkpoint',
  allowLegacy: boolean
): KvPersistenceFormatVersion {
  if (
    value === KV_PERSISTENCE_FORMAT_VERSION
    || (allowLegacy && value === KV_LEGACY_PERSISTENCE_FORMAT_VERSION)
  ) {
    return value;
  }
  throw new KvError(
    source === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
    `KV ${source} record version is invalid.`
  );
}

function normalizeKind(
  value: unknown,
  allowUndefined: true,
  source: 'journal' | 'checkpoint'
): ZeroKvKind | undefined;
function normalizeKind(
  value: unknown,
  allowUndefined: false,
  source: 'journal' | 'checkpoint'
): ZeroKvKind;
function normalizeKind(
  value: unknown,
  allowUndefined: boolean,
  source: 'journal' | 'checkpoint'
): ZeroKvKind | undefined {
  if (value === undefined && allowUndefined) return undefined;
  if (typeof value !== 'string' || !ZERO_KV_KINDS.has(value as ZeroKvKind)) {
    throw new KvError(
      source === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
      `KV ${source} kind is invalid.`,
      { value }
    );
  }
  return value as ZeroKvKind;
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new KvError(
      label === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
      `KV ${label} JSON is invalid.`,
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

function normalizeExpiresAt(
  value: unknown,
  allowUndefined: boolean,
  source: 'journal' | 'checkpoint'
): number | null | undefined {
  if (value === undefined && allowUndefined) return undefined;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new KvError(
      source === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
      `KV ${source} expiresAt must be a finite number, null, or undefined.`
    );
  }
  return value;
}

function normalizeRequiredExpiresAt(
  value: unknown,
  source: 'journal' | 'checkpoint'
): number | null {
  if (value === undefined) {
    throw new KvError(
      source === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
      `KV ${source} expiresAt is required.`
    );
  }
  const expiresAt = normalizeExpiresAt(value, false, source);
  return expiresAt ?? null;
}

function normalizeTombstone(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return value;
  throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation tombstone marker is invalid.');
}

function normalizeEvaluatedAt(value: unknown): number | undefined {
  if (value === undefined || isFiniteNumber(value)) return value;
  throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation evaluation timestamp is invalid.');
}

function normalizePruneAt(value: unknown): number | undefined {
  if (value === undefined || isFiniteNumber(value)) return value;
  throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation prune timestamp is invalid.');
}

function normalizeMaintenance(
  value: unknown,
  version: KvPersistenceFormatVersion
): 'prune' | undefined {
  if (value === undefined) return undefined;
  if (version === KV_PERSISTENCE_FORMAT_VERSION && value === 'prune') return value;
  throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation maintenance marker is invalid.');
}

function normalizeNumber(value: unknown, field: string): number {
  if (!isFiniteNumber(value)) {
    throw new KvError('KV_CHECKPOINT_INVALID', `KV checkpoint entry ${field} is invalid.`, { value });
  }
  return value;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeKey(
  value: unknown,
  source: 'journal' | 'checkpoint'
): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  throw new KvError(
    source === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
    `KV ${source} key must be a non-empty string.`
  );
}

function normalizeValue(
  value: unknown,
  source: 'journal' | 'checkpoint'
): unknown {
  try {
    return snapshotKvValue(value);
  } catch {
    throw new KvError(
      source === 'journal' ? 'KV_JOURNAL_CORRUPT' : 'KV_CHECKPOINT_INVALID',
      `KV ${source} value is invalid.`
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

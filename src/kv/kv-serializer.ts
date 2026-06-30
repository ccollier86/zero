/**
 * kv-serializer.ts
 *
 * Serializes and validates KV journal/checkpoint records. This file owns the
 * persistence wire format only; it does not perform filesystem IO or mutate
 * the memory engine.
 */

import { KvError } from './kv-errors';
import type { KvMutation } from './kv-mutation';
import type { ZeroKvEntry, ZeroKvKind } from './kv-types';

export const KV_PERSISTENCE_FORMAT_VERSION = 1;

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
  version: typeof KV_PERSISTENCE_FORMAT_VERSION;
  sequence: number;
  timestamp: number;
  mutation: KvMutation;
}

/** Checkpoint payload persisted by the checkpoint store. */
export interface KvCheckpointPayload {
  version: typeof KV_PERSISTENCE_FORMAT_VERSION;
  sequence: number;
  timestamp: number;
  entries: ZeroKvEntry[];
}

/** Serialize a journal record as one JSONL line. */
export function serializeKvJournalRecord(record: KvJournalRecord): string {
  return JSON.stringify(record) + '\n';
}

/** Parse and validate one journal JSONL line. */
export function parseKvJournalRecord(line: string): KvJournalRecord {
  return normalizeJournalRecord(parseJson(line, 'journal'));
}

/** Serialize a checkpoint payload. */
export function serializeKvCheckpoint(payload: KvCheckpointPayload): string {
  return JSON.stringify(payload, null, 2);
}

/** Parse and validate a checkpoint payload. */
export function parseKvCheckpoint(text: string): KvCheckpointPayload {
  const parsed = parseJson(text, 'checkpoint');
  if (!isRecord(parsed) || parsed.version !== KV_PERSISTENCE_FORMAT_VERSION) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint version is invalid.');
  }
  if (!isPositiveSequence(parsed.sequence) || typeof parsed.timestamp !== 'number') {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint metadata is invalid.');
  }
  if (!Array.isArray(parsed.entries)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entries must be an array.');
  }

  return {
    version: KV_PERSISTENCE_FORMAT_VERSION,
    sequence: parsed.sequence,
    timestamp: parsed.timestamp,
    entries: parsed.entries.map(normalizeEntry),
  };
}

function normalizeJournalRecord(value: unknown): KvJournalRecord {
  if (!isRecord(value) || value.version !== KV_PERSISTENCE_FORMAT_VERSION) {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV journal record version is invalid.');
  }
  if (!isPositiveSequence(value.sequence) || typeof value.timestamp !== 'number') {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV journal record metadata is invalid.');
  }

  return {
    version: KV_PERSISTENCE_FORMAT_VERSION,
    sequence: value.sequence,
    timestamp: value.timestamp,
    mutation: normalizeMutation(value.mutation),
  };
}

function normalizeMutation(value: unknown): KvMutation {
  if (!isRecord(value) || typeof value.op !== 'string' || typeof value.key !== 'string') {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation shape is invalid.');
  }

  switch (value.op) {
    case 'set':
      return {
        op: 'set',
        key: value.key,
        value: value.value,
        kind: normalizeKind(value.kind, true),
        expiresAt: normalizeExpiresAt(value.expiresAt, true),
      };
    case 'delete':
      return { op: 'delete', key: value.key };
    case 'expire':
      return { op: 'expire', key: value.key, expiresAt: normalizeRequiredExpiresAt(value.expiresAt) };
    case 'increment':
      if (typeof value.delta !== 'number') {
        throw new KvError('KV_JOURNAL_CORRUPT', 'KV increment mutation delta is invalid.');
      }
      return {
        op: 'increment',
        key: value.key,
        delta: value.delta,
        expiresAt: normalizeExpiresAt(value.expiresAt, true),
      };
    default:
      throw new KvError('KV_JOURNAL_CORRUPT', `Unsupported KV mutation op "${value.op}".`);
  }
}

function normalizeEntry(value: unknown): ZeroKvEntry {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.kind !== 'string') {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entry shape is invalid.');
  }
  if (!isPositiveSequence(value.version)) {
    throw new KvError('KV_CHECKPOINT_INVALID', 'KV checkpoint entry version is invalid.');
  }

  return {
    key: value.key,
    kind: normalizeKind(value.kind, false),
    value: value.value,
    expiresAt: normalizeRequiredExpiresAt(value.expiresAt),
    version: value.version,
    createdAt: normalizeNumber(value.createdAt, 'createdAt'),
    updatedAt: normalizeNumber(value.updatedAt, 'updatedAt'),
    lastAccessedAt: normalizeNumber(value.lastAccessedAt, 'lastAccessedAt'),
    sizeBytes: normalizeNumber(value.sizeBytes, 'sizeBytes'),
  };
}

function normalizeKind(value: unknown, allowUndefined: true): ZeroKvKind | undefined;
function normalizeKind(value: unknown, allowUndefined: false): ZeroKvKind;
function normalizeKind(value: unknown, allowUndefined: boolean): ZeroKvKind | undefined {
  if (value === undefined && allowUndefined) return undefined;
  if (typeof value !== 'string' || !ZERO_KV_KINDS.has(value as ZeroKvKind)) {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV kind is invalid.', { value });
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

function normalizeExpiresAt(value: unknown, allowUndefined: boolean): number | null | undefined {
  if (value === undefined && allowUndefined) return undefined;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number') {
    throw new KvError('KV_JOURNAL_CORRUPT', 'KV mutation expiresAt must be a number, null, or undefined.');
  }
  return value;
}

function normalizeRequiredExpiresAt(value: unknown): number | null {
  const expiresAt = normalizeExpiresAt(value, false);
  return expiresAt ?? null;
}

function normalizeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new KvError('KV_CHECKPOINT_INVALID', `KV checkpoint entry ${field} is invalid.`, { value });
  }
  return value;
}

function isPositiveSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

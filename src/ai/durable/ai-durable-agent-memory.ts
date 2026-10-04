/**
 * ai-durable-agent-memory.ts
 *
 * Encodes large private AI state across bounded Torrent scratch-memory values.
 * It owns chunk manifests and JSON reconstruction only; it does not execute
 * models, authorize callers, or expose private values through ReactiveDB.
 */

import { AIError } from '../ai-errors';
import type { WorkflowMemoryContext } from '../../workflows/workflow-memory-context';
import {
  parseWorkflowJson,
  serializeWorkflowJson,
  workflowJsonBytes,
  type WorkflowJsonValue,
} from '../../workflows/workflow-json-value';
import { AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES } from './ai-durable-agent-limits';

const RAW_CHUNK_BYTES = 24 * 1024;
const MAX_ENCODED_CHUNK_CHARACTERS = Math.ceil(RAW_CHUNK_BYTES / 3) * 4;
const MAX_DURABLE_STATE_CHUNKS = Math.ceil(
  AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES / RAW_CHUNK_BYTES,
);
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

interface ChunkManifest {
  readonly version: 1 | 2;
  readonly chunks: number;
  readonly bytes: number;
}

export interface AIDurableEncodedStorageEstimate {
  readonly bytes: number;
  readonly entries: number;
}

/** Produce initial-memory entries without ever placing the value in public input. */
export function createAIDurableMemorySeed(
  prefix: string,
  value: unknown,
): Readonly<Record<string, WorkflowJsonValue>> {
  const encoded = encode(value);
  const entries: Record<string, WorkflowJsonValue> = Object.create(null);
  entries[manifestKey(prefix)] = encoded.manifest;
  encoded.chunks.forEach((chunk, index) => {
    entries[chunkKey(prefix, index)] = chunk;
  });
  return Object.freeze(entries);
}

/** Atomically stage a chunked private value in the current activity attempt. */
export function writeAIDurableMemory(
  memory: WorkflowMemoryContext,
  prefix: string,
  value: unknown,
): void {
  const prior = readManifest(memory.get(manifestKey(prefix)), prefix, false);
  const encoded = encode(value);
  memory.set(manifestKey(prefix), encoded.manifest);
  encoded.chunks.forEach((chunk, index) => memory.set(chunkKey(prefix, index), chunk));
  for (let index = encoded.chunks.length; index < (prior?.chunks ?? 0); index += 1) {
    memory.delete(chunkKey(prefix, index));
  }
}

/** Read and validate one required private value from Torrent scratch memory. */
export function readAIDurableMemory<T>(
  memory: Pick<WorkflowMemoryContext, 'get'>,
  prefix: string,
): T {
  const manifest = readManifest(memory.get(manifestKey(prefix)), prefix, true)!;
  const chunks: string[] = [];
  for (let index = 0; index < manifest.chunks; index += 1) {
    const chunk = memory.get(chunkKey(prefix, index));
    if (typeof chunk !== 'string') throw corrupt(prefix);
    chunks.push(chunk);
  }
  try {
    const serialized = manifest.version === 1
      ? readLegacyChunks(chunks, manifest)
      : readBase64Chunks(chunks, manifest);
    return parseWorkflowJson(serialized) as T;
  } catch {
    throw corrupt(prefix);
  }
}

/** Remove a complete private value after its state has been folded forward. */
export function deleteAIDurableMemory(
  memory: WorkflowMemoryContext,
  prefix: string,
): void {
  const manifest = readManifest(memory.get(manifestKey(prefix)), prefix, false);
  if (!manifest) return;
  memory.delete(manifestKey(prefix));
  for (let index = 0; index < manifest.chunks; index += 1) {
    memory.delete(chunkKey(prefix, index));
  }
}

/** Upper-bound encoded row bytes/entries for a canonical JSON payload size. */
export function estimateAIDurableEncodedStorage(
  rawBytes: number,
): AIDurableEncodedStorageEstimate {
  if (!Number.isSafeInteger(rawBytes) || rawBytes < 1
    || rawBytes > AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES) {
    throw invalid('Durable AI agent state exceeded its private-value limit.');
  }
  const chunks = Math.ceil(rawBytes / RAW_CHUNK_BYTES);
  const fullChunks = Math.floor(rawBytes / RAW_CHUNK_BYTES);
  const remainder = rawBytes % RAW_CHUNK_BYTES;
  const encodedCharacters = fullChunks * MAX_ENCODED_CHUNK_CHARACTERS
    + (remainder === 0 ? 0 : Math.ceil(remainder / 3) * 4);
  const manifest = { version: 2, chunks, bytes: rawBytes };
  return {
    bytes: encodedCharacters + (chunks * 2)
      + workflowJsonBytes(serializeWorkflowJson(manifest)),
    entries: chunks + 1,
  };
}

function encode(value: unknown): { manifest: WorkflowJsonValue; chunks: string[] } {
  let serialized: string;
  try {
    // AI SDK response messages contain optional properties materialized as
    // `undefined`. Canonicalize with normal JSON omission semantics, then run
    // the strict workflow parser so unsafe members still fail closed.
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('No JSON value was produced');
    serialized = serializeWorkflowJson(parseWorkflowJson(json));
  } catch (error) {
    const wrapped = invalid('Durable AI agent state must contain JSON-safe data only.');
    Object.defineProperty(wrapped, 'cause', { value: error, configurable: true });
    throw wrapped;
  }
  const raw = encoder.encode(serialized);
  const chunks = splitBytes(raw, RAW_CHUNK_BYTES).map((chunk) => chunk.toBase64());
  const bytes = raw.byteLength;
  if (bytes > AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES
    || chunks.length > MAX_DURABLE_STATE_CHUNKS) {
    throw invalid('Durable AI agent state exceeded its private-state limit.');
  }
  return {
    manifest: Object.freeze({
      version: 2,
      chunks: chunks.length,
      bytes,
    }) as WorkflowJsonValue,
    chunks,
  };
}

function splitBytes(value: Uint8Array, maxBytes: number): Uint8Array[] {
  if (value.byteLength === 0) return [value];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < value.byteLength; offset += maxBytes) {
    chunks.push(value.slice(offset, Math.min(value.byteLength, offset + maxBytes)));
  }
  return chunks;
}

function readLegacyChunks(chunks: readonly string[], manifest: ChunkManifest): string {
  let bytes = 0;
  for (const chunk of chunks) {
    const chunkBytes = encoder.encode(chunk).byteLength;
    if (chunkBytes > 32 * 1024 || bytes + chunkBytes > manifest.bytes) {
      throw new TypeError('Invalid legacy chunk');
    }
    bytes += chunkBytes;
  }
  if (bytes !== manifest.bytes) throw new TypeError('Invalid legacy byte count');
  return chunks.join('');
}

function readBase64Chunks(chunks: readonly string[], manifest: ChunkManifest): string {
  const joined = new Uint8Array(manifest.bytes);
  let offset = 0;
  for (const chunk of chunks) {
    if (chunk.length < 1 || chunk.length > MAX_ENCODED_CHUNK_CHARACTERS) {
      throw new TypeError('Invalid encoded chunk');
    }
    const decoded = Uint8Array.fromBase64(chunk);
    if (decoded.byteLength > RAW_CHUNK_BYTES
      || offset + decoded.byteLength > manifest.bytes
      || decoded.toBase64() !== chunk) {
      throw new TypeError('Invalid encoded chunk');
    }
    joined.set(decoded, offset);
    offset += decoded.byteLength;
  }
  if (offset !== manifest.bytes) throw new TypeError('Invalid encoded byte count');
  return decoder.decode(joined);
}

function readManifest(
  value: WorkflowJsonValue | undefined,
  prefix: string,
  required: boolean,
): ChunkManifest | null {
  if (value === undefined) {
    if (required) throw corrupt(prefix);
    return null;
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw corrupt(prefix);
  const candidate = value as Record<string, WorkflowJsonValue>;
  if ((candidate.version !== 1 && candidate.version !== 2)
    || !Number.isSafeInteger(candidate.chunks)
    || Number(candidate.chunks) < 1
    || Number(candidate.chunks) > MAX_DURABLE_STATE_CHUNKS
    || !Number.isSafeInteger(candidate.bytes)
    || Number(candidate.bytes) < 1
    || Number(candidate.bytes) > AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES) throw corrupt(prefix);
  return {
    version: candidate.version,
    chunks: Number(candidate.chunks),
    bytes: Number(candidate.bytes),
  };
}

function manifestKey(prefix: string): string {
  return `${prefix}.manifest`;
}

function chunkKey(prefix: string, index: number): string {
  return `${prefix}.chunk.${index}`;
}

function invalid(message: string): AIError {
  return new AIError(message, 'AI_AGENT_EXECUTION_FAILED', 500);
}

function corrupt(prefix: string): AIError {
  return new AIError(
    `Durable AI agent private state is invalid: ${prefix}.`,
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}

/** Normalize and detach Zero-friendly tool inputs and outputs. */

import type { JSONValue } from '@ai-sdk/provider';
import type { ToolResultOutput } from '@ai-sdk/provider-utils';

import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { utf8ByteLength } from './ai-operation-limits';
import { normalizeAIProviderOptions } from './ai-provider-options';

const MAX_TOOL_MEDIA_BYTES = 64 * 1024 * 1024;

/** Snapshot one historical tool-call input before an async model request. */
export function snapshotAIToolCallInput(input: unknown): unknown {
  return snapshotAIJSONValue(input === undefined ? null : input, 'AI tool-call input');
}

/** Accept raw application values and emit an immutable SDK 7 tool result. */
export function normalizeAIToolResultOutput(output: unknown): ToolResultOutput {
  if (!isRecord(output) || typeof output.type !== 'string') {
    if (typeof output === 'string') {
      return frozen({ type: 'text', value: output });
    }
    return frozen({
      type: 'json',
      value: snapshotRawJSON(output),
    }) as ToolResultOutput;
  }

  switch (output.type) {
    case 'text':
    case 'error-text':
      if (typeof output.value !== 'string') throw invalidOutput();
      return frozen({
        type: output.type,
        value: output.value,
        ...snapshotToolProviderOptions(output.providerOptions),
      });
    case 'json':
    case 'error-json':
      return frozen({
        type: output.type,
        value: snapshotAIJSONValue(output.value, 'AI tool result'),
        ...snapshotToolProviderOptions(output.providerOptions),
      });
    case 'execution-denied':
      if (output.reason !== undefined && typeof output.reason !== 'string') throw invalidOutput();
      return frozen({
        type: 'execution-denied',
        ...(output.reason === undefined ? {} : { reason: output.reason }),
        ...snapshotToolProviderOptions(output.providerOptions),
      });
    case 'content':
      if (!Array.isArray(output.value)) throw invalidOutput();
      return frozen({
        type: 'content',
        value: Object.freeze(output.value.map(snapshotToolContentPart)),
      }) as ToolResultOutput;
    default:
      // An ordinary JSON result may legitimately have its own `type` field.
      return frozen({ type: 'json', value: snapshotRawJSON(output) }) as ToolResultOutput;
  }
}

function snapshotToolContentPart(value: unknown): unknown {
  if (!isRecord(value) || typeof value.type !== 'string') throw invalidOutput();
  const common = snapshotToolProviderOptions(value.providerOptions);
  switch (value.type) {
    case 'text':
      if (typeof value.text !== 'string') throw invalidOutput();
      return frozen({ type: 'text', text: value.text, ...common });
    case 'file':
      if (typeof value.mediaType !== 'string'
        || (value.filename !== undefined && typeof value.filename !== 'string')) {
        throw invalidOutput();
      }
      return frozen({
        type: 'file',
        data: snapshotFileData(value.data),
        mediaType: value.mediaType,
        ...(value.filename === undefined ? {} : { filename: value.filename }),
        ...common,
      });
    case 'file-data':
      return snapshotLegacyDataPart(value, false, common);
    case 'image-data':
      return snapshotLegacyDataPart(value, true, common);
    case 'file-url':
      if (typeof value.url !== 'string'
        || (value.mediaType !== undefined && typeof value.mediaType !== 'string')) {
        throw invalidOutput();
      }
      return frozen({
        type: 'file-url',
        url: value.url,
        ...(value.mediaType === undefined ? {} : { mediaType: value.mediaType }),
        ...common,
      });
    case 'image-url':
      if (typeof value.url !== 'string') throw invalidOutput();
      return frozen({ type: 'image-url', url: value.url, ...common });
    case 'file-id':
    case 'image-file-id':
      return frozen({
        type: value.type,
        fileId: snapshotProviderFileId(value.fileId),
        ...common,
      });
    case 'file-reference':
    case 'image-file-reference':
      return frozen({
        type: value.type,
        providerReference: snapshotProviderReference(value.providerReference),
        ...common,
      });
    case 'custom':
      return frozen({ type: 'custom', ...common });
    default:
      throw invalidOutput();
  }
}

function snapshotToolProviderOptions(
  value: unknown,
): { providerOptions?: ReturnType<typeof normalizeAIProviderOptions> } {
  if (value === undefined) return {};
  return { providerOptions: normalizeAIProviderOptions(value as never) };
}

function snapshotFileData(value: unknown): unknown {
  if (!isRecord(value) || typeof value.type !== 'string') throw invalidOutput();
  switch (value.type) {
    case 'data':
      if (typeof value.data === 'string') {
        assertMediaBytes(utf8ByteLength(value.data, MAX_TOOL_MEDIA_BYTES));
        return frozen({ type: 'data', data: value.data });
      }
      if (value.data instanceof Uint8Array) {
        assertMediaBytes(value.data.byteLength);
        return frozen({ type: 'data', data: new Uint8Array(value.data) });
      }
      if (value.data instanceof ArrayBuffer) {
        assertMediaBytes(value.data.byteLength);
        return frozen({ type: 'data', data: value.data.slice(0) });
      }
      throw invalidOutput();
    case 'url':
      if (!(value.url instanceof URL)
        || (value.originalUrl !== undefined && typeof value.originalUrl !== 'string')) {
        throw invalidOutput();
      }
      return frozen({
        type: 'url',
        url: new URL(value.url),
        ...(value.originalUrl === undefined ? {} : { originalUrl: value.originalUrl }),
      });
    case 'reference':
      return frozen({
        type: 'reference',
        reference: snapshotProviderReference(value.reference),
      });
    case 'text':
      if (typeof value.text !== 'string') throw invalidOutput();
      assertMediaBytes(utf8ByteLength(value.text, MAX_TOOL_MEDIA_BYTES));
      return frozen({ type: 'text', text: value.text });
    default:
      throw invalidOutput();
  }
}

function snapshotLegacyDataPart(
  value: Record<string, unknown>,
  image: boolean,
  common: Record<string, unknown>,
): unknown {
  if (typeof value.data !== 'string' || typeof value.mediaType !== 'string'
    || (!image && value.filename !== undefined && typeof value.filename !== 'string')) {
    throw invalidOutput();
  }
  assertMediaBytes(utf8ByteLength(value.data, MAX_TOOL_MEDIA_BYTES));
  return frozen({
    type: image ? 'image-data' : 'file-data',
    data: value.data,
    mediaType: value.mediaType,
    ...(!image && value.filename !== undefined ? { filename: value.filename } : {}),
    ...common,
  });
}

function snapshotProviderFileId(value: unknown): string | Record<string, string> {
  return typeof value === 'string' ? value : snapshotProviderReference(value);
}

function snapshotProviderReference(value: unknown): Record<string, string> {
  const snapshot = snapshotAIJSONValue(value, 'AI tool provider reference');
  if (!isRecord(snapshot)
    || Object.keys(snapshot).length === 0
    || Object.values(snapshot).some((entry) => typeof entry !== 'string')) {
    throw invalidOutput();
  }
  return snapshot as Record<string, string>;
}

function snapshotRawJSON(value: unknown): JSONValue {
  return snapshotAIJSONValue(value === undefined ? null : value, 'AI tool result');
}

function assertMediaBytes(bytes: number): void {
  if (bytes > MAX_TOOL_MEDIA_BYTES) {
    throw new AIError(
      'AI tool result media exceeds the byte limit.',
      'AI_REQUEST_LIMIT_EXCEEDED',
      413,
    );
  }
}

function frozen<Value extends object>(value: Value): Value {
  return Object.freeze(value);
}

function invalidOutput(): AIError {
  return new AIError('AI tool result is invalid.', 'AI_REQUEST_INVALID', 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

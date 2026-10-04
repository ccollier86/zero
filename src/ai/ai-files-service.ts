/**
 * ai-files-service.ts
 *
 * Orchestrates bounded provider-hosted file operations over Zero's configured
 * AI registry. This service owns provider capability checks and transfer
 * lifecycle; it does not register routes or authorize application callers.
 */

import type {
  FilesV4DeleteFileResult,
  FilesV4DownloadFileResult,
  FilesV4GetFileMetadataResult,
  FilesV4UploadFileCallOptions,
  FilesV4UploadFileResult,
  SharedV4Warning,
} from '@ai-sdk/provider';

import { createAIBoundedByteStream } from './ai-bounded-byte-stream';
import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { startAIHostedFileTelemetry } from './ai-files-telemetry';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders } from './ai-request-snapshot';
import type {
  AIHostedFileDeleteRequest,
  AIHostedFileDeleteResult,
  AIHostedFileDownload,
  AIHostedFileDownloadRequest,
  AIHostedFileMetadata,
  AIHostedFileMetadataRequest,
  AIHostedFileUploadRequest,
  AIHostedFileUploadSource,
} from './ai-files-types';
import {
  createAIHostedFileLocator,
  mergeAIHostedFileReference,
  validateAIFileByteLimit,
  validateAIHostedFileLocator,
  validateAIHostedFileUpload,
  validateAIProviderByteSize,
  validateAIProviderDate,
  validateAIProviderFilename,
  validateAIProviderMediaType,
} from './ai-files-validation';
import {
  resolveFilesProvider,
  type AIRegistry,
  type ResolvedAIFilesProvider,
} from './ai-registry';
import { normalizeAIRequestError } from './ai-service-support';

/** Registry state needed by the isolated hosted-files service. */
export interface AIHostedFilesServiceContext {
  registry: AIRegistry;
  defaultProvider?: string | null;
}

/** Provider-hosted file operations exposed for AIService composition. */
export interface AIHostedFilesService {
  upload(request: AIHostedFileUploadRequest): Promise<AIHostedFileMetadata>;
  metadata(request: AIHostedFileMetadataRequest): Promise<AIHostedFileMetadata>;
  download(request: AIHostedFileDownloadRequest): Promise<AIHostedFileDownload>;
  delete(request: AIHostedFileDeleteRequest): Promise<AIHostedFileDeleteResult>;
}

/** Create a small hosted-files facade bound to one AI registry. */
export function createAIHostedFilesService(
  context: AIHostedFilesServiceContext
): AIHostedFilesService {
  return {
    upload: (request) => executeAIHostedFileUpload(request, context),
    metadata: (request) => executeAIHostedFileMetadata(request, context),
    download: (request) => executeAIHostedFileDownload(request, context),
    delete: (request) => executeAIHostedFileDelete(request, context),
  };
}

/** Upload a bounded byte, text, or stream source to a configured provider. */
export async function executeAIHostedFileUpload(
  request: AIHostedFileUploadRequest,
  context: AIHostedFilesServiceContext
): Promise<AIHostedFileMetadata> {
  const validated = validateAIHostedFileUpload(request);
  const resolved = resolveFilesProvider(
    context.registry,
    request.provider,
    context.defaultProvider
  );
  assertFileOperation(resolved, 'upload');
  const telemetry = startAIHostedFileTelemetry(resolved, 'upload', request.metadata);
  let source: PreparedUploadSource | undefined;

  try {
    source = prepareUploadSource(validated.data, validated.maxBytes);
    const result = await resolved.files.uploadFile({
      data: source.data,
      mediaType: validated.mediaType,
      filename: validated.filename,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
    });
    await source.cancelUnread().catch(() => undefined);
    const output = uploadedFileMetadata(
      resolved,
      result,
      validated.maxBytes,
      source.byteSize()
    );
    telemetry.complete();
    return output;
  } catch (error) {
    await source?.cancelUnread(error).catch(() => undefined);
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

/** Read provider metadata while retaining Zero's durable provider binding. */
export async function executeAIHostedFileMetadata(
  request: AIHostedFileMetadataRequest,
  context: AIHostedFilesServiceContext
): Promise<AIHostedFileMetadata> {
  const file = validateAIHostedFileLocator(request.file);
  const resolved = resolveFilesProvider(context.registry, file.providerId, context.defaultProvider);
  assertFileOperation(resolved, 'metadata');
  const telemetry = startAIHostedFileTelemetry(resolved, 'metadata', request.metadata);

  try {
    const result = await resolved.files.getFileMetadata!({
      file: file.providerReference,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
    });
    const output = providerFileMetadata(file, result);
    telemetry.complete();
    return output;
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

/**
 * Open a bounded download stream.
 *
 * Telemetry remains open until the returned stream closes, is cancelled, or
 * errors; obtaining response headers alone never records a completed transfer.
 */
export async function executeAIHostedFileDownload(
  request: AIHostedFileDownloadRequest,
  context: AIHostedFilesServiceContext
): Promise<AIHostedFileDownload> {
  const file = validateAIHostedFileLocator(request.file);
  const maxBytes = validateAIFileByteLimit(request.maxBytes);
  const resolved = resolveFilesProvider(context.registry, file.providerId, context.defaultProvider);
  assertFileOperation(resolved, 'download');
  const telemetry = startAIHostedFileTelemetry(resolved, 'download', request.metadata);

  try {
    const result = await resolved.files.downloadFile!({
      file: file.providerReference,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
    });
    assertDownloadResult(result);
    const bounded = createAIBoundedByteStream(result.content, maxBytes, {
      abortSignal: request.abortSignal,
      close: () => telemetry.complete(),
      cancel: () => telemetry.fail(new AIError(
        'The AI file download was cancelled.',
        'AI_REQUEST_ABORTED',
        499
      )),
      error: (error) => telemetry.fail(error),
    });
    return Object.freeze({
      file,
      content: bounded.stream,
      ...optional('mediaType', validateAIProviderMediaType(result.mediaType)),
      ...optionalProviderMetadata(result.providerMetadata),
      warnings: detachedWarnings(result.warnings),
    });
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

/** Delete a provider-hosted file when the selected provider supports it. */
export async function executeAIHostedFileDelete(
  request: AIHostedFileDeleteRequest,
  context: AIHostedFilesServiceContext
): Promise<AIHostedFileDeleteResult> {
  const file = validateAIHostedFileLocator(request.file);
  const resolved = resolveFilesProvider(context.registry, file.providerId, context.defaultProvider);
  assertFileOperation(resolved, 'delete');
  const telemetry = startAIHostedFileTelemetry(resolved, 'delete', request.metadata);

  try {
    const result = await resolved.files.deleteFile!({
      file: file.providerReference,
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
    });
    const output = deletedFileResult(file, result);
    telemetry.complete();
    return output;
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

interface PreparedUploadSource {
  data: FilesV4UploadFileCallOptions['data'];
  byteSize(): number | undefined;
  cancelUnread(reason?: unknown): Promise<void>;
}

function prepareUploadSource(
  source: AIHostedFileUploadSource,
  maxBytes: number
): PreparedUploadSource {
  switch (source.type) {
    case 'data':
      return {
        data: source,
        byteSize: () => source.data.byteLength,
        cancelUnread: async () => undefined,
      };
    case 'text': {
      const bytes = new TextEncoder().encode(source.text).byteLength;
      return {
        data: source,
        byteSize: () => bytes,
        cancelUnread: async () => undefined,
      };
    }
    case 'stream': {
      const bounded = createAIBoundedByteStream(source.stream, maxBytes, {
        origin: 'request',
      });
      return {
        data: { type: 'stream', stream: bounded.stream },
        byteSize: bounded.bytesRead,
        cancelUnread: bounded.cancel,
      };
    }
  }
}

function uploadedFileMetadata(
  resolved: ResolvedAIFilesProvider,
  result: FilesV4UploadFileResult,
  maxBytes: number,
  observedBytes: number | undefined
): AIHostedFileMetadata {
  assertRecord(result, 'AI files provider returned an invalid upload response.');
  const reportedBytes = validateAIProviderByteSize(result.byteSize, maxBytes);
  const byteSize = reportedBytes ?? validateAIProviderByteSize(observedBytes, maxBytes);
  return Object.freeze({
    file: createAIHostedFileLocator(resolved.provider.id, result.providerReference),
    ...optional('filename', validateAIProviderFilename(result.filename)),
    ...optional('mediaType', validateAIProviderMediaType(result.mediaType)),
    ...optional('byteSize', byteSize),
    ...optional('createdAt', validateAIProviderDate(result.createdAt)),
    ...optional('expiresAt', validateAIProviderDate(result.expiresAt)),
    ...optionalProviderMetadata(result.providerMetadata),
    warnings: detachedWarnings(result.warnings),
  });
}

function providerFileMetadata(
  file: ReturnType<typeof validateAIHostedFileLocator>,
  result: FilesV4GetFileMetadataResult
): AIHostedFileMetadata {
  assertRecord(result, 'AI files provider returned an invalid metadata response.');
  return Object.freeze({
    file: mergeAIHostedFileReference(file, result.providerReference),
    ...optional('filename', validateAIProviderFilename(result.filename)),
    ...optional('mediaType', validateAIProviderMediaType(result.mediaType)),
    ...optional('byteSize', validateAIProviderByteSize(result.byteSize)),
    ...optional('createdAt', validateAIProviderDate(result.createdAt)),
    ...optional('expiresAt', validateAIProviderDate(result.expiresAt)),
    ...optionalProviderMetadata(result.providerMetadata),
    warnings: detachedWarnings(result.warnings),
  });
}

function deletedFileResult(
  file: ReturnType<typeof validateAIHostedFileLocator>,
  result: FilesV4DeleteFileResult
): AIHostedFileDeleteResult {
  assertRecord(result, 'AI files provider returned an invalid delete response.');
  if (typeof result.deleted !== 'boolean') {
    throw invalidProviderResponse('AI files provider returned an invalid delete response.');
  }
  return Object.freeze({
    file: mergeAIHostedFileReference(file, result.providerReference),
    deleted: result.deleted,
    ...optionalProviderMetadata(result.providerMetadata),
    warnings: detachedWarnings(result.warnings),
  });
}

function assertDownloadResult(result: FilesV4DownloadFileResult): void {
  assertRecord(result, 'AI files provider returned an invalid download response.');
  if (!(result.content instanceof ReadableStream)) {
    throw invalidProviderResponse('AI files provider returned an invalid download stream.');
  }
}

function detachedWarnings(value: unknown): readonly SharedV4Warning[] {
  if (!Array.isArray(value)) {
    throw invalidProviderResponse('AI files provider returned invalid warnings.');
  }
  return Object.freeze(value.map((warning) => {
    if (!isRecord(warning) || typeof warning.type !== 'string') {
      throw invalidProviderResponse('AI files provider returned invalid warnings.');
    }
    return Object.freeze({ ...warning }) as SharedV4Warning;
  }));
}

function optionalProviderMetadata(
  value: unknown,
): { providerMetadata?: import('@ai-sdk/provider').SharedV4ProviderMetadata } {
  if (value === undefined) return {};
  try {
    const snapshot = snapshotAIJSONValue(value, 'AI files provider metadata');
    if (!isRecord(snapshot)) throw new Error('metadata');
    return {
      providerMetadata: snapshot as import('@ai-sdk/provider').SharedV4ProviderMetadata,
    };
  } catch {
    throw invalidProviderResponse('AI files provider returned invalid provider metadata.');
  }
}

function assertFileOperation(
  resolved: ResolvedAIFilesProvider,
  operation: keyof ResolvedAIFilesProvider['operations']
): void {
  if (resolved.operations[operation]) return;
  throw new AIError(
    `AI files provider "${resolved.provider.id}" does not support ${operation}.`,
    'AI_CAPABILITY_NOT_SUPPORTED',
    400
  );
}

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidProviderResponse(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidProviderResponse(message: string): AIError {
  return new AIError(message, 'AI_PROVIDER_RESPONSE_INVALID', 502);
}

function optional<Key extends string, Value>(
  key: Key,
  value: Value | undefined
): { [Property in Key]?: Value } {
  return value === undefined ? {} : { [key]: value } as { [Property in Key]: Value };
}

/**
 * ai-files-types.ts
 *
 * Defines Zero's provider-hosted file contracts. This file owns portable
 * request and result shapes only; it does not resolve providers, consume
 * streams, perform network calls, or authorize application callers.
 */

import type {
  SharedV4ProviderMetadata,
  SharedV4ProviderOptions,
  SharedV4ProviderReference,
  SharedV4Warning,
} from '@ai-sdk/provider';

/** Hard byte ceiling and default for one provider-hosted upload or download. */
export const AI_DEFAULT_HOSTED_FILE_MAX_BYTES = 64 * 1024 * 1024;

/** Durable provider locator returned by Zero after a successful upload. */
export interface AIHostedFileLocator {
  readonly version: 1;
  /** Zero's configured provider id, which can differ from an SDK canonical id. */
  readonly providerId: string;
  readonly providerReference: SharedV4ProviderReference;
}

/** Upload inputs accepted by Zero; URL inputs are intentionally excluded. */
export type AIHostedFileUploadSource =
  | { readonly type: 'data'; readonly data: Uint8Array }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'stream'; readonly stream: ReadableStream<Uint8Array> };

/** Shared provider request controls for hosted-file operations. */
export interface AIHostedFileRequestOptions {
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: SharedV4ProviderOptions;
  /** Correlation metadata only; Zero's observability sanitizer removes content. */
  metadata?: Record<string, unknown>;
}

/** Upload one bounded file to a configured provider. */
export interface AIHostedFileUploadRequest extends AIHostedFileRequestOptions {
  /** Provider id override; otherwise Zero's configured files provider is used. */
  provider?: string;
  data: AIHostedFileUploadSource;
  mediaType: string;
  filename?: string;
  /** Per-request byte ceiling, up to the fixed 64 MiB maximum. */
  maxBytes?: number;
}

/** Read metadata for a durable hosted-file locator. */
export interface AIHostedFileMetadataRequest extends AIHostedFileRequestOptions {
  file: AIHostedFileLocator;
}

/** Download a hosted file through a bounded, cancellation-aware stream. */
export interface AIHostedFileDownloadRequest extends AIHostedFileRequestOptions {
  file: AIHostedFileLocator;
  /** Per-request byte ceiling, up to the fixed 64 MiB maximum. */
  maxBytes?: number;
}

/** Delete a provider-hosted file. */
export interface AIHostedFileDeleteRequest extends AIHostedFileRequestOptions {
  file: AIHostedFileLocator;
}

/** Common safe metadata returned for an uploaded or inspected file. */
export interface AIHostedFileMetadata {
  readonly file: AIHostedFileLocator;
  readonly filename?: string;
  readonly mediaType?: string;
  readonly byteSize?: number;
  readonly createdAt?: Date;
  readonly expiresAt?: Date;
  readonly providerMetadata?: SharedV4ProviderMetadata;
  readonly warnings: readonly SharedV4Warning[];
}

/** Bounded streaming download returned by Zero. */
export interface AIHostedFileDownload {
  readonly file: AIHostedFileLocator;
  readonly content: ReadableStream<Uint8Array>;
  readonly mediaType?: string;
  readonly providerMetadata?: SharedV4ProviderMetadata;
  readonly warnings: readonly SharedV4Warning[];
}

/** Provider acknowledgement returned after a delete request. */
export interface AIHostedFileDeleteResult {
  readonly file: AIHostedFileLocator;
  readonly deleted: boolean;
  readonly providerMetadata?: SharedV4ProviderMetadata;
  readonly warnings: readonly SharedV4Warning[];
}

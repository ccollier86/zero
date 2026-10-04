/**
 * ai-video-types.ts
 *
 * Defines Zero's preview video generation contracts and durable operation
 * envelope. This file owns types only; it does not resolve aliases, poll
 * providers, download generated media, or persist workflow state.
 */

import type {
  Experimental_VideoModelV4FrameType,
  Experimental_VideoModelV4OperationWebhook,
  JSONValue,
} from '@ai-sdk/provider';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import type {
  DataContent,
  GenerateVideoPrompt,
  GenerateVideoResult,
  GetVideoStatusResult,
  StartVideoResult,
} from 'ai';

/** Hard byte ceiling and default for every generated video materialized by the SDK. */
export const AI_DEFAULT_VIDEO_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024;

/** Persistable operation reference pinned to the exact resolved model. */
export interface AIVideoOperationEnvelope {
  readonly version: 1;
  /** Fully qualified `provider/model` value; aliases are never stored here. */
  readonly resolvedModel: string;
  readonly operation: JSONValue;
}

/** Role-tagged image input supported by SDK 7 video models. */
export interface AIVideoFrameImage {
  image: DataContent;
  frameType: Experimental_VideoModelV4FrameType;
}

/** Reference input supported by SDK 7 video models. */
export type AIVideoInputReference = DataContent | {
  data: DataContent;
  mediaType?: string;
};

/** Polling controls bounded by Zero before an SDK polling loop begins. */
export interface AIVideoPollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  delay?: (delayInMs: number, options?: { abortSignal?: AbortSignal }) => PromiseLike<void>;
}

/** SDK webhook factory after Zero validates the provider-facing URL. */
export type AIVideoWebhookFactory = () => PromiseLike<{
  url: string;
  received: PromiseLike<Experimental_VideoModelV4OperationWebhook>;
}>;

/** Shared video generation controls accepted by generate and start operations. */
export interface AIVideoRequestOptions {
  model?: string;
  prompt: GenerateVideoPrompt;
  n?: number;
  maxVideosPerCall?: number;
  aspectRatio?: `${number}:${number}` | 'adaptive';
  resolution?: `${number}x${number}`;
  duration?: number;
  fps?: number;
  seed?: number;
  frameImages?: AIVideoFrameImage[];
  inputReferences?: AIVideoInputReference[];
  generateAudio?: boolean;
  providerOptions?: ProviderOptions;
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  /** Correlation metadata only; prompts and media are sanitized from events. */
  metadata?: Record<string, unknown>;
}

/** Generate and materialize one to four videos with a bounded download. */
export interface AIGenerateVideoRequest extends AIVideoRequestOptions {
  /** Ceiling for each materialized output, up to the fixed 256 MiB maximum. */
  downloadMaxBytes?: number;
  poll?: AIVideoPollOptions;
  webhook?: AIVideoWebhookFactory;
}

/** Start an asynchronous generation and return a durable Zero envelope. */
export interface AIStartVideoRequest extends AIVideoRequestOptions {
  webhookUrl?: string;
}

/** Check an operation using the model pinned into its durable envelope. */
export interface AIGetVideoStatusRequest {
  operation: AIVideoOperationEnvelope;
  /** Ceiling for inline binary/base64 results, up to the fixed 256 MiB maximum. */
  inlineVideoMaxBytes?: number;
  headers?: Record<string, string | undefined>;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

/** SDK result after Zero enforces generated-media byte limits. */
export type AIGenerateVideoResult = GenerateVideoResult;

/** Start result with SDK's opaque reference replaced by a durable Zero envelope. */
export type AIStartVideoResult = Omit<StartVideoResult, 'operation'> & {
  readonly operation: AIVideoOperationEnvelope;
};

/** Single provider status check; callers own durable polling cadence. */
export type AIVideoStatusResult = GetVideoStatusResult;

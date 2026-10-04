/** Public contracts for bounded multi-value embedding operations. */

import type {
  EmbedEndEvent,
  EmbedManyResult,
  EmbedStartEvent,
  TelemetryOptions,
} from 'ai';
import type { Context, ProviderOptions } from '@ai-sdk/provider-utils';

/** Request accepted by Zero's multi-value embedding operation. */
export interface AIEmbedManyRequest<RUNTIME_CONTEXT extends Context = Context> {
  /** Configured model reference. AIService uses the `embedding` alias by default. */
  model?: string;
  /** Non-empty text values to embed in this exact order. */
  values: readonly string[];
  /** Maximum concurrent provider calls after SDK batching. Defaults to four. */
  maxParallelCalls?: number;
  /** Maximum retry count for each provider call. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: ProviderOptions;
  /** Correlation metadata consumed by Zero observability, never provider input. */
  metadata?: Record<string, unknown>;
  runtimeContext?: RUNTIME_CONTEXT;
  telemetry?: TelemetryOptions<RUNTIME_CONTEXT>;
  onStart?: (event: EmbedStartEvent<RUNTIME_CONTEXT>) => PromiseLike<void> | void;
  onEnd?: (event: EmbedEndEvent<RUNTIME_CONTEXT>) => PromiseLike<void> | void;
}

/** Stable SDK-backed result returned by Zero's multi-value embedding operation. */
export type AIEmbedManyResult = EmbedManyResult;

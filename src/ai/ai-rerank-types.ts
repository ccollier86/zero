/** Public contracts for bounded document reranking operations. */

import type { JSONObject } from '@ai-sdk/provider';
import type {
  RerankEndEvent,
  RerankResult,
  RerankStartEvent,
  TelemetryOptions,
} from 'ai';
import type { Context, ProviderOptions } from '@ai-sdk/provider-utils';

/** One rerank document. A request must use either all strings or all objects. */
export type AIRerankDocument = string | JSONObject;

/** Request accepted by Zero's document reranking operation. */
export interface AIRerankRequest<
  VALUE extends AIRerankDocument = AIRerankDocument,
  RUNTIME_CONTEXT extends Context = Context,
> {
  /** Configured model reference. AIService uses the `reranking` alias by default. */
  model?: string;
  documents: readonly VALUE[];
  query: string;
  /** Limit the result to the highest-ranked documents. */
  topN?: number;
  /** Maximum retry count for the provider call. */
  maxRetries?: number;
  abortSignal?: AbortSignal;
  headers?: Record<string, string | undefined>;
  providerOptions?: ProviderOptions;
  /** Correlation metadata consumed by Zero observability, never provider input. */
  metadata?: Record<string, unknown>;
  runtimeContext?: RUNTIME_CONTEXT;
  telemetry?: TelemetryOptions<RUNTIME_CONTEXT>;
  onStart?: (event: RerankStartEvent<RUNTIME_CONTEXT>) => PromiseLike<void> | void;
  onEnd?: (event: RerankEndEvent<RUNTIME_CONTEXT>) => PromiseLike<void> | void;
}

/** Stable SDK-backed result returned by Zero's reranking operation. */
export type AIRerankResult<VALUE extends AIRerankDocument = AIRerankDocument> =
  RerankResult<VALUE>;

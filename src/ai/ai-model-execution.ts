/**
 * ai-model-execution.ts
 *
 * Defines and builds the prepared language-model execution boundary shared by
 * Zero agent runners. It owns provider resolution, capability admission, safe
 * prompt downloads, and request/lifecycle telemetry; it does not run a model,
 * execute tools, or persist agent state.
 */

import type {
  Experimental_DownloadFunction,
  LanguageModel,
  LanguageModelUsage,
  ModelMessage,
  TimeoutConfiguration,
  ToolSet,
} from 'ai';

import type { AIGenerationLifecycleCallbacks } from './ai-generation-lifecycle-observability';
import { composeAIGenerationLifecycleCallbacks } from './ai-generation-lifecycle-observability';
import type { AIEmitCode } from './ai-observability';
import { createAIPromptDownload } from './ai-prompt-download';
import type { ResolvedAIModel } from './ai-registry';
import { startAIRequestTelemetry } from './ai-request-telemetry';
import { assertLanguageModelExecutionCapabilities } from './ai-service-support';

/** Content-free facts required to prepare one language-model invocation. */
export interface AIModelExecutionRequest {
  readonly reference: string;
  readonly messages: readonly ModelMessage[];
  readonly toolNames: readonly string[];
  readonly abortSignal?: AbortSignal;
  readonly timeout?: TimeoutConfiguration<ToolSet>;
  /** Caller-owned, secret-free request correlation fields. */
  readonly metadata?: Record<string, unknown>;
}

/** Provider-bound dependencies and observers for one admitted invocation. */
export interface AIPreparedModelExecution {
  readonly model: LanguageModel;
  readonly download: Experimental_DownloadFunction;
  readonly lifecycle: Required<AIGenerationLifecycleCallbacks>;
  complete(details: {
    readonly usage?: LanguageModelUsage;
    readonly toolNames?: readonly string[];
  }): void;
  fail(error: unknown): void;
}

/** Resolve and admit one invocation without retaining prompt content globally. */
export type AIPrepareModelExecution = (
  request: AIModelExecutionRequest,
) => AIPreparedModelExecution | PromiseLike<AIPreparedModelExecution>;

/** Dependencies used to construct an app-bound execution preparer. */
export interface AIModelExecutionPreparerOptions {
  readonly resolveModel: (
    reference: string,
  ) => ResolvedAIModel<LanguageModel> | PromiseLike<ResolvedAIModel<LanguageModel>>;
  readonly emitCode?: AIEmitCode;
}

/** Dependencies for concrete models that do not have Zero provider metadata. */
export interface AIDirectModelExecutionOptions {
  readonly model: LanguageModel;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: TimeoutConfiguration<ToolSet>;
  readonly emitCode?: AIEmitCode;
}

/**
 * Build a reusable model-execution preparer for ephemeral or durable runners.
 *
 * Capability failures happen before request telemetry starts or any provider
 * work occurs. Returned completion/failure hooks are idempotent and contain no
 * prompt, tool input, authority object, or provider credential.
 */
export function createAIModelExecutionPreparer(
  options: AIModelExecutionPreparerOptions,
): AIPrepareModelExecution {
  return async (request) => {
    const resolved = await options.resolveModel(request.reference);
    assertLanguageModelExecutionCapabilities(resolved.provider, request);

    const emitCode = options.emitCode ?? resolved.emitCode;
    const observableResolved = emitCode === resolved.emitCode
      ? resolved
      : { ...resolved, emitCode };
    const telemetry = startAIRequestTelemetry(
      observableResolved,
      'text',
      request.metadata,
    );

    try {
      return Object.freeze({
        model: resolved.model,
        download: createAIPromptDownload({
          abortSignal: request.abortSignal,
          timeout: request.timeout,
        }),
        lifecycle: composeAIGenerationLifecycleCallbacks({}, emitCode),
        complete: telemetry.complete,
        fail: telemetry.fail,
      });
    } catch (error) {
      telemetry.fail(error);
      throw error;
    }
  };
}

/** Prepare a concrete SDK model with Zero's safe downloader and lifecycle sink. */
export function prepareDirectAIModelExecution(
  options: AIDirectModelExecutionOptions,
): AIPreparedModelExecution {
  return Object.freeze({
    model: options.model,
    download: createAIPromptDownload({
      abortSignal: options.abortSignal,
      timeout: options.timeout,
    }),
    lifecycle: composeAIGenerationLifecycleCallbacks({}, options.emitCode),
    complete: () => undefined,
    fail: () => undefined,
  });
}

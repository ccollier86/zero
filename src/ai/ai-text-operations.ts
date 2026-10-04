/** Bounded text generation and streaming orchestration for Zero's AI service. */

import {
  generateText,
  streamText,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import type { Context } from '@ai-sdk/provider-utils';

import {
  composeAIGenerationLifecycleCallbacks,
  composeAIStreamErrorCallback,
} from './ai-generation-lifecycle-observability';
import type { AIEmitCode } from './ai-observability';
import type { AIAnyOutput, AIOutputSpec } from './ai-output';
import { createAIPromptDownload } from './ai-prompt-download';
import { normalizeAIProviderOptions } from './ai-provider-options';
import {
  snapshotAIHeaders,
  snapshotAIStringList,
  snapshotAITimeout,
  snapshotAIToolApprovalSecret,
} from './ai-request-snapshot';
import type { ResolvedAIModel } from './ai-registry';
import { startAIRequestTelemetry } from './ai-request-telemetry';
import {
  assertLanguageRequestCapabilities,
  normalizeAIRequestError,
  promptInput,
} from './ai-service-support';
import type {
  AIGenerateTextRequest,
  AIStreamResult,
  AIStreamTextRequest,
  AITextResult,
} from './ai-types';

export interface AITextOperationContext {
  readonly resolved: ResolvedAIModel<LanguageModel>;
  readonly emitCode?: AIEmitCode;
}

/** Execute one admitted, observable SDK 7 text generation request. */
export async function executeAIGenerateText<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
>(
  request: AIGenerateTextRequest<Tools, RuntimeContext, Output>,
  context: AITextOperationContext,
): Promise<AITextResult<Tools, RuntimeContext, Output>> {
  const { resolved } = context;
  assertLanguageRequestCapabilities(resolved.provider, request);
  const telemetry = startAIRequestTelemetry(resolved, 'text', request.metadata);
  const lifecycle = composeAIGenerationLifecycleCallbacks(request, context.emitCode);

  try {
    const sdkRequest = {
      model: resolved.model,
      ...promptInput(request, resolved.provider.id),
      maxRetries: request.maxRetries,
      timeout: snapshotAITimeout(request.timeout),
      headers: snapshotAIHeaders(request.headers),
      temperature: request.temperature,
      topP: request.topP,
      topK: request.topK,
      presencePenalty: request.presencePenalty,
      frequencyPenalty: request.frequencyPenalty,
      seed: request.seed,
      reasoning: request.reasoning,
      maxOutputTokens: request.maxOutputTokens,
      stopSequences: snapshotAIStringList(request.stopSequences, 'stopSequences'),
      abortSignal: request.abortSignal,
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      output: request.output,
      stopWhen: normalizeStopConditions(request.stopWhen),
      runtimeContext: request.runtimeContext,
      toolsContext: request.toolsContext,
      activeTools: snapshotAIStringList(request.activeTools, 'activeTools'),
      toolOrder: snapshotAIStringList(request.toolOrder, 'toolOrder'),
      prepareStep: request.prepareStep,
      toolApproval: request.toolApproval,
      experimental_toolApprovalSecret: snapshotAIToolApprovalSecret(request.toolApprovalSecret),
      telemetry: request.telemetry,
      include: request.include,
      experimental_download: createAIPromptDownload({
        abortSignal: request.abortSignal,
        timeout: request.timeout,
      }),
      onStart: request.onStart,
      onStepStart: lifecycle.onStepStart,
      onLanguageModelCallStart: lifecycle.onLanguageModelCallStart,
      onLanguageModelCallEnd: lifecycle.onLanguageModelCallEnd,
      onToolExecutionStart: lifecycle.onToolExecutionStart,
      onToolExecutionEnd: lifecycle.onToolExecutionEnd,
      onStepEnd: lifecycle.onStepEnd,
      onEnd: request.onEnd,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
    } as Parameters<typeof generateText<Tools, RuntimeContext, Output>>[0];
    const result = await generateText<Tools, RuntimeContext, Output>(sdkRequest);
    // Force SDK 7 structured-output parsing inside Zero's stable error boundary.
    if (request.output) void result.output;
    telemetry.complete({
      usage: result.usage,
      toolNames: Object.keys(request.tools ?? {}),
    });
    return result as AITextResult<Tools, RuntimeContext, Output>;
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

/** Start one admitted, observable SDK 7 streaming text request. */
export function executeAIStreamText<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
>(
  request: AIStreamTextRequest<Tools, RuntimeContext, Output>,
  context: AITextOperationContext,
): AIStreamResult<Tools, RuntimeContext, Output> {
  const { resolved } = context;
  assertLanguageRequestCapabilities(resolved.provider, request);
  const telemetry = startAIRequestTelemetry(resolved, 'streaming', request.metadata);
  const lifecycle = composeAIGenerationLifecycleCallbacks(request, context.emitCode);
  const streamErrorCallback = composeAIStreamErrorCallback(request.onError);
  let lastStreamError: unknown;

  try {
    const sdkRequest = {
      model: resolved.model,
      ...promptInput(request, resolved.provider.id),
      maxRetries: request.maxRetries,
      streamRetries: request.streamRetries,
      timeout: snapshotAITimeout(request.timeout),
      headers: snapshotAIHeaders(request.headers),
      temperature: request.temperature,
      topP: request.topP,
      topK: request.topK,
      presencePenalty: request.presencePenalty,
      frequencyPenalty: request.frequencyPenalty,
      seed: request.seed,
      reasoning: request.reasoning,
      maxOutputTokens: request.maxOutputTokens,
      stopSequences: snapshotAIStringList(request.stopSequences, 'stopSequences'),
      abortSignal: request.abortSignal,
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      output: request.output,
      stopWhen: normalizeStopConditions(request.stopWhen),
      runtimeContext: request.runtimeContext,
      toolsContext: request.toolsContext,
      activeTools: snapshotAIStringList(request.activeTools, 'activeTools'),
      toolOrder: snapshotAIStringList(request.toolOrder, 'toolOrder'),
      prepareStep: request.prepareStep,
      toolApproval: request.toolApproval,
      experimental_toolApprovalSecret: snapshotAIToolApprovalSecret(request.toolApprovalSecret),
      telemetry: request.telemetry,
      include: request.include,
      experimental_download: createAIPromptDownload({
        abortSignal: request.abortSignal,
        timeout: request.timeout,
      }),
      onChunk: request.onChunk,
      onStart: request.onStart,
      onStepStart: lifecycle.onStepStart,
      onLanguageModelCallStart: lifecycle.onLanguageModelCallStart,
      onLanguageModelCallEnd: lifecycle.onLanguageModelCallEnd,
      onToolExecutionStart: lifecycle.onToolExecutionStart,
      onToolExecutionEnd: lifecycle.onToolExecutionEnd,
      onStepEnd: lifecycle.onStepEnd,
      ...(request.tools ? { tools: request.tools } : {}),
      ...(request.toolChoice ? { toolChoice: request.toolChoice } : {}),
      onEnd: async (event) => {
        try {
          await request.onEnd?.(event);
          telemetry.complete({
            usage: event.usage,
            toolNames: Object.keys(request.tools ?? {}),
          });
        } catch (error) {
          telemetry.fail(normalizeAIRequestError(error, request.abortSignal));
          throw error;
        }
      },
      onError: async (event) => {
        lastStreamError = event.error;
        return streamErrorCallback?.(event);
      },
      onAbort: async (event) => {
        try {
          await request.onAbort?.(event);
        } finally {
          telemetry.fail(aiRequestAbortError(request.abortSignal));
        }
      },
    } as Parameters<typeof streamText<Tools, RuntimeContext, Output>>[0];
    const result = streamText<Tools, RuntimeContext, Output>(sdkRequest);
    void Promise.resolve(result.finishReason)
      .then((reason) => {
        if (reason === 'error') {
          telemetry.fail(normalizeAIRequestError(
            lastStreamError ?? new Error('AI provider stream ended with an error.'),
            request.abortSignal,
          ));
        }
      })
      .catch((error: unknown) => {
        telemetry.fail(normalizeAIRequestError(error, request.abortSignal));
      });
    return result;
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

function aiRequestAbortError(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('AI streaming request aborted.');
  error.name = 'AbortError';
  return error;
}

function normalizeStopConditions<Tools extends ToolSet, RuntimeContext extends Context>(
  stopWhen: AIGenerateTextRequest<Tools, RuntimeContext>['stopWhen'],
) {
  return Array.isArray(stopWhen) ? [...stopWhen] : stopWhen;
}

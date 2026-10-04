/**
 * ai-generation-lifecycle-observability.ts
 *
 * Composes SDK 7 generation callbacks with Zero lifecycle observability.
 * The adapter is request-scoped and framework-neutral; it does not register
 * global SDK telemetry or inspect any content-bearing event fields.
 */

import type {
  Context,
  ToolSet,
} from '@ai-sdk/provider-utils';

import type { AIAnyOutput, AIOutputSpec } from './ai-output';
import type { AIEmitCode } from './ai-observability';
import type { AIGenerationOptions, AIStreamErrorCallback } from './ai-types';
import {
  emitAIModelCallEnded,
  emitAIModelCallStarted,
  emitAIStepEnded,
  emitAIStepStarted,
  emitAIToolExecutionEnded,
  emitAIToolExecutionStarted,
} from './ai-generation-lifecycle-events';

type LifecycleCallbackKey =
  | 'onStepStart'
  | 'onLanguageModelCallStart'
  | 'onLanguageModelCallEnd'
  | 'onToolExecutionStart'
  | 'onToolExecutionEnd'
  | 'onStepEnd';

/** SDK callback subset wrapped by Zero's request-scoped lifecycle adapter. */
export type AIGenerationLifecycleCallbacks<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
> = Pick<AIGenerationOptions<Tools, RuntimeContext, Output>, LifecycleCallbackKey>;

/**
 * Compose caller lifecycle callbacks with content-free Zero observability.
 *
 * Caller callbacks receive the original SDK event, are awaited exactly once,
 * and retain their thrown/rejected error behavior. The returned callbacks are
 * scoped to one generation request so step correlation cannot cross requests.
 */
export function composeAIGenerationLifecycleCallbacks<
  Tools extends ToolSet = ToolSet,
  RuntimeContext extends Context = Context,
  Output extends AIOutputSpec = AIAnyOutput,
>(
  callbacks: AIGenerationLifecycleCallbacks<Tools, RuntimeContext, Output>,
  emitCode?: AIEmitCode,
):
  Required<AIGenerationLifecycleCallbacks<Tools, RuntimeContext, Output>> {
  const steps = new Map<string, number>();

  return {
    async onStepStart(event) {
      steps.set(event.callId, event.stepNumber);
      emitAIStepStarted({ callId: event.callId, stepNumber: event.stepNumber }, emitCode);
      await callbacks.onStepStart?.(event);
    },
    async onLanguageModelCallStart(event) {
      emitAIModelCallStarted({
        callId: event.callId,
        stepNumber: steps.get(event.callId),
      }, emitCode);
      await callbacks.onLanguageModelCallStart?.(event);
    },
    async onLanguageModelCallEnd(event) {
      emitAIModelCallEnded({
        callId: event.callId,
        stepNumber: steps.get(event.callId),
        failed: event.finishReason === 'error',
        durationMs: event.performance.responseTimeMs,
        usage: event.usage,
      }, emitCode);
      await callbacks.onLanguageModelCallEnd?.(event);
    },
    async onToolExecutionStart(event) {
      emitAIToolExecutionStarted({
        callId: event.callId,
        stepNumber: steps.get(event.callId),
        toolCallId: event.toolCall.toolCallId,
        toolName: event.toolCall.toolName,
      }, emitCode);
      await callbacks.onToolExecutionStart?.(event);
    },
    async onToolExecutionEnd(event) {
      emitAIToolExecutionEnded({
        callId: event.callId,
        stepNumber: steps.get(event.callId),
        toolCallId: event.toolCall.toolCallId,
        toolName: event.toolCall.toolName,
        failed: event.toolOutput.type === 'tool-error',
        durationMs: event.toolExecutionMs,
      }, emitCode);
      await callbacks.onToolExecutionEnd?.(event);
    },
    async onStepEnd(event) {
      emitAIStepEnded({
        callId: event.callId,
        stepNumber: event.stepNumber,
        failed: event.finishReason === 'error',
        durationMs: event.performance.stepTimeMs,
        usage: event.usage,
      }, emitCode);
      steps.delete(event.callId);
      await callbacks.onStepEnd?.(event);
    },
  };
}

/**
 * Preserve an SDK stream error observer exactly, including `{ retry: true }`.
 *
 * Stream error callbacks can describe recoverable provider interruptions, so
 * this adapter deliberately emits no terminal failure event.
 */
export function composeAIStreamErrorCallback(
  callback: AIStreamErrorCallback | undefined,
): AIStreamErrorCallback | undefined {
  if (!callback) return undefined;
  return event => callback(event);
}

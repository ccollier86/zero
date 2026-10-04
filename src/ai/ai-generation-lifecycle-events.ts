/**
 * ai-generation-lifecycle-events.ts
 *
 * Emits content-free SDK 7 generation lifecycle events through Zero's
 * observability sink. This file owns safe event shaping only; it never
 * receives or records prompts, tool payloads, provider options, or context.
 */

import type { LanguageModelUsage } from 'ai';

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { PlatformCodeDefinition } from '../observability/types';
import { emitAICodeSafely, type AIEmitCode } from './ai-observability';

/** Correlation fields shared by one logical generation call and its steps. */
export interface AIGenerationCorrelation {
  callId: string;
  stepNumber?: number;
}

/** Correlation fields for one tool execution. */
export interface AIToolExecutionCorrelation extends AIGenerationCorrelation {
  toolCallId: string;
  toolName: string;
}

/** Emit one SDK generation step start event. */
export function emitAIStepStarted(
  correlation: AIGenerationCorrelation,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitLifecycle(OBS_CODES.AI_STEP_STARTED, correlation, emitCode);
}

/** Emit one SDK generation step terminal event using its finish classification. */
export function emitAIStepEnded(input: AIGenerationCorrelation & {
  failed: boolean;
  durationMs?: number;
  usage?: LanguageModelUsage;
}, emitCode: AIEmitCode = emitPlatformCode): void {
  emitLifecycle(input.failed ? OBS_CODES.AI_STEP_FAILED : OBS_CODES.AI_STEP_COMPLETED, input, emitCode);
}

/** Emit one logical SDK model call start event. Provider retries stay inside it. */
export function emitAIModelCallStarted(
  correlation: AIGenerationCorrelation,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitLifecycle(OBS_CODES.AI_MODEL_CALL_STARTED, correlation, emitCode);
}

/** Emit one logical SDK model call terminal event with content-free usage data. */
export function emitAIModelCallEnded(input: AIGenerationCorrelation & {
  failed: boolean;
  durationMs?: number;
  usage?: LanguageModelUsage;
}, emitCode: AIEmitCode = emitPlatformCode): void {
  emitLifecycle(
    input.failed ? OBS_CODES.AI_MODEL_CALL_FAILED : OBS_CODES.AI_MODEL_CALL_COMPLETED,
    input,
    emitCode,
  );
}

/** Emit one tool execution start event without arguments or tool context. */
export function emitAIToolExecutionStarted(
  correlation: AIToolExecutionCorrelation,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitLifecycle(OBS_CODES.AI_TOOL_STARTED, correlation, emitCode);
}

/** Emit one tool execution terminal event without its input, output, or raw error. */
export function emitAIToolExecutionEnded(input: AIToolExecutionCorrelation & {
  failed: boolean;
  durationMs?: number;
}, emitCode: AIEmitCode = emitPlatformCode): void {
  emitLifecycle(input.failed ? OBS_CODES.AI_TOOL_FAILED : OBS_CODES.AI_TOOL_COMPLETED, input, emitCode);
}

function emitLifecycle(
  code: PlatformCodeDefinition,
  input: AIGenerationCorrelation & Partial<AIToolExecutionCorrelation> & {
    failed?: boolean;
    durationMs?: number;
    usage?: LanguageModelUsage;
  },
  emitCode: AIEmitCode,
): void {
  const metadata = compactMetadata({
    callId: boundedIdentifier(input.callId),
    stepNumber: safeCount(input.stepNumber),
    toolCallId: boundedIdentifier(input.toolCallId),
    toolName: boundedIdentifier(input.toolName),
    durationMs: safeDuration(input.durationMs),
    ...safeUsage(input.usage),
  });

  emitAICodeSafely(emitCode, code, {
    metadata,
    ...(input.failed ? { error: new Error(code.message) } : {}),
  });
}

function safeUsage(usage: LanguageModelUsage | undefined): Record<string, number | undefined> {
  return {
    inputTokens: safeCount(usage?.inputTokens),
    outputTokens: safeCount(usage?.outputTokens),
    totalTokens: safeCount(usage?.totalTokens),
    cacheReadTokens: safeCount(usage?.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: safeCount(usage?.inputTokenDetails?.cacheWriteTokens),
    reasoningTokens: safeCount(usage?.outputTokenDetails?.reasoningTokens),
  };
}

function boundedIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length <= 256 ? value : `${value.slice(0, 245)}[truncated]`;
}

function safeCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function safeDuration(value: number | undefined): number | undefined {
  return safeCount(value);
}

function compactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

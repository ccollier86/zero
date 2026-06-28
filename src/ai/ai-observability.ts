/**
 * ai-observability.ts
 *
 * Small helpers for emitting AI lifecycle events through Zero observability.
 * This file owns event metadata shaping only; it does not execute provider
 * calls, inspect prompts, or persist telemetry.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { AIProviderType } from './ai-types';

/** Metadata allowed on AI observability events; prompts and secrets stay out. */
export interface AIEventMetadata {
  providerId?: string;
  providerType?: AIProviderType;
  model?: string;
  requestedModel?: string;
  capability?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  toolNames?: readonly string[];
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

/** Emit provider startup status without including secrets. */
export function emitAIProviderStatus(input: {
  providerId: string;
  providerType: AIProviderType;
  active: boolean;
  reason?: string | null;
}): void {
  emitPlatformCode(input.active ? OBS_CODES.AI_PROVIDER_ENABLED : OBS_CODES.AI_PROVIDER_SKIPPED, {
    metadata: {
      providerId: input.providerId,
      providerType: input.providerType,
      reason: input.reason,
    },
  });
}

/** Emit that an AI provider request is about to start. */
export function emitAIRequestStarted(metadata: AIEventMetadata): void {
  emitPlatformCode(OBS_CODES.AI_REQUEST_STARTED, {
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit successful AI provider completion with duration and token metadata. */
export function emitAIRequestCompleted(metadata: AIEventMetadata): void {
  emitPlatformCode(OBS_CODES.AI_REQUEST_COMPLETED, {
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit a failed AI provider request without recording prompt content. */
export function emitAIRequestFailed(error: unknown, metadata: AIEventMetadata): void {
  emitPlatformCode(OBS_CODES.AI_REQUEST_FAILED, {
    error,
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit a model or alias resolution failure before a provider request starts. */
export function emitAIModelAliasUnresolved(metadata: AIEventMetadata): void {
  emitPlatformCode(OBS_CODES.AI_MODEL_ALIAS_UNRESOLVED, {
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit a server-side tool execution failure. */
export function emitAIToolFailed(error: unknown, metadata: AIEventMetadata): void {
  emitPlatformCode(OBS_CODES.AI_TOOL_FAILED, {
    error,
    metadata: safeAIMetadata(metadata),
  });
}

function safeAIMetadata(metadata: AIEventMetadata): Record<string, unknown> {
  return {
    providerId: metadata.providerId,
    providerType: metadata.providerType,
    model: metadata.model,
    requestedModel: metadata.requestedModel,
    capability: metadata.capability,
    durationMs: metadata.durationMs,
    inputTokens: metadata.inputTokens,
    outputTokens: metadata.outputTokens,
    totalTokens: metadata.totalTokens,
    toolNames: metadata.toolNames,
    reason: metadata.reason,
    ...metadata.metadata,
  };
}

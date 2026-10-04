/** Bounded AI request lifecycle telemetry shared by every service modality. */

import {
  emitAIRequestCompleted,
  emitAIRequestFailed,
  emitAIRequestStarted,
} from './ai-observability';
import type { ResolvedAIModel } from './ai-registry';
import type { AICapability } from './ai-types';

interface AIUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface AIRequestCompletion {
  usage?: AIUsageLike;
  totalTokens?: number;
  toolNames?: readonly string[];
}

/** One request-scoped emitter that keeps lifecycle fields consistent. */
export interface AIRequestTelemetry {
  complete(details?: AIRequestCompletion): void;
  fail(error: unknown): void;
}

/** Emit a start event and return completion/failure closures for that request. */
export function startAIRequestTelemetry(
  resolved: ResolvedAIModel<unknown>,
  capability: AICapability,
  metadata: Record<string, unknown> | undefined
): AIRequestTelemetry {
  const startedAt = Date.now();
  let settled = false;
  const base = {
    providerId: resolved.provider.id,
    providerType: resolved.provider.type,
    requestedModel: resolved.reference.requested,
    model: resolved.reference.resolved,
    capability,
    metadata,
  };

  emitAIRequestStarted(base, resolved.emitCode);

  return {
    complete(details = {}) {
      if (settled) return;
      settled = true;
      emitAIRequestCompleted({
        ...base,
        durationMs: Date.now() - startedAt,
        inputTokens: details.usage?.inputTokens,
        outputTokens: details.usage?.outputTokens,
        totalTokens: details.totalTokens ?? details.usage?.totalTokens,
        toolNames: details.toolNames,
      }, resolved.emitCode);
    },
    fail(error) {
      if (settled) return;
      settled = true;
      emitAIRequestFailed(error, {
        ...base,
        durationMs: Date.now() - startedAt,
      }, resolved.emitCode);
    },
  };
}

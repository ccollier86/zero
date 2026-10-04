/** Secret-safe request telemetry for provider-hosted file operations. */

import type { ResolvedAIFilesProvider } from './ai-registry';
import type { AIRequestTelemetry } from './ai-request-telemetry';
import {
  emitAIRequestCompleted,
  emitAIRequestFailed,
  emitAIRequestStarted,
} from './ai-observability';

export type AIHostedFileOperation = 'upload' | 'metadata' | 'download' | 'delete';

/** Start one files request without recording file names, references, or content. */
export function startAIHostedFileTelemetry(
  resolved: ResolvedAIFilesProvider,
  operation: AIHostedFileOperation,
  metadata?: Record<string, unknown>
): AIRequestTelemetry {
  const startedAt = Date.now();
  let settled = false;
  const base = {
    providerId: resolved.provider.id,
    providerType: resolved.provider.type,
    capability: `files.${operation}`,
    metadata,
  };
  emitAIRequestStarted(base, resolved.emitCode);

  return {
    complete() {
      if (settled) return;
      settled = true;
      emitAIRequestCompleted({ ...base, durationMs: Date.now() - startedAt }, resolved.emitCode);
    },
    fail(error) {
      if (settled) return;
      settled = true;
      emitAIRequestFailed(
        error,
        { ...base, durationMs: Date.now() - startedAt },
        resolved.emitCode,
      );
    },
  };
}

/**
 * ai-prompt-download.ts
 *
 * Adapts Zero's single-asset Bun transport to the AI SDK prompt downloader.
 * This file owns provider pass-through and the aggregate per-request budget.
 */

import {
  getStepTimeoutMs,
  getTotalTimeoutMs,
  type Experimental_DownloadFunction,
  type TimeoutConfiguration,
  type ToolSet,
} from 'ai';

import { AIError } from './ai-errors';
import {
  createAISafeDownloadScope,
  downloadAISafeAsset,
  type AISafeDownloadFetch,
  type AISafeDownloadResolvedAddress,
} from './ai-safe-download';

/** Default aggregate ceiling for remote assets materialized into one prompt. */
export const AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES = 64 * 1024 * 1024;

export interface AIPromptDownloadOptions {
  readonly abortSignal?: AbortSignal;
  readonly maxBytes?: number;
  readonly timeout?: TimeoutConfiguration<ToolSet>;
  /** Test seam. Production callers use Bun's DNS resolver. */
  readonly lookup?: (
    hostname: string,
    port: number,
  ) => Promise<readonly AISafeDownloadResolvedAddress[]>;
  /** Test seam. Production callers use Bun's fetch implementation. */
  readonly fetch?: AISafeDownloadFetch;
}

/** Create the download hook used by both one-shot and streamed generation. */
export function createAIPromptDownload(
  options: AIPromptDownloadOptions = {},
): Experimental_DownloadFunction {
  const maxBytes = validByteLimit(options.maxBytes);
  const startedAt = performance.now();
  const totalMs = validatedTimeout(getTotalTimeoutMs(options.timeout));
  const stepMs = validatedTimeout(getStepTimeoutMs(options.timeout));
  const lookup = options.lookup ?? lookupWithBun;
  const fetch = options.fetch ?? (globalThis.fetch as AISafeDownloadFetch);

  return async (requests) => {
    const timeoutMs = effectiveTimeout(totalMs, stepMs, startedAt);
    const scope = createAISafeDownloadScope([options.abortSignal], timeoutMs);
    try {
      const results: Awaited<ReturnType<Experimental_DownloadFunction>> = [];
      let remainingBytes = maxBytes;
      // Resolve sequentially so several attacker-controlled assets cannot each
      // allocate the full request budget before an aggregate check observes it.
      for (const request of requests) {
        if (request.isUrlSupportedByModel) {
          results.push(null);
          continue;
        }
        if (remainingBytes <= 0) {
          throw new AIError(
            'Remote AI inputs exceed the aggregate byte limit.',
            'AI_REQUEST_LIMIT_EXCEEDED',
            413,
          );
        }
        const result = await downloadAISafeAsset(request.url, {
          abortSignal: scope.signal,
          fetch,
          lookup,
          maxBytes: remainingBytes,
        });
        remainingBytes -= result.data.byteLength;
        results.push(result);
      }
      return results;
    } finally {
      scope.dispose();
    }
  };
}

async function lookupWithBun(
  hostname: string,
  port: number,
): Promise<readonly AISafeDownloadResolvedAddress[]> {
  return Bun.dns.lookup(hostname, { family: 0, port });
}

function validByteLimit(value: number | undefined): number {
  const limit = value ?? AI_DEFAULT_PROMPT_DOWNLOAD_MAX_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new AIError(
      'AI prompt download byte limit must be a positive safe integer.',
      'AI_PROVIDER_CONFIG_INVALID',
      500,
    );
  }
  return limit;
}

function validatedTimeout(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new AIError('AI request timeout must be greater than zero.', 'AI_REQUEST_INVALID', 400);
  }
  return value;
}

function effectiveTimeout(
  totalMs: number | undefined,
  stepMs: number | undefined,
  startedAt: number,
): number | undefined {
  const remainingTotal = totalMs === undefined
    ? undefined
    : Math.max(0, totalMs - (performance.now() - startedAt));
  if (remainingTotal === undefined) return stepMs;
  if (stepMs === undefined) return remainingTotal;
  return Math.min(remainingTotal, stepMs);
}

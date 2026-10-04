/**
 * ai-video-service.ts
 *
 * Orchestrates Zero's preview SDK 7 video generate/start/status operations.
 * This service owns model pinning, request bounds, and secret-safe lifecycle
 * telemetry; it does not register routes, persist jobs, or authorize callers.
 */

import {
  experimental_generateVideo,
  experimental_getVideoStatus,
  experimental_startVideo,
} from 'ai';

import { AIError } from './ai-errors';
import {
  resolveVideoModel,
  type AIRegistry,
  type ResolvedAIModel,
} from './ai-registry';
import { startAIRequestTelemetry } from './ai-request-telemetry';
import { normalizeAIRequestError } from './ai-service-support';
import { createAISafeDownload } from './ai-safe-download';
import { snapshotAIHeaders } from './ai-request-snapshot';
import {
  validateAIGenerateVideoResult,
  validateAIStartVideoResult,
  validateAIVideoStatusResult,
} from './ai-video-response';
import type {
  AIGenerateVideoRequest,
  AIGenerateVideoResult,
  AIGetVideoStatusRequest,
  AIStartVideoRequest,
  AIStartVideoResult,
  AIVideoStatusResult,
} from './ai-video-types';
import { validateAIVideoOperationEnvelope } from './ai-video-operation-envelope';
import {
  validateAIVideoDownloadLimit,
  validateAIVideoPollOptions,
  validateAIVideoRequestOptions,
  validateAIVideoWebhookFactory,
  validateAIVideoWebhookURL,
} from './ai-video-validation';

/** Registry and alias state needed by the isolated preview-video service. */
export interface AIVideoServiceContext {
  registry: AIRegistry;
  aliases: Record<string, string>;
  /** Defaults to true only outside production in the Bun runtime. */
  allowInsecureLocalhostWebhooks?: boolean;
}

/** Preview video operations exposed for AIService composition. */
export interface AIVideoService {
  generate(request: AIGenerateVideoRequest): Promise<AIGenerateVideoResult>;
  start(request: AIStartVideoRequest): Promise<AIStartVideoResult>;
  status(request: AIGetVideoStatusRequest): Promise<AIVideoStatusResult>;
}

/** Create a small preview-video facade bound to one AI registry. */
export function createAIVideoService(context: AIVideoServiceContext): AIVideoService {
  return {
    generate: (request) => executeAIGenerateVideo(request, context),
    start: (request) => executeAIStartVideo(request, context),
    status: (request) => executeAIGetVideoStatus(request, context),
  };
}

/** Generate and materialize bounded video outputs. */
export async function executeAIGenerateVideo(
  request: AIGenerateVideoRequest,
  context: AIVideoServiceContext
): Promise<AIGenerateVideoResult> {
  const validated = validateAIVideoRequestOptions(request);
  const maxBytes = validateAIVideoDownloadLimit(request.downloadMaxBytes);
  const poll = validateAIVideoPollOptions(request.poll);
  const webhook = validateAIVideoWebhookFactory(
    request.webhook,
    allowInsecureLocalhost(context)
  );
  const resolved = resolveVideoModel(context.registry, context.aliases, request.model);
  assertGenerateSupport(resolved);
  const telemetry = startAIRequestTelemetry(resolved, 'video', request.metadata);

  try {
    const result = await experimental_generateVideo({
      model: resolved.model,
      prompt: validated.prompt,
      n: validated.n,
      maxVideosPerCall: validated.maxVideosPerCall,
      aspectRatio: validated.aspectRatio,
      resolution: validated.resolution,
      duration: validated.duration,
      fps: validated.fps,
      seed: validated.seed,
      frameImages: validated.frameImages,
      inputReferences: validated.inputReferences,
      generateAudio: validated.generateAudio,
      providerOptions: validated.providerOptions,
      maxRetries: validated.maxRetries,
      abortSignal: validated.abortSignal,
      headers: validated.headers,
      download: boundedVideoDownload(maxBytes),
      poll,
      webhook,
    });
    const output = validateAIGenerateVideoResult(result, maxBytes);
    telemetry.complete();
    return output;
  } catch (error) {
    const normalized = normalizeVideoError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

/** Start an asynchronous video operation pinned to its exact resolved model. */
export async function executeAIStartVideo(
  request: AIStartVideoRequest,
  context: AIVideoServiceContext
): Promise<AIStartVideoResult> {
  const validated = validateAIVideoRequestOptions(request);
  const webhookUrl = request.webhookUrl === undefined
    ? undefined
    : validateAIVideoWebhookURL(request.webhookUrl, allowInsecureLocalhost(context));
  const resolved = resolveVideoModel(context.registry, context.aliases, request.model);
  assertStartStatusSupport(resolved);
  const telemetry = startAIRequestTelemetry(resolved, 'video', request.metadata);

  try {
    const result = await experimental_startVideo({
      model: resolved.model,
      prompt: validated.prompt,
      n: validated.n,
      maxVideosPerCall: validated.maxVideosPerCall,
      aspectRatio: validated.aspectRatio,
      resolution: validated.resolution,
      duration: validated.duration,
      fps: validated.fps,
      seed: validated.seed,
      frameImages: validated.frameImages,
      inputReferences: validated.inputReferences,
      generateAudio: validated.generateAudio,
      providerOptions: validated.providerOptions,
      maxRetries: validated.maxRetries,
      abortSignal: validated.abortSignal,
      headers: validated.headers,
      webhookUrl,
    });
    const output = validateAIStartVideoResult(resolved.reference.resolved, result);
    telemetry.complete();
    return output;
  } catch (error) {
    const normalized = normalizeVideoError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

/** Check one asynchronous operation without consulting mutable model aliases. */
export async function executeAIGetVideoStatus(
  request: AIGetVideoStatusRequest,
  context: AIVideoServiceContext
): Promise<AIVideoStatusResult> {
  const operation = validateAIVideoOperationEnvelope(request.operation);
  const inlineMaxBytes = validateAIVideoDownloadLimit(
    request.inlineVideoMaxBytes,
    'inlineVideoMaxBytes'
  );
  const resolved = resolveVideoModel(
    context.registry,
    {},
    operation.resolvedModel,
    operation.resolvedModel
  );
  assertStartStatusSupport(resolved);
  const telemetry = startAIRequestTelemetry(resolved, 'video', request.metadata);

  try {
    const result = await experimental_getVideoStatus(resolved.model, {
      operation: operation.operation,
      headers: snapshotAIHeaders(request.headers),
      abortSignal: request.abortSignal,
      maxRetries: validateRetries(request.maxRetries),
    });
    const output = validateAIVideoStatusResult(result, inlineMaxBytes);
    telemetry.complete();
    return output;
  } catch (error) {
    const normalized = normalizeVideoError(error, request.abortSignal);
    telemetry.fail(normalized);
    throw normalized;
  }
}

function assertGenerateSupport(resolved: ResolvedAIModel<unknown>): void {
  const model = resolved.model as Record<string, unknown>;
  if (typeof model.doGenerate === 'function'
    || (typeof model.doStart === 'function' && typeof model.doStatus === 'function')) return;
  throw unsupported(resolved, 'generation');
}

function assertStartStatusSupport(resolved: ResolvedAIModel<unknown>): void {
  const model = resolved.model as Record<string, unknown>;
  if (typeof model.doStart === 'function' && typeof model.doStatus === 'function') return;
  throw unsupported(resolved, 'asynchronous start/status');
}

function unsupported(resolved: ResolvedAIModel<unknown>, operation: string): AIError {
  return new AIError(
    `AI video model "${resolved.reference.resolved}" does not support ${operation}.`,
    'AI_CAPABILITY_NOT_SUPPORTED',
    400
  );
}

function boundedVideoDownload(maxBytes: number) {
  return createAISafeDownload({ maxBytes });
}

function normalizeVideoError(error: unknown, abortSignal?: AbortSignal): AIError {
  if (error instanceof AIError) return error;
  return normalizeAIRequestError(error, abortSignal);
}

function validateRetries(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 10) {
    throw new AIError('maxRetries must be an integer between 0 and 10.', 'AI_REQUEST_INVALID', 400);
  }
  return value as number;
}

function allowInsecureLocalhost(context: AIVideoServiceContext): boolean {
  return context.allowInsecureLocalhostWebhooks
    ?? Bun.env.NODE_ENV !== 'production';
}

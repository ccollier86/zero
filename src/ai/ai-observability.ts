/**
 * ai-observability.ts
 *
 * Small helpers for emitting AI lifecycle events through Zero observability.
 * This file owns event metadata shaping only; it does not execute provider
 * calls, inspect prompts, or persist telemetry.
 */

import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import type { PlatformCodeDefinition, PlatformCodeEmitOptions } from '../observability/types';
import { AIError } from './ai-errors';
import type { AIProviderType } from './ai-types';

/** App-bound platform-code emitter; standalone services fall back to the global sink. */
export type AIEmitCode = (
  definition: PlatformCodeDefinition,
  options?: PlatformCodeEmitOptions,
) => unknown;

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
}, emitCode: AIEmitCode = emitPlatformCode): void {
  emitAICodeSafely(emitCode, input.active
    ? OBS_CODES.AI_PROVIDER_ENABLED
    : OBS_CODES.AI_PROVIDER_SKIPPED, {
    metadata: {
      providerId: input.providerId,
      providerType: input.providerType,
      reason: input.reason,
    },
  });
}

/** Emit a secret-safe provider construction failure. */
export function emitAIProviderInitializationFailed(input: {
  providerId: string;
  providerType: AIProviderType;
  error: unknown;
}, emitCode: AIEmitCode = emitPlatformCode): void {
  emitAICodeSafely(emitCode, OBS_CODES.AI_PROVIDER_FAILED, {
    error: new Error('AI provider initialization failed.'),
    metadata: {
      providerId: input.providerId,
      providerType: input.providerType,
      reason: classifyProviderInitializationError(input.error),
    },
  });
}

/** Emit that an AI provider request is about to start. */
export function emitAIRequestStarted(
  metadata: AIEventMetadata,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitAICodeSafely(emitCode, OBS_CODES.AI_REQUEST_STARTED, {
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit successful AI provider completion with duration and token metadata. */
export function emitAIRequestCompleted(
  metadata: AIEventMetadata,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitAICodeSafely(emitCode, OBS_CODES.AI_REQUEST_COMPLETED, {
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit a failed AI provider request without recording prompt content. */
export function emitAIRequestFailed(
  error: unknown,
  metadata: AIEventMetadata,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitAICodeSafely(emitCode, OBS_CODES.AI_REQUEST_FAILED, {
    error: createPublicAIError(error, 'AI request failed.'),
    metadata: safeAIMetadata({
      ...metadata,
      reason: metadata.reason ?? classifyAIFailure(error),
    }),
  });
}

/** Emit a model or alias resolution failure before a provider request starts. */
export function emitAIModelAliasUnresolved(
  metadata: AIEventMetadata,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitAICodeSafely(emitCode, OBS_CODES.AI_MODEL_ALIAS_UNRESOLVED, {
    metadata: safeAIMetadata(metadata),
  });
}

/** Emit a server-side tool execution failure. */
export function emitAIToolFailed(
  error: unknown,
  metadata: AIEventMetadata,
  emitCode: AIEmitCode = emitPlatformCode,
): void {
  emitAICodeSafely(emitCode, OBS_CODES.AI_TOOL_FAILED, {
    error: createPublicAIError(error, 'AI tool execution failed.'),
    metadata: safeAIMetadata({
      ...metadata,
      reason: metadata.reason ?? classifyAIFailure(error),
    }),
  });
}

/** Emit one AI platform code without allowing a sink failure to alter AI work. */
export function emitAICodeSafely(
  emitCode: AIEmitCode,
  definition: PlatformCodeDefinition,
  options: PlatformCodeEmitOptions,
): void {
  try {
    const pending = emitCode(definition, options);
    if (pending && typeof (pending as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(pending).catch(() => undefined);
    }
  } catch {
    // AI observability is best-effort and cannot alter provider/tool behavior.
  }
}

function safeAIMetadata(metadata: AIEventMetadata): Record<string, unknown> {
  try {
    const clean = sanitizeCallerMetadata(metadata.metadata);
    const canonical: Record<string, unknown> = {
      providerId: sanitizeCanonicalString(metadata.providerId),
      providerType: sanitizeCanonicalString(metadata.providerType),
      model: sanitizeCanonicalString(metadata.model),
      requestedModel: sanitizeCanonicalString(metadata.requestedModel),
      capability: sanitizeCanonicalString(metadata.capability),
      durationMs: sanitizeCanonicalNumber(metadata.durationMs),
      inputTokens: sanitizeCanonicalNumber(metadata.inputTokens),
      outputTokens: sanitizeCanonicalNumber(metadata.outputTokens),
      totalTokens: sanitizeCanonicalNumber(metadata.totalTokens),
      toolNames: sanitizeCanonicalStrings(metadata.toolNames),
      reason: metadata.reason === null
        ? null
        : sanitizeCanonicalString(metadata.reason),
    };
    for (const [key, value] of Object.entries(canonical)) {
      delete clean[key];
      if (value !== undefined) clean[key] = value;
    }
    return clean;
  } catch {
    return { _sanitizationFailed: true };
  }
}

const REDACTED = '[redacted]';
const TRUNCATED = '[truncated]';
const UNSUPPORTED = '[unsupported]';
const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_ENTRIES = 50;
const MAX_METADATA_ARRAY_LENGTH = 20;
const MAX_METADATA_STRING_LENGTH = 512;

function sanitizeCanonicalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (containsSensitiveCanonicalValue(value)) return REDACTED;
  return value.length <= MAX_METADATA_STRING_LENGTH
    ? value
    : `${value.slice(0, MAX_METADATA_STRING_LENGTH)}${TRUNCATED}`;
}

function sanitizeCanonicalStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const clean = value
    .slice(0, MAX_METADATA_ARRAY_LENGTH)
    .map((item) => sanitizeCanonicalString(item) ?? UNSUPPORTED);
  if (value.length > MAX_METADATA_ARRAY_LENGTH) clean.push(TRUNCATED);
  return clean;
}

function sanitizeCanonicalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function containsSensitiveCanonicalValue(value: string): boolean {
  return /(?:^|[^a-z0-9])(?:api[-_]?key|secret|password|authorization|credential|bearer|cookie|access[-_]?token|refresh[-_]?token)(?:[^a-z0-9]|$)/i.test(value)
    || /(?:^|[^A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?:[^A-Za-z0-9]|$)/.test(value)
    || /(?:^|[^A-Za-z0-9_-])(?:sk-(?:ant-|proj-)?|xai-|hf_|AIza)[A-Za-z0-9_-]{12,}(?:[^A-Za-z0-9_-]|$)/.test(value)
    || /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:[^A-Za-z0-9_-]|$)/.test(value)
    || value.includes('-----BEGIN PRIVATE KEY-----');
}

/**
 * Keep caller correlation metadata useful without allowing prompt, media,
 * tool payload, credential, or unbounded object data into platform events.
 */
function sanitizeCallerMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const seen = new WeakSet<object>();
    return sanitizeMetadataRecord(metadata, 0, seen);
  } catch {
    return { _sanitizationFailed: true };
  }
}

function sanitizeMetadataRecord(
  value: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>
): Record<string, unknown> {
  if (seen.has(value)) return { value: '[circular]' };
  seen.add(value);

  const clean: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (const [key, item] of entries.slice(0, MAX_METADATA_ENTRIES)) {
    clean[key] = isPrivateAIContentKey(key)
      ? REDACTED
      : sanitizeMetadataValue(item, depth + 1, seen);
  }
  if (entries.length > MAX_METADATA_ENTRIES) clean._truncated = true;
  return clean;
}

function sanitizeMetadataValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'string') {
    return value.length <= MAX_METADATA_STRING_LENGTH
      ? value
      : `${value.slice(0, MAX_METADATA_STRING_LENGTH)}${TRUNCATED}`;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return undefined;
  if (typeof value !== 'object') return UNSUPPORTED;
  if (depth > MAX_METADATA_DEPTH) return TRUNCATED;
  if (seen.has(value)) return '[circular]';

  if (Array.isArray(value)) {
    seen.add(value);
    const clean = value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) => sanitizeMetadataValue(item, depth + 1, seen));
    if (value.length > MAX_METADATA_ARRAY_LENGTH) clean.push(TRUNCATED);
    return clean;
  }

  return sanitizeMetadataRecord(value as Record<string, unknown>, depth, seen);
}

function isPrivateAIContentKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /(?:token|secret|password|authorization|cookie|credential|apikey|authkey)/.test(normalized)
    || /(?:prompt|message|content|file|audio|image|toolargs|toolargument|input|output|result|payload|body)/.test(normalized);
}

function classifyProviderInitializationError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown_error';
  switch (error.name) {
    case 'Error':
    case 'TypeError':
    case 'RangeError':
    case 'ReferenceError':
    case 'SyntaxError':
    case 'URIError':
    case 'AggregateError':
      return error.name;
    default:
      return 'provider_error';
  }
}

function classifyAIFailure(error: unknown): string {
  if (error instanceof AIError) return error.code;
  if (!(error instanceof Error)) return 'unknown_error';
  switch (error.name) {
    case 'AbortError':
    case 'TimeoutError':
    case 'Error':
    case 'TypeError':
    case 'RangeError':
    case 'ReferenceError':
    case 'SyntaxError':
    case 'URIError':
    case 'AggregateError':
      return error.name;
    default:
      return 'provider_error';
  }
}

/** Replace an untrusted provider/tool error with a bounded public error. */
export function createPublicAIError(error: unknown, message: string): Error {
  const safe = new Error(message);
  safe.name = error instanceof AIError
    ? 'AIError'
    : error instanceof Error && isPublicErrorName(error.name)
      ? error.name
      : 'Error';
  return safe;
}

function isPublicErrorName(name: string): boolean {
  return [
    'AbortError',
    'TimeoutError',
    'Error',
    'TypeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'URIError',
    'AggregateError',
  ].includes(name);
}

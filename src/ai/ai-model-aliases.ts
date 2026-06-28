/**
 * ai-model-aliases.ts
 *
 * Resolves friendly model aliases into provider-qualified model ids. This file
 * owns parsing and validation only; it does not instantiate providers or call
 * model APIs.
 */

import { AIError } from './ai-errors';

/** Parsed model reference after alias resolution. */
export interface AIModelReference {
  requested: string;
  resolved: string;
  providerId: string;
  modelId: string;
  alias: string | null;
}

/**
 * Resolve a requested model name or alias to `provider/model`.
 *
 * Throws AIError when the requested value is neither a configured alias nor a
 * provider-qualified model id.
 */
export function resolveAIModelReference(
  requested: string | undefined,
  aliases: Record<string, string>,
  defaultAlias: string
): AIModelReference {
  const name = requested?.trim() || defaultAlias;
  const aliased = aliases[name];
  const resolved = aliased ?? name;
  const parsed = parseAIModelReference(resolved);

  if (!parsed) {
    throw new AIError(
      `AI model "${name}" is not configured. Use a provider-qualified model id like "openai/gpt-4o" or configure an alias.`,
      'AI_MODEL_NOT_CONFIGURED',
      400
    );
  }

  return {
    requested: name,
    resolved,
    providerId: parsed.providerId,
    modelId: parsed.modelId,
    alias: aliased ? name : null,
  };
}

/**
 * Parse a provider-qualified model string using the first slash as separator.
 *
 * Returns null for plain aliases or malformed values.
 */
export function parseAIModelReference(value: string): { providerId: string; modelId: string } | null {
  const index = value.indexOf('/');
  if (index <= 0 || index >= value.length - 1) return null;
  return {
    providerId: value.slice(0, index),
    modelId: value.slice(index + 1),
  };
}

/**
 * ai-env-values.ts
 *
 * Owns the small, provider-neutral primitives used while reading AI settings
 * from Bun's environment. It does not decide provider activation or aliases.
 */

import { AIError } from './ai-errors';

/** Minimal environment map used to keep config resolution testable. */
export type AIEnv = Record<string, string | undefined>;

/** Return the first non-blank value in environment-key precedence order. */
export function firstAIEnvValue(
  keys: readonly string[],
  env: AIEnv
): { key: string | null; value: string | undefined } {
  for (const key of keys) {
    const value = normalizeAIEnvString(env[key]);
    if (value) return { key, value };
  }
  return { key: null, value: undefined };
}

/** Normalize optional environment/config strings without accepting blanks. */
export function normalizeAIEnvString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Validate provider identifiers before they are used in config or env keys. */
export function validateAIProviderId(id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new AIError(
      `AI provider id "${id}" must start with a letter or number and contain only letters, numbers, ".", "_", or "-".`,
      'AI_PROVIDER_CONFIG_INVALID',
      500
    );
  }
}

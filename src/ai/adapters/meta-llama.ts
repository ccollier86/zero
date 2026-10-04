/**
 * meta-llama.ts
 *
 * Compatibility tombstone for Meta's retired hosted Llama API. The former
 * adapter remains importable so an upgrade fails with an actionable Zero
 * domain error instead of an export or module-resolution failure.
 */

import { AIError } from '../ai-errors';
import type { AIFetchFunction } from '../ai-provider-types';

/** Legacy per-model settings retained for source compatibility only. */
export interface MetaLlamaSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  repetitionPenalty?: number;
  maxTokens?: number;
  user?: string;
}

/** Legacy provider settings retained for source compatibility only. */
export interface MetaLlamaProviderSettings {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetch?: AIFetchFunction;
  generateId?: () => string;
}

/** Legacy callable provider shape. Every model lookup fails as retired. */
export interface MetaLlamaProvider {
  (modelId: string, settings?: MetaLlamaSettings): never;
  languageModel(modelId: string, settings?: MetaLlamaSettings): never;
}

const RETIRED_MESSAGE =
  'The direct Meta-hosted Llama provider has been retired because Meta no longer offers that API. '
  + 'Use Llama through Amazon Bedrock, Groq, Together AI, Fireworks AI, Hugging Face, '
  + 'or an OpenAI-compatible endpoint.';

/** Create the standard error used by config and legacy import boundaries. */
export function createMetaLlamaRetiredError(): AIError {
  return new AIError(RETIRED_MESSAGE, 'AI_PROVIDER_RETIRED', 410);
}

/**
 * Return the legacy callable facade without contacting the retired service.
 *
 * @deprecated Configure a supported Llama host instead.
 */
export function createMetaLlama(
  _options: MetaLlamaProviderSettings = {}
): MetaLlamaProvider {
  const retiredProvider = function retiredMetaLlamaProvider(
    _modelId: string,
    _settings?: MetaLlamaSettings
  ): never {
    throw createMetaLlamaRetiredError();
  };
  retiredProvider.languageModel = retiredProvider;
  return retiredProvider;
}

/**
 * Legacy default provider facade.
 *
 * @deprecated Configure a supported Llama host instead.
 */
export const metaLlama = createMetaLlama();

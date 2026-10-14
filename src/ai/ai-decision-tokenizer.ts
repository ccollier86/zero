/** Offline tokenizer construction; no model download, weights or inference dependency. */
import { Tokenizer } from '@huggingface/tokenizers';
import { AIError } from './ai-errors';

/**
 * Load checkpoint-matched tokenizer JSON once at trusted startup. This counter
 * never truncates, pads, adds framing tokens, or contacts a token-count endpoint.
 */
export function createLayaTokenCounter(tokenizerJSON: object, tokenizerConfig: object = {}): (text: string) => number {
  try {
    const tokenizer = new Tokenizer(structuredClone(tokenizerJSON), structuredClone(tokenizerConfig));
    // GGUF tokenization can omit the HF normalizer. Taking the larger count is
    // conservative for both English runtimes, including decomposed Unicode.
    const unnormalized = new Tokenizer({ ...structuredClone(tokenizerJSON), normalizer: null }, structuredClone(tokenizerConfig));
    return text => {
      try {
        return Math.max(tokenizer.tokenize(text, { add_special_tokens: false }).length,
          unnormalized.tokenize(text, { add_special_tokens: false }).length);
      } catch { throw invalidTokenizer(); }
    };
  } catch { throw invalidTokenizer(); }
}
function invalidTokenizer(): AIError {
  return new AIError('AI Laya local tokenizer could not be initialized or used.', 'AI_PROVIDER_CONFIG_INVALID', 500);
}

/** Internal bridge between Zero's portable fetch callback and Bun-augmented SDK types. */

import type { AIFetchFunction } from './ai-provider-types';

/**
 * AI SDK packages type fetch as the active runtime's global fetch. Bun adds a
 * static `preconnect` helper to that function, but application callbacks do not
 * need to implement it. Keep that runtime-only cast at this adapter boundary.
 */
export function asAISDKFetch(
  value: AIFetchFunction | undefined
): typeof globalThis.fetch | undefined {
  return value as typeof globalThis.fetch | undefined;
}

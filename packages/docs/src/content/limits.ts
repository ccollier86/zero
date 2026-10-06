import type { DocsCompilerLimits } from './types';
import { docsFailure } from './errors';

export interface ResolvedDocsLimits { maxDocuments: number; maxDocumentBytes: number; maxFrontmatterBytes: number; maxAssetBytes: number; maxTotalBytes: number }
const DEFAULTS: ResolvedDocsLimits = { maxDocuments: 5_000, maxDocumentBytes: 512_000, maxFrontmatterBytes: 32_768, maxAssetBytes: 8_388_608, maxTotalBytes: 134_217_728 };
/** Upper bounds keep author configuration from accidentally making public builds unbounded. */
export function resolveDocsLimits(input: DocsCompilerLimits = {}): ResolvedDocsLimits {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(DEFAULTS, key))) docsFailure('DOCS_CONFIG_INVALID', 'Compiler limits must be a mapping of supported limit names.', { field: 'limits' });
  const limits = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS) as Array<keyof ResolvedDocsLimits>) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0 || value > DEFAULTS[key] * 8) {
      docsFailure('DOCS_CONFIG_INVALID', 'A compiler limit must be a positive bounded integer.', { field: `limits.${key}` });
    }
    limits[key] = value;
  }
  return Object.freeze(limits);
}

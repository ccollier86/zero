import type { CodeBlockHighlightResult } from '@zero/framework/components/code-block/server';
import type { DocsManifest } from '../content/types';

/** Private, portable build data. It contains admitted content only, never source roots. */
export interface DocsBuildData {
  readonly version: 1;
  readonly mode: 'development' | 'production';
  readonly manifest: DocsManifest;
  readonly highlights: Readonly<Record<string, readonly (CodeBlockHighlightResult | null)[]>>;
}
/** Asset bytes stay private to this snapshot; callers cannot mutate them through the public manifest. */
export interface DocsSnapshot {
  readonly data: DocsBuildData;
  readonly assets: ReadonlyMap<string, Uint8Array>;
}

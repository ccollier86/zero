/** Prepare readable code once at publication, using the same public Zero fence contract as the UI. */
import { prepareCodeBlock } from '@zero/framework/components/code-block/server';
import type { CodeBlockHighlightResult } from '@zero/framework/components/code-block/server';
import type { DocsManifest, DocsNode } from '../content/types';
import { docsCodeOptions } from '../ui/code-options';
import { freezeDocsValue } from '../content/identity';

export async function compileDocsHighlights(manifest: DocsManifest): Promise<Readonly<Record<string, readonly (CodeBlockHighlightResult | null)[]>>> {
  const result: Record<string, readonly (CodeBlockHighlightResult | null)[]> = Object.create(null);
  for (const page of manifest.pages) {
    const fences: DocsNode[] = [];
    function visit(node: DocsNode) { if (node.type === 'code') fences.push(node); for (const child of node.children ?? []) visit(child); }
    visit(page.body);
    const prepared: Array<CodeBlockHighlightResult | null> = [];
    for (const [index, fence] of fences.entries()) {
      const block = await prepareCodeBlock(docsCodeOptions(fence, index), { fallbackOnError: true });
      prepared.push(block.highlighted ?? null);
    }
    result[page.route] = prepared;
  }
  return freezeDocsValue(result);
}

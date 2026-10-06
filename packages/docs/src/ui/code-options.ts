import type { CodeBlockProps } from '@zero/framework/react';
import type { DocsNode } from '../content/types';

/** One fence contract shared by publication-time highlighting and browser/SSR presentation. */
export function docsCodeOptions(node: DocsNode, index: number): CodeBlockProps {
  return {
    code: node.value ?? '', language: node.code?.language ?? 'text',
    filename: node.code?.title, meta: node.code?.meta,
    showLineNumbers: node.code?.lineNumbers ?? false, startLine: node.code?.startLine,
    highlightLines: node.code?.highlightLines,
    lineAnchors: `zero:docs:code:${index + 1}`, highlightOnClient: false,
  };
}

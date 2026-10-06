/** Compile stable search targets from the admitted AST; no source reads, HTML, or executable content. */
import type { DocsHeading, DocsNode, DocsPassage } from './types';
import { docsNodeText } from './markdown-text';

const PASSAGE_BLOCKS = new Set(['paragraph', 'heading', 'code', 'tableRow']);

/** Return a detached AST annotated only on renderable blocks, plus nearest-section passage context. */
export function buildDocsPassages(body: DocsNode): { body: DocsNode; passages: readonly DocsPassage[] } {
  const passages: DocsPassage[] = [], sections: DocsHeading[] = [];
  let next = 0;
  function visit(node: DocsNode, parent?: DocsNode['type']): DocsNode {
    if (node.type === 'heading') {
      const heading = { id: node.id ?? '', text: docsNodeText(node).replace(/\s+/gu, ' ').trim(), depth: node.depth ?? 2 };
      while (sections.length && sections[sections.length - 1]!.depth >= heading.depth) sections.pop();
      sections.push(heading);
    }
    const text = node.type === 'callout' ? node.title ?? node.tone ?? 'note' : PASSAGE_BLOCKS.has(node.type) || node.type === 'text' && parent === 'root' ? docsNodeText(node) : '';
    let searchId: string | undefined;
    if (text.trim()) {
      searchId = `docs-p-${next++}`;
      const section = sections[sections.length - 1];
      passages.push({ id: searchId, text, ...(section?.id ? { headingId: section.id } : {}), sectionPath: sections.map(item => item.text) });
    }
    return { ...node, ...(searchId ? { searchId } : {}), ...(node.children ? { children: node.children.map(child => visit(child, node.type)) } : {}) };
  }
  return { body: visit(body), passages };
}

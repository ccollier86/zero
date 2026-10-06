/** Serialize the admitted AST through the mature Markdown/GFM/directive writers, never original source HTML. */
import { unified } from 'unified';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import type { DocsNode } from './types';

interface MarkdownProjectionNode { type: string; children?: MarkdownProjectionNode[]; [key: string]: unknown }
const writer = unified().use(remarkStringify, { fences: true, bullet: '-', listItemIndent: 'one' }).use(remarkGfm).use(remarkDirective);
const FLOW = new Set(['root', 'blockquote', 'listItem', 'callout', 'footnoteDefinition']);
const PHRASING = new Set(['text', 'inlineCode', 'strong', 'emphasis', 'delete', 'link', 'image', 'break', 'footnoteReference']);

export function docsPublishedMarkdown(root: DocsNode): string {
  // The translator owns the complete allowlisted mdast shape; its generic node type also covers directive extensions.
  return writer.stringify(toMarkdown(root) as Parameters<typeof writer.stringify>[0]);
}
function toMarkdown(node: DocsNode): MarkdownProjectionNode {
  // Escaped block HTML becomes safe text in our AST. Restore a flow wrapper rather than accidentally
  // making the mature root serializer treat the entire mixed block document as one inline sequence.
  const children = node.children?.map(child => {
    const converted = toMarkdown(child);
    return FLOW.has(node.type) && PHRASING.has(child.type) ? { type: 'paragraph', children: [converted] } : converted;
  });
  switch (node.type) {
    case 'callout': return { type: 'containerDirective', name: node.tone ?? 'note', attributes: node.title ? { title: node.title } : {}, children: children ?? [] };
    case 'code': return { type: 'code', value: node.value ?? '', lang: node.code?.language ?? null, meta: node.code?.meta ?? null };
    case 'heading': return { type: 'heading', depth: node.depth ?? 2, children: children ?? [] };
    case 'link': return { type: 'link', url: node.url!, title: node.title ?? null, children: children ?? [] };
    case 'image': return { type: 'image', url: node.url!, title: node.title ?? null, alt: node.alt ?? '' };
    case 'footnoteDefinition': return { type: 'footnoteDefinition', identifier: node.identifier!, children: children ?? [] };
    case 'footnoteReference': return { type: 'footnoteReference', identifier: node.identifier! };
    case 'list': return { type: 'list', ordered: node.ordered ?? false, start: node.start ?? null, spread: false, children: children ?? [] };
    case 'listItem': return { type: 'listItem', checked: node.checked ?? null, spread: false, children: children ?? [] };
    case 'table': return { type: 'table', align: node.align ?? [], children: children ?? [] };
    case 'text': case 'inlineCode': return { type: node.type, value: node.value ?? '' };
    default: return { type: node.type, ...(children ? { children } : {}) };
  }
}

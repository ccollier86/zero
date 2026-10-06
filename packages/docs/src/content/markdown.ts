/** Mature CommonMark/GFM/directive parsing followed by an explicit, non-executable AST projection. */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import GithubSlugger from 'github-slugger';
import { readCodeBlockMetadata } from '@zero/framework/components/code-block/metadata';
import type { DocsNode, DocsNodeType, DocsHeading } from './types';
import { docsFailure } from './errors';
import { docsNodeText } from './markdown-text';
import { assertDocsLabel } from './search-bounds';

interface MarkdownNode {
  type: string; children?: MarkdownNode[]; value?: string; depth?: number; lang?: string | null; meta?: string | null;
  url?: string; title?: string | null; alt?: string | null; identifier?: string; ordered?: boolean; start?: number | null;
  checked?: boolean | null; align?: Array<'left' | 'right' | 'center' | null>; name?: string;
  attributes?: Record<string, string | null>; data?: { directiveLabel?: boolean }; position?: { start: { line: number; column: number } };
}
const CONTAINERS = new Set(['root', 'paragraph', 'emphasis', 'strong', 'delete', 'blockquote', 'list', 'listItem', 'table', 'tableRow', 'tableCell']);
const TONES = new Set(['note', 'tip', 'warning', 'danger']);
export interface ParsedDocsMarkdown { readonly body: DocsNode; readonly headings: readonly DocsHeading[]; readonly firstH1?: DocsHeading; readonly description: string; readonly text: string }

export function parseDocsMarkdown(markdown: string, sourcePath: string): ParsedDocsMarkdown {
  let root: MarkdownNode;
  try { root = unified().use(remarkParse).use(remarkGfm).use(remarkDirective).parse(markdown) as unknown as MarkdownNode; }
  catch { docsFailure('DOCS_MARKDOWN_INVALID', 'Markdown could not be parsed.', { sourcePath }); }
  const definitions = new Map<string, MarkdownNode>(), footnotes = new Map<string, string>();
  const slugger = new GithubSlugger(), headings: DocsHeading[] = [];
  let inspected = 0;
  const visit = (node: MarkdownNode, depth: number) => {
    if (++inspected > 25_000 || depth > 64) docsFailure('DOCS_LIMIT_EXCEEDED', 'Markdown syntax exceeds its node or nesting budget.', { sourcePath });
    if (node.type === 'definition' && node.identifier) definitions.set(identifier(node.identifier), node);
    if (node.type === 'footnoteDefinition' && node.identifier) {
      const id = slugger.slug('fn-' + identifier(node.identifier)); assertDocsLabel(id, sourcePath, 'footnote.id');
      footnotes.set(identifier(node.identifier), id);
    }
    for (const child of node.children ?? []) visit(child, depth + 1);
  };
  visit(root, 0);
  function invalid(node: MarkdownNode, message: string): never {
    docsFailure('DOCS_MARKDOWN_INVALID', message, { sourcePath, line: node.position?.start.line, column: node.position?.start.column });
  }
  function children(node: MarkdownNode): DocsNode[] { return (node.children ?? []).flatMap(child => { const value = convert(child); return value ? [value] : []; }); }
  function convert(node: MarkdownNode): DocsNode | null {
    if (node.type === 'definition') return null;
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'html') return { type: node.type === 'html' ? 'text' : node.type, value: node.value ?? '' };
    if (node.type === 'heading') {
      const content = children(node), text = docsNodeText({ type: 'paragraph', children: content }).replace(/\s+/gu, ' ').trim();
      assertDocsLabel(text, sourcePath, 'heading');
      const heading = { id: slugger.slug(text) || slugger.slug('section'), text, depth: node.depth ?? 1 };
      assertDocsLabel(heading.id, sourcePath, 'heading.id');
      headings.push(heading); return { type: 'heading', ...heading, children: content };
    }
    if (node.type === 'code') {
      const value = node.value ?? '', lineCount = value.split('\n').length;
      if (lineCount > 10_000 || new TextEncoder().encode(value).byteLength > 262_144) docsFailure('DOCS_LIMIT_EXCEEDED', 'A code fence exceeds its line or byte budget.', { sourcePath });
      const meta = node.meta ?? undefined;
      if (meta && meta.length > 4_096) invalid(node, 'Code fence metadata is too large.');
      if (node.lang && node.lang.length > 128) invalid(node, 'A code fence language label is too large.');
      const options = readCodeBlockMetadata({ meta }, lineCount);
      if (options.title) assertDocsLabel(options.title, sourcePath, 'code.title');
      return { type: 'code', value, code: { language: node.lang ?? undefined, meta,
        title: options.title, lineNumbers: options.lineNumbers, startLine: options.startLine, highlightLines: options.highlightLines } };
    }
    if (node.type === 'link' || node.type === 'image' || node.type === 'linkReference' || node.type === 'imageReference') {
      const definition = node.type.endsWith('Reference') ? definitions.get(identifier(node.identifier ?? '')) : node;
      if (!definition?.url) invalid(node, 'A Markdown reference has no link definition.');
      const image = node.type.startsWith('image');
      return { type: image ? 'image' : 'link', url: definition.url, title: definition.title ?? undefined,
        ...(image ? { alt: node.alt ?? '' } : { children: children(node) }) };
    }
    if (node.type === 'containerDirective' || node.type === 'leafDirective' || node.type === 'textDirective') {
      if (node.type !== 'containerDirective' || !TONES.has(node.name ?? '')) invalid(node, 'Only note, tip, warning and danger container callouts are supported.');
      if (Object.keys(node.attributes ?? {}).some(key => key !== 'title')) invalid(node, 'Callout attributes support title only; HTML attributes never execute.');
      const label = node.children?.find(child => child.data?.directiveLabel);
      const title = node.attributes?.title ?? (label ? docsNodeText({ type: 'paragraph', children: children(label) }) : undefined);
      if (title) assertDocsLabel(title, sourcePath, 'callout.title');
      return { type: 'callout', tone: node.name as 'note', title: title ?? undefined,
        children: (node.children ?? []).filter(child => !child.data?.directiveLabel).flatMap(child => { const value = convert(child); return value ? [value] : []; }) };
    }
    if (node.type === 'footnoteDefinition' || node.type === 'footnoteReference') {
      const key = identifier(node.identifier ?? ''), id = footnotes.get(key);
      if (!id) invalid(node, 'A footnote reference has no definition.');
      return { type: node.type, identifier: key, id, ...(node.type === 'footnoteDefinition' ? { children: children(node) } : {}) };
    }
    if (node.type === 'thematicBreak' || node.type === 'break') return { type: node.type };
    if (CONTAINERS.has(node.type)) {
      const content = children(node);
      if (node.type === 'blockquote') {
        const first = content[0];
        const text = first?.type === 'paragraph' ? docsNodeText(first) : '';
        const match = /^\[!(NOTE|TIP|WARNING|DANGER)\](?:\s|$)/u.exec(text);
        if (match) {
          const firstChild = first!.children?.[0];
          if (firstChild?.type === 'text') {
            const replacement = { ...firstChild, value: firstChild.value!.replace(/^\[!(?:NOTE|TIP|WARNING|DANGER)\][ \t]*\n?/u, '') };
            content[0] = { ...first!, children: [replacement, ...first!.children!.slice(1)] };
          }
          return { type: 'callout', tone: match[1]!.toLowerCase() as 'note', children: content };
        }
      }
      return { type: node.type as DocsNodeType, children: content,
        ...(node.type === 'list' ? { ordered: node.ordered ?? false, start: node.start ?? undefined } : {}),
        ...(node.type === 'listItem' ? { checked: node.checked ?? null } : {}), ...(node.type === 'table' ? { align: node.align ?? [] } : {}) };
    }
    return invalid(node, 'This Markdown construct is not part of the supported documentation syntax.');
  }
  const body = convert(root)!;
  const firstH1 = headings.find(heading => heading.depth === 1);
  const paragraph = body.children?.find(node => node.type === 'paragraph');
  return { body, headings, firstH1, description: paragraph ? docsNodeText(paragraph).replace(/\s+/gu, ' ').slice(0, 240) : '', text: docsNodeText(body) };
}
function identifier(value: string): string { return value.replace(/\s+/gu, ' ').trim().toLowerCase(); }

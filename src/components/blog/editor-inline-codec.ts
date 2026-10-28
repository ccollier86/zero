/** Lossless inline-only editor adapter. Canonical JSON, never editor HTML, crosses the publishing boundary. */
import type { JSONContent } from '@tiptap/core';
import type { BlogInlineText } from '../../blog/content-types';
import { safeBlogHref } from './blog-utils';

/** A restricted ProseMirror paragraph can express every canonical inline mark. */
export function blogInlineToEditor(content: readonly BlogInlineText[]): JSONContent {
  const nodes: JSONContent[] = [];
  for (const run of content) {
    const marks: NonNullable<JSONContent['marks']> = [];
    for (const name of ['bold', 'italic', 'underline', 'strike', 'code'] as const) if (run[name]) marks.push({ type: name });
    if (run.href && safeBlogHref(run.href)) marks.push({ type: 'link', attrs: { href: run.href } });
    const lines = run.text.split('\n');
    lines.forEach((text, index) => { if (index) nodes.push({ type: 'hardBreak', ...(marks.length ? { marks } : {}) }); if (text) nodes.push({ type: 'text', text, ...(marks.length ? { marks } : {}) }); });
  }
  return { type: 'doc', content: [{ type: 'paragraph', content: nodes }] };
}
/** Multi-paragraph paste becomes explicit newlines; unknown executable/structural editor nodes fail rather than silently losing content. */
export function blogInlineFromEditor(document: JSONContent): BlogInlineText[] {
  const result: BlogInlineText[] = [];
  const append = (run: BlogInlineText) => {
    if (!run.text) return;
    const previous = result.at(-1), { text: _a, ...marks } = run, { text: _b, ...old } = previous ?? { text: '' };
    if (previous && JSON.stringify(marks) === JSON.stringify(old)) previous.text += run.text;
    else result.push(run);
  };
  if (document.type !== 'doc' || !Array.isArray(document.content)) throw new Error('Unsupported inline document.');
  for (const [index, paragraph] of document.content.entries()) {
    if (paragraph.type !== 'paragraph') throw new Error('Unsupported inline paragraph.');
    if (index) append({ text: '\n\n' });
    for (const node of paragraph.content ?? []) {
      if (node.type !== 'hardBreak' && (node.type !== 'text' || typeof node.text !== 'string')) throw new Error('Unsupported inline content.');
      const run: BlogInlineText = { text: node.type === 'hardBreak' ? '\n' : node.text! };
      const marks = new Set<string>(); let link: string | undefined;
      for (const mark of node.marks ?? []) {
        if (['bold', 'italic', 'underline', 'strike', 'code'].includes(mark.type)) marks.add(mark.type);
        else if (mark.type === 'link') { const href = safeBlogHref(mark.attrs?.href); if (!href) throw new Error('Unsupported inline link.'); link = href; }
        else throw new Error('Unsupported inline formatting.');
      }
      // ProseMirror orders marks by its schema; the wire document uses a stable canonical order.
      for (const name of ['bold', 'italic', 'underline', 'strike', 'code'] as const) if (marks.has(name)) run[name] = true;
      if (link) run.href = link;
      append(run);
    }
  }
  return result;
}

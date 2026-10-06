/** Passage-centered plain excerpts and original-text ranges; no authored HTML or filesystem access. */
import { docsMatchRanges, type DocsMatchRange } from '../search/text';

/** Center a bounded excerpt around the densest available literal query matches. */
export function docsSearchExcerpt(text: string, terms: readonly string[]): { excerpt: string; matches: readonly DocsMatchRange[] } {
  const value = text.replace(/\s+/gu, ' ').trim(), width = 238, ranges = docsMatchRanges(value, terms, 64);
  let start = 0, score = -1;
  for (const range of ranges) {
    const candidate = Math.max(0, range.end - width, Math.min(value.length - width, range.start - 60));
    const count = ranges.filter(item => item.start >= candidate && item.end <= candidate + width).length;
    if (count > score) { score = count; start = candidate; }
  }
  if (start > 0 && /[\uDC00-\uDFFF]/u.test(value[start]!)) start--;
  let end = Math.min(value.length, start + width);
  if (end < value.length && /[\uDC00-\uDFFF]/u.test(value[end]!)) end--;
  const excerpt = (start ? '…' : '') + value.slice(start, end) + (end < value.length ? '…' : '');
  return { excerpt, matches: docsMatchRanges(excerpt, terms) };
}

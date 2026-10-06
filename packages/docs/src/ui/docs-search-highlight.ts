/** Native text ranges preserve article structure and syntax colors; unsupported browsers retain passage focus. */
import { docsMatchRanges, docsSearchTerms } from '../search/text';

interface HighlightRegistry {
  get(name: string): unknown;
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
const NAME = 'zero-docs-search';
export function highlightDocsPassage(element: HTMLElement, query: string): () => void {
  const view = element.ownerDocument.defaultView;
  const native = view as (Window & { Highlight?: new (...ranges: Range[]) => unknown; CSS: { highlights?: HighlightRegistry } }) | null;
  const registry = native?.CSS?.highlights;
  if (!registry || !native?.Highlight) return () => {};
  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const segments: Array<{ node: Text; start: number; end: number }> = [];
  let text = '', current: Node | null;
  while ((current = walker.nextNode()) && text.length < 100_000) {
    if ((current.parentElement?.closest('button, [aria-hidden="true"], .zero-docs-heading-link, .zero-code-block-line-numbers'))) continue;
    const value = current.textContent ?? '';
    segments.push({ node: current as Text, start: text.length, end: text.length + value.length }); text += value;
  }
  const ranges: Range[] = [];
  for (const match of docsMatchRanges(text, docsSearchTerms(query), 64)) {
    const start = segments.find(segment => segment.start <= match.start && segment.end > match.start);
    const end = segments.find(segment => segment.start < match.end && segment.end >= match.end);
    if (!start || !end) continue;
    const range = element.ownerDocument.createRange();
    range.setStart(start.node, match.start - start.start); range.setEnd(end.node, match.end - end.start); ranges.push(range);
  }
  const highlight = new native.Highlight(...ranges);
  registry.set(NAME, highlight);
  return () => { if (registry.get(NAME) === highlight) registry.delete(NAME); };
}

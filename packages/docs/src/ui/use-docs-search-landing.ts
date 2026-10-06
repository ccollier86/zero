/** Applies a selected result only to its exact page snapshot, after navigation or modal focus release. */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DocsPage } from '../content/types';
import { DOCS_SEARCH_LANDING_EVENT, consumeDocsSearchSelection, validDocsSearchSelection, type DocsSearchSelection } from './docs-search-selection';
import { highlightDocsPassage } from './docs-search-highlight';
import { docsMatchRanges, docsSearchTerms } from '../search/text';

export function useDocsSearchLanding(root: RefObject<HTMLDivElement | null>, basePath: string, page: DocsPage) {
  const [query, setQuery] = useState<string | null>(null);
  const cleanup = useRef<() => void>(() => {});
  const receipt = useRef<DocsSearchSelection | null>(null);
  const clear = useCallback(() => { cleanup.current(); cleanup.current = () => {}; receipt.current = null; setQuery(null); }, []);
  useEffect(() => {
    function land(selection: DocsSearchSelection | null) {
      if (!selection || !root.current) return;
      receipt.current = selection;
      cleanup.current();
      const article = root.current.closest('main') ?? root.current;
      const passage = selection.passageId ? article.querySelector<HTMLElement>(`[data-docs-passage="${selection.passageId}"]`) : null;
      let heading: string | undefined;
      try { heading = decodeURIComponent(selection.route.split('#')[1] ?? ''); } catch { /* Invalid authored hash never becomes a selector. */ }
      const description = article.querySelector<HTMLElement>('[data-docs-description]');
      const matchedDescription = !heading && description && docsMatchRanges(description.textContent ?? '', docsSearchTerms(selection.query)).length ? description : null;
      const target = passage ?? (heading ? article.querySelector<HTMLElement>(`[id="${CSS.escape(heading)}"]`) : null) ?? matchedDescription ?? article.querySelector<HTMLElement>('h1');
      if (!target) return;
      const previous = target.getAttribute('tabindex');
      target.setAttribute('tabindex', '-1'); target.setAttribute('data-docs-search-target', 'true');
      const removeHighlight = highlightDocsPassage(target, selection.query);
      cleanup.current = () => {
        removeHighlight(); target.removeAttribute('data-docs-search-target');
        if (previous === null) target.removeAttribute('tabindex'); else target.setAttribute('tabindex', previous);
      };
      setQuery(selection.query);
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
    const selected = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail;
      if (validDocsSearchSelection(value, basePath, page.route, page.hash)) {
        consumeDocsSearchSelection(basePath, page.route, page.hash); land(value);
      }
    };
    setQuery(null);
    const stored = consumeDocsSearchSelection(basePath, page.route, page.hash);
    // StrictMode effect replay must not erase a receipt that was already consumed by this reader.
    const previous = receipt.current;
    land(stored ?? (validDocsSearchSelection(previous, basePath, page.route, page.hash) ? previous : null));
    window.addEventListener(DOCS_SEARCH_LANDING_EVENT, selected);
    window.addEventListener('popstate', clear); window.addEventListener('hashchange', clear);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) clear();
    };
    window.addEventListener('keydown', key);
    return () => { cleanup.current(); window.removeEventListener(DOCS_SEARCH_LANDING_EVENT, selected); window.removeEventListener('keydown', key); window.removeEventListener('popstate', clear); window.removeEventListener('hashchange', clear); };
  }, [root, basePath, page.route, page.hash, clear]);
  return { query, clear };
}

/** Server-ranked search using Zero's Command controls and native, canonical result links. */
import { useState, useRef, type MouseEvent, type KeyboardEvent } from 'react';
import { Button, CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem } from '@zero/framework/react';
import { Search, ArrowRight } from '@zero/framework/icons';
import type { DocsPresentation, DocsSearchResult } from './types';
import { useDocsSearch } from './use-docs-search';
import { useDocsMotionDuration } from './use-docs-motion';
import { useDocsSearchDialog } from './use-docs-search-dialog';
import { useDocsSearchViewport } from './use-docs-search-viewport';
import { DocsSearchMark } from './docs-search-mark';
import { docsMatchRanges, docsSearchTerms } from '../search/text';
import { isDocsCurrentWindowNavigation } from './docs-navigation-intent';
import { createDocsSearchSelection, rememberDocsSearchSelection, DOCS_SEARCH_LANDING_EVENT } from './docs-search-selection';
import { useDocsNavigationLifecycle } from './docs-navigation-scope';

export function DocsSearch({ presentation }: { readonly presentation: DocsPresentation }) {
  const [query, setQuery] = useState('');
  const dialog = useDocsSearchDialog(), viewport = useDocsSearchViewport(dialog.open);
  const navigation = useDocsNavigationLifecycle();
  const afterDrawerClose = (callback: () => void) => navigation ? navigation.navigate(callback) : callback();
  const duration = useDocsMotionDuration(), search = useDocsSearch(presentation.basePath, query, dialog.open);
  const groups = new Map<string, DocsSearchResult[]>();
  for (const result of search.results) groups.set(result.pageRoute, [...(groups.get(result.pageRoute) ?? []), result]);
  const terms = docsSearchTerms(query);
  function navigate(result: DocsSearchResult, event?: MouseEvent<HTMLAnchorElement>) {
    if (event && !isDocsCurrentWindowNavigation(event)) return;
    const selection = createDocsSearchSelection(presentation.basePath, result, query);
    rememberDocsSearchSelection(selection);
    if (window.location.pathname === result.pageRoute) {
      event?.preventDefault();
      dialog.closeForNavigation(() => afterDrawerClose(() => {
        window.history.pushState(null, '', result.route);
        window.dispatchEvent(new CustomEvent(DOCS_SEARCH_LANDING_EVENT, { detail: selection }));
      }));
    } else if (event) dialog.closeForNavigation();
    else dialog.closeForNavigation(() => afterDrawerClose(() => window.location.assign(result.route)));
  }
  function newTab(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); dialog.changeOpen(false); return;
    }
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
    const link = event.currentTarget.closest('[cmdk-root]')?.querySelector<HTMLAnchorElement>('a[cmdk-item][aria-selected="true"]');
    if (link) { event.preventDefault(); window.open(link.href, '_blank', 'noopener'); }
  }
  const announcement = search.status === 'ready' ? `${search.results.length} results in ${groups.size} ${groups.size === 1 ? 'page' : 'pages'}.`
    : search.status === 'loading' ? 'Searching documentation…' : '';
  return <>
    <Button ref={dialog.trigger} type="button" variant="outline" className="zero-docs-search-trigger" onClick={() => dialog.changeOpen(true)} aria-label="Search documentation"><Search aria-hidden="true" /><span>Search documentation…</span><kbd>⌘ K</kbd></Button>
    <CommandDialog open={dialog.open} onOpenChange={dialog.changeOpen} shouldFilter={false} title="Search documentation" description="Search pages and sections. Use arrow keys to choose a result, then Enter to open it." contentClassName="zero-docs-search" contentStyle={viewport} contentTransition={{ duration, ease: 'easeOut' }} overlayTransition={{ duration }} onCloseAutoFocus={dialog.onCloseAutoFocus}>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search documentation…" maxLength={200} onKeyDownCapture={newTab} />
      <div className="zero-docs-search-body" onKeyDownCapture={newTab}>
      <CommandList aria-busy={search.status === 'loading'} label="Documentation search results">
        {[...groups].map(([path, results]) => <CommandGroup key={path} heading={<span className="zero-docs-search-group"><strong><DocsSearchMark text={results[0]!.title} ranges={results[0]!.matches?.title ?? docsMatchRanges(results[0]!.title, terms)} /></strong><small>{path}</small></span>}>
          {results.map(result => <DocsSearchResultItem key={`${result.route}:${result.passageId ?? ''}`} result={result} query={query} navigate={navigate} />)}
        </CommandGroup>)}
        {search.status === 'error' ? <div className="zero-docs-search-state" role="alert">Search couldn’t load. <Button type="button" variant="ghost" onClick={search.retry}>Try again</Button></div>
          : !search.results.length && <div className="zero-docs-search-state" role="status">{search.status === 'loading' ? 'Searching…' : search.status === 'ready' ? 'No matching pages. Try a different phrase.' : 'Type at least two characters to search.'}</div>}
      </CommandList>
      </div>
      <div className="zero-docs-search-footer"><span className="zero-docs-search-count" aria-live="polite" aria-atomic="true">{announcement}</span><span><kbd>↑</kbd> <kbd>↓</kbd> navigate</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>
    </CommandDialog>
  </>;
}

function DocsSearchResultItem({ result, query, navigate }: {
  readonly result: DocsSearchResult; readonly query: string;
  readonly navigate: (result: DocsSearchResult, event?: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const pointer = useRef(false), terms = docsSearchTerms(query);
  const label = result.section ?? result.title;
  return <CommandItem asChild value={`${result.route}:${result.passageId ?? ''}`} aria-label={`${label} ${result.excerpt}`} onSelect={() => {
    if (pointer.current) { pointer.current = false; return; }
    navigate(result);
  }}>
    <a href={result.route} onClick={event => {
      pointer.current = true; queueMicrotask(() => { pointer.current = false; }); navigate(result, event);
    }}>
      <div className="zero-docs-search-result"><span><DocsSearchMark text={label} ranges={(result.section ? result.matches?.section : result.matches?.title) ?? docsMatchRanges(label, terms)} /></span>
        {!!result.sectionPath?.length && <small>{result.sectionPath.join(' › ')}</small>}
        <p><DocsSearchMark text={result.excerpt} ranges={result.matches?.excerpt ?? docsMatchRanges(result.excerpt, terms)} /></p>
      </div><ArrowRight aria-hidden="true" />
    </a>
  </CommandItem>;
}

import { useEffect, useState } from 'react';
import { emitFrontendCode, FRONTEND_OBS_CODES } from '@zero/framework/react';
import type { DocsSearchResult } from './types';
import { readDocsSearchResults } from './read-docs-search-results';

interface SearchState { readonly basePath: string; readonly query: string; readonly status: 'idle' | 'loading' | 'ready' | 'error'; readonly results: readonly DocsSearchResult[] }
const idle: SearchState = { basePath: '', query: '', status: 'idle', results: [] };

/** Debounced public queries: each change aborts its predecessor and stale results never become visible. */
export function useDocsSearch(basePath: string, query: string, open: boolean) {
  const normalized = query.trim().slice(0, 200), [state, setState] = useState<SearchState>(idle), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open || normalized.length < 2) { setState(idle); return; }
    let current = true; const controller = new AbortController();
    setState({ basePath, query: normalized, status: 'loading', results: [] });
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${basePath === '/' ? '' : basePath}/_api/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Documentation search is unavailable.');
        const data: unknown = await response.json(), results = readDocsSearchResults(data, basePath);
        if (current) setState({ basePath, query: normalized, status: 'ready', results });
      } catch {
        if (!current || controller.signal.aborted) return;
        setState({ basePath, query: normalized, status: 'error', results: [] });
        emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_DOCS_SEARCH_FAILED, { metadata: { stage: 'query' } });
      }
    }, 180);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [basePath, normalized, open, retry]);
  return { ...(state.query === normalized && state.basePath === basePath ? state : normalized.length >= 2 && open ? { basePath, query: normalized, status: 'loading' as const, results: [] } : idle), retry: () => setRetry(value => value + 1) };
}

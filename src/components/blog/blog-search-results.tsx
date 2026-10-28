'use client';

import * as React from 'react';
import { FileText, ArrowUpRight } from 'lucide-react';
import { Command, CommandInput, CommandList, CommandItem } from '../ui/command';
import { Popover, PopoverAnchor, PopoverContent, PopoverViewport } from '../surfaces/popover';
import { cn } from '../../lib/utils';
import { useBlogPostHref } from './blog-provider';
import { safeBlogHref } from './blog-utils';
import type { BlogPost } from './blog.types';
import { BlogReadError, BlogSearchSkeleton } from './blog-states';
import { Button } from '../ui/button';

/** Pure local matching; manual mode leaves retrieval/ranking with the application's source. */
export function searchBlogPosts(posts: readonly BlogPost[], query: string, limit = 6, match: 'all' | 'any' = 'all'): BlogPost[] {
  const terms = query.slice(0, 256).normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return [];
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
  return posts.map((post, order) => {
    const title = normalize(post.title), excerpt = normalize(post.excerpt ?? ''), categories = normalize(post.categories?.map(value => value.name).join(' ') ?? ''), tags = normalize(post.tags?.map(value => value.name).join(' ') ?? '');
    const scores = terms.map(term => (title.includes(term) ? title.startsWith(term) ? 10 : 5 : 0) + (excerpt.includes(term) ? 2 : 0) + (categories.includes(term) ? 3 : 0) + (tags.includes(term) ? 2 : 0));
    return { post, order, score: (match === 'all' ? scores.every(Boolean) : scores.some(Boolean)) ? scores.reduce((sum, score) => sum + score, 0) : 0 };
  }).filter(value => value.score > 0).sort((a, b) => b.score - a.score || a.order - b.order).slice(0, Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.floor(limit) : 6))).map(value => value.post);
}
export interface SearchWithResultsProps {
  posts: readonly BlogPost[]; baseUrl?: string; maxResults?: number; showPreview?: boolean; placeholder?: string; label?: string;
  query?: string; defaultQuery?: string; onQueryChange?: (query: string) => void;
  open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void;
  filterMode?: 'local' | 'manual'; match?: 'all' | 'any'; loading?: boolean; empty?: React.ReactNode; className?: string; size?: 'sm' | 'default' | 'lg';
  onSelect?: (post: BlogPost, context: { signal: AbortSignal }) => void | boolean | Promise<void | boolean>; onError?: (error: unknown) => void;
  error?: boolean; onRetry?: () => void; catalogEmpty?: boolean;
}
export function SearchWithResults({ posts, baseUrl, maxResults = 6, showPreview = true, placeholder = 'Search articles…', label = 'Search articles', query: controlledQuery, defaultQuery = '', onQueryChange,
  open: controlledOpen, defaultOpen = false, onOpenChange, filterMode = 'local', match = 'all', loading = false, empty, className, size = 'default', onSelect, onError, error = false, onRetry, catalogEmpty }: SearchWithResultsProps) {
  const [localQuery, setQuery] = React.useState(defaultQuery), [localOpen, setOpen] = React.useState(defaultOpen), [active, setActive] = React.useState(''), [pending, setPending] = React.useState(false), [failed, setFailed] = React.useState(false);
  const operation = React.useRef<AbortController | null>(null), hrefFor = useBlogPostHref();
  const query = controlledQuery ?? localQuery, open = controlledOpen ?? localOpen;
  const results = loading || error ? [] : filterMode === 'manual' ? posts.slice(0, Math.max(1, Math.min(100, Number.isFinite(maxResults) ? Math.floor(maxResults) : 6))) : searchBlogPosts(posts, query, maxResults, match);
  const preview = results.find(post => post.id === active) ?? results[0];
  const changeOpen = (value: boolean) => { if (!value) operation.current?.abort(); if (controlledOpen === undefined) setOpen(value); onOpenChange?.(value); };
  React.useEffect(() => { operation.current?.abort(); operation.current = null; setPending(false); setFailed(false); }, [query, posts]);
  React.useEffect(() => { if (!open) { operation.current?.abort(); operation.current = null; setPending(false); } }, [open]);
  React.useEffect(() => () => operation.current?.abort(), []);
  const select = async (post: BlogPost) => {
    if (operation.current || loading || error) return;
    const controller = new AbortController(); operation.current = controller; setPending(true); setFailed(false);
    try { const result = onSelect ? await onSelect(post, { signal: controller.signal }) : window.location.assign(hrefFor(post, baseUrl)); if (!controller.signal.aborted && result !== false) changeOpen(false); }
    catch (error) { if (!controller.signal.aborted) { setFailed(true); try { onError?.(error); } catch { /* Observer only. */ } } }
    finally { if (operation.current === controller) { operation.current = null; if (!controller.signal.aborted) setPending(false); } }
  };
  return <Command label={label} shouldFilter={false} value={active} onValueChange={setActive} className={cn('zero-blog-search-results', className)} data-size={size}>
    <Popover open={open} onOpenChange={changeOpen}><PopoverAnchor asChild><div className="zero-blog-search-anchor">
      <CommandInput aria-label={label} aria-expanded={open} placeholder={placeholder} value={query} disabled={pending} onFocus={() => changeOpen(true)}
        onValueChange={value => { const next = value.slice(0, 256); if (controlledQuery === undefined) setQuery(next); onQueryChange?.(next); changeOpen(true); }}
        onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); changeOpen(false); } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') changeOpen(true); }} />
    </div></PopoverAnchor>
      <PopoverContent className="zero-blog-overlay zero-blog-search-dropdown" align="start" side="bottom" onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}>
        <div className="zero-blog-search-panels"><div className="zero-blog-search-list-frame"><CommandList aria-busy={pending || loading && !error}>
          {error ? <BlogReadError compact title="Search is unavailable" description="Your query has been kept. Try again or change your search." onRetry={onRetry} /> : loading ? <BlogSearchSkeleton /> : results.length ? results.map(post => <CommandItem key={post.id} value={post.id} disabled={pending} onSelect={() => { void select(post); }}>
            {safeBlogHref(post.featuredImage) ? <img className="zero-blog-search-result-image" src={safeBlogHref(post.featuredImage)} alt="" loading="lazy" /> : <FileText aria-hidden="true" />}
            <span><strong>{post.title}</strong>{post.excerpt && <span>{post.excerpt}</span>}</span><ArrowUpRight aria-hidden="true" />
          </CommandItem>) : empty !== undefined ? empty : <div role="status" className="zero-blog-search-empty"><strong>{query.trim() ? 'No matching articles' : (catalogEmpty ?? (!posts.length && filterMode === 'local')) ? 'No articles yet' : 'Search articles'}</strong>
            <p>{query.trim() ? 'Try a different search.' : 'Type a title or topic to find published articles.'}</p>{query.trim() && (controlledQuery === undefined || onQueryChange) && <Button type="button" variant="outline" onClick={() => { if (controlledQuery === undefined) setQuery(''); onQueryChange?.(''); }}>Clear search</Button>}</div>}
        </CommandList></div>
          {showPreview && preview && !loading && <aside aria-label="Article preview" className="zero-blog-search-preview"><PopoverViewport>
            {safeBlogHref(preview.featuredImage) && <img src={safeBlogHref(preview.featuredImage)} alt={preview.featuredImageAlt ?? ''} />}<strong>{preview.title}</strong>{preview.excerpt && <p>{preview.excerpt}</p>}
            {preview.author && <p>{preview.author.name}</p>}{preview.readingTime && <p>{preview.readingTime}</p>}
          </PopoverViewport></aside>}
        </div>{failed && <p role="alert">That article could not be opened. Try again.</p>}
      </PopoverContent>
    </Popover>
  </Command>;
}
export { SearchWithResults as SearchBarWithDropdown };

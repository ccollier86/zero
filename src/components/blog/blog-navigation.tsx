'use client';

import * as React from 'react';
import { ChevronDown } from '../animate-ui/icons/chevron-down';
import { Copy } from '../animate-ui/icons/copy';
import { Check } from '../animate-ui/icons/check';
import { Search } from '../animate-ui/icons/search';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { ScrollArea } from '../ui/scroll-area';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationPrevious, PaginationNext, PaginationEllipsis } from '../ui/pagination';
import { MenuActiveHighlight } from '../overlays/menu-active-highlight';
import { cn } from '../../lib/utils';
import { BlogLink } from './blog-provider';
import { blogPageWindow, safeBlogHref } from './blog-utils';
import type { BlogCategory, BlogPaginationState, BlogTocItem } from './blog.types';

export function SearchBar({ value, onChange, placeholder = 'Search articles…', isLoading, ...props }: Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> & { value: string; onChange: (query: string) => void; isLoading?: boolean }) {
  return <div className="zero-blog-search"><Search aria-hidden="true" /><Input {...props} type="search" aria-label={props['aria-label'] ?? 'Search articles'} placeholder={placeholder} value={value} onChange={event => onChange(event.currentTarget.value)} aria-busy={isLoading} /></div>;
}
export function CategoryFilter({ categories, selectedCategory, onCategoryChange, allLabel = 'All articles' }: { categories: readonly BlogCategory[]; selectedCategory?: string | null; onCategoryChange?: (id: string | null) => void; allLabel?: string }) {
  const [local, setLocal] = React.useState<string | null>(null), [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const selected = selectedCategory === undefined ? local : selectedCategory;
  const change = (id: string | null) => { if (selectedCategory === undefined) setLocal(id); onCategoryChange?.(id); };
  return <div ref={setContainer} className="zero-blog-category-filter" role="group" aria-label="Article categories">
    <Button type="button" variant="ghost" aria-pressed={selected === null} onClick={() => change(null)}>{allLabel}</Button>
    {categories.map(category => <Button type="button" variant="ghost" key={category.id} aria-pressed={selected === category.id} onClick={() => change(category.id)}>{category.name}{category.count !== undefined && <span>{category.count}</span>}</Button>)}
    <MenuActiveHighlight container={container} activeSelector='[aria-pressed="true"]' hoverSelector="button" preserveSelectionFill={false} />
  </div>;
}
export interface BlogPaginationProps extends BlogPaginationState { onPageChange?: (page: number) => void; hrefForPage?: (page: number) => string; showPageInfo?: boolean; className?: string }
export function BlogPagination({ currentPage, totalPages, totalItems, itemsPerPage, onPageChange, hrefForPage = page => `?page=${page}`, showPageInfo = true, className }: BlogPaginationProps) {
  const [container, setContainer] = React.useState<HTMLUListElement | null>(null);
  if (!Number.isSafeInteger(totalPages) || totalPages <= 1) return null;
  const page = Math.min(totalPages, Math.max(1, Math.floor(currentPage) || 1));
  const attributes = (next: number, disabled = false) => ({ href: disabled ? undefined : safeBlogHref(hrefForPage(next)), 'aria-disabled': disabled || undefined, tabIndex: disabled ? -1 : undefined,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { if (disabled) { event.preventDefault(); return; } if (onPageChange && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); if (next !== page) onPageChange(next); } } });
  return <div className={cn('zero-blog-pagination', className)}>
    {showPageInfo && totalItems !== undefined && itemsPerPage !== undefined && totalItems >= 0 && itemsPerPage > 0 && <p className="zero-blog-muted">Showing {Math.min((page - 1) * itemsPerPage + 1, totalItems)}–{Math.min(page * itemsPerPage, totalItems)} of {totalItems} results</p>}
    <Pagination variant="editorial"><PaginationContent ref={setContainer}>
      <PaginationItem><PaginationPrevious {...attributes(page - 1, page <= 1)} /></PaginationItem>
      {blogPageWindow(page, totalPages).map(value => <PaginationItem key={value}>{typeof value === 'number' ? <PaginationLink {...attributes(value)} isActive={page === value} aria-label={`Page ${value}`}>{value}</PaginationLink> : <PaginationEllipsis />}</PaginationItem>)}
      <PaginationItem><PaginationNext {...attributes(page + 1, page >= totalPages)} /></PaginationItem>
      <MenuActiveHighlight container={container} activeSelector='[aria-current="page"]' hoverSelector='[data-slot="pagination-link"]' preserveSelectionFill />
    </PaginationContent></Pagination>
  </div>;
}
export interface TableOfContentsProps { items: readonly BlogTocItem[]; title?: string; collapsible?: boolean; defaultCollapsed?: boolean; showNumbers?: boolean; className?: string; contentRoot?: HTMLElement | null; onItemClick?: (item: BlogTocItem) => void }
export function TableOfContents({ items, title = 'On this page', collapsible = false, defaultCollapsed = false, showNumbers = false, className, contentRoot, onItemClick }: TableOfContentsProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed), [active, setActive] = React.useState(items[0]?.id), [container, setContainer] = React.useState<HTMLElement | null>(null);
  const flat = React.useMemo(() => { const out: BlogTocItem[] = []; const visit = (entries: readonly BlogTocItem[], depth = 0) => { if (depth > 8) return; for (const entry of entries) { if (out.length >= 500) return; out.push(entry); if (entry.children) visit(entry.children, depth + 1); } }; visit(items); return out; }, [items]);
  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = new Set(flat.map(item => item.id)), scope = contentRoot ?? document;
    const headings = [...scope.querySelectorAll<HTMLElement>('[id]')].filter(element => ids.has(element.id));
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible[0]) setActive(visible[0].target.id);
    }, { rootMargin: '-8% 0px -65% 0px', threshold: 0 });
    headings.forEach(heading => observer.observe(heading)); return () => observer.disconnect();
  }, [flat, contentRoot]);
  if (!flat.length) return null;
  return <section className={cn('zero-blog-toc', className)}>
    {collapsible ? <Button type="button" variant="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{title}<ChevronDown aria-hidden="true" /></Button> : <h2>{title}</h2>}
    {!collapsed && <ScrollArea className="zero-blog-toc-scroll" scrollChaining="auto"><nav ref={setContainer} aria-label={title}>
      {flat.map((item, index) => <a key={`${item.id}:${index}`} href={`#${encodeURIComponent(item.id)}`} data-level={item.level} aria-current={active === item.id ? 'location' : undefined} onClick={() => { setActive(item.id); onItemClick?.(item); }}>{showNumbers && <span>{index + 1}.</span>}{item.text ?? item.title ?? item.id}</a>)}
      <MenuActiveHighlight container={container} activeSelector='[aria-current="location"]' hoverSelector="a" preserveSelectionFill={false} />
    </nav></ScrollArea>}
  </section>;
}
export function TableOfContentsSidebar(props: TableOfContentsProps) { return <TableOfContents {...props} className={cn('zero-blog-toc-sidebar', props.className)} />; }
export function TableOfContentsFloating({ placement = 'right', ...props }: TableOfContentsProps & { placement?: 'left' | 'right' }) {
  return <div className="zero-blog-toc-floating" data-placement={placement}><TableOfContents {...props} /></div>;
}
export interface SocialShareProps { url?: string; title?: string; platforms?: readonly ('x' | 'linkedin' | 'facebook' | 'email')[]; showCopyLink?: boolean; className?: string; onCopyError?: (error: unknown) => void }
export function SocialShare({ url, title = '', platforms = ['x', 'linkedin', 'facebook', 'email'], showCopyLink = true, className, onCopyError }: SocialShareProps) {
  const [copied, setCopied] = React.useState<string | null>(null), [error, setError] = React.useState(false), timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined), alive = React.useRef(true), pending = React.useRef(false);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; clearTimeout(timer.current); }; }, []);
  const safe = safeBlogHref(url); if (!safe || !/^https?:/u.test(safe) || (!platforms.length && !showCopyLink)) return null;
  const encoded = encodeURIComponent(safe), text = encodeURIComponent(title);
  const links = { x: `https://twitter.com/intent/tweet?url=${encoded}&text=${text}`, linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encoded}`, facebook: `https://www.facebook.com/sharer/sharer.php?u=${encoded}`, email: `mailto:?subject=${text}&body=${encoded}` };
  const copiedHere = copied === safe;
  const copy = async () => { if (pending.current) return; pending.current = true; setError(false); try { await navigator.clipboard.writeText(safe); if (alive.current) { setCopied(safe); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(null), 2000); } } catch (cause) { if (alive.current) setError(true); try { onCopyError?.(cause); } catch { /* Observer only. */ } } finally { pending.current = false; } };
  return <div className={cn('zero-blog-share', className)} aria-label="Share article">{platforms.map(platform => <BlogLink key={platform} href={links[platform]} target={platform === 'email' ? undefined : '_blank'} aria-label={`Share via ${platform === 'x' ? 'X' : platform}`}>{platform === 'x' ? 'X' : platform === 'linkedin' ? 'LinkedIn' : platform === 'facebook' ? 'Facebook' : 'Email'}</BlogLink>)}
    {showCopyLink && <Button type="button" variant="outline" size="sm" onClick={() => { void copy(); }} aria-label={copiedHere ? 'Link copied' : 'Copy article link'}>{copiedHere ? <Check /> : <Copy />}{copiedHere ? 'Copied' : 'Copy link'}</Button>}
    <span className="sr-only" role="status">{error ? 'The link could not be copied.' : copiedHere ? 'Link copied.' : ''}</span>
  </div>;
}

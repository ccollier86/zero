'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';
import { Typography, Prose, AuthorCardFeatured, BlogPostMeta, CategoryBadges, EmptyState } from './blog-primitives';
import { BlogCardGrid, RecentPostsHero, RelatedPosts } from './blog-cards';
import { CategoryFilter, BlogPagination, TableOfContents, TableOfContentsSidebar, SocialShare, SearchBar } from './blog-navigation';
import { BlogSearchPalette, type BlogSearchPaletteProps } from './blog-search';
import { SearchWithResults, type SearchWithResultsProps } from './blog-search-results';
import { BlogLink, useBlogScope } from './blog-provider';
import { safeBlogHref, blogBlockToc, blogHeadingId, blogDate } from './blog-utils';
import { BlockRenderer } from './blog-blocks';
import type { BlogPost, BlogCategory, BlogFilterState, BlogPaginationState, BlogTocItem } from './blog.types';
import { uniqueBlogPosts } from './blog-post-list';
import { blogListModel } from './blog-list-model';
import { BlogGridSkeleton, BlogReadError } from './blog-states';
import { Button } from '../ui/button';

export interface BlogHeroProps {
  title: string; excerpt?: string; featuredImage?: string; featuredImageAlt?: string;
  author?: BlogPost['author']; publishedAt?: string; readingTime?: string; categories?: readonly BlogCategory[];
  shareUrl?: string; className?: string; variant?: 'contained' | 'fullwidth' | 'compact' | 'split' | 'editorial';
  height?: 'sm' | 'md' | 'lg' | 'full'; showGradient?: boolean; showShare?: boolean;
}
export function BlogHero({ title, excerpt, featuredImage, featuredImageAlt, author, publishedAt, readingTime, categories, shareUrl, className, variant = 'contained', height = 'lg', showGradient = true, showShare = true }: BlogHeroProps) {
  const source = safeBlogHref(featuredImage);
  const share = safeBlogHref(shareUrl), canShare = showShare && share && /^https?:/u.test(share);
  const hasMeta = author || blogDate(publishedAt) || readingTime || canShare;
  const overlay = !!source && (variant === 'contained' || variant === 'fullwidth');
  const copy = <div className="zero-blog-hero-copy"><CategoryBadges categories={categories} /><Typography variant="h1" balance>{title}</Typography>
      {excerpt && <Typography variant="lead" color="secondary">{excerpt}</Typography>}
      {hasMeta && <div className="zero-blog-hero-meta"><BlogPostMeta post={{ id: '', slug: '', title, author, publishedAt, readingTime }} />{canShare && <SocialShare url={share} title={title} />}</div>}
    </div>;
  const picture = source && variant !== 'compact' ? <img className="zero-blog-hero-image" src={source} alt={featuredImageAlt ?? ''} fetchPriority="high" decoding="async" /> : null;
  return <header className={cn('zero-blog-hero', className)} data-variant={source ? variant : 'compact'} data-height={height} data-overlay={overlay || undefined}>
    {overlay ? <div className="zero-blog-hero-frame">{picture}{showGradient && <div className="zero-blog-hero-scrim" aria-hidden="true" />}{copy}</div> : <>{copy}{picture}</>}
  </header>;
}
export function BlogHeroCompact(props: BlogHeroProps) { return <BlogHero {...props} variant="compact" />; }
export function BlogHeroContained(props: BlogHeroProps) { return <BlogHero {...props} variant="contained" />; }

export interface BlogListPageProps {
  posts: readonly BlogPost[]; recentPosts?: readonly BlogPost[]; categories?: readonly BlogCategory[];
  title?: string; description?: string; variant?: 'magazine' | 'sidebar' | 'list' | 'minimal';
  columns?: 2 | 3 | 4; baseUrl?: string; className?: string; showRecentHero?: boolean;
  pagination?: BlogPaginationState; pageSize?: number; filters?: BlogFilterState; isLoading?: boolean;
  onSearchChange?: (query: string) => void; onCategoryChange?: (id: string | null) => void; onPageChange?: (page: number) => void;
  hrefForPage?: (page: number) => string;
  /** Manual mode displays exactly the passed posts; it never issues a request. */
  filterMode?: 'local' | 'manual'; search?: false | 'palette' | 'inline' | 'dropdown';
  searchResultProps?: Omit<SearchWithResultsProps, 'posts'>;
  searchProps?: Omit<BlogSearchPaletteProps, 'posts' | 'categories'>;
  headerActions?: React.ReactNode; sidebar?: React.ReactNode; children?: React.ReactNode;
  empty?: React.ReactNode;
  /** Retrieval failure is not an empty publication set. Callbacks belong to the actual source. */
  error?: boolean; onRetry?: () => void; onClearFilters?: () => void;
}
export function BlogListPage({ posts, recentPosts, categories = [], title = 'Our blog', description, variant = 'magazine', columns = 3, baseUrl, className,
  showRecentHero = true, pagination, pageSize = 9, filters, isLoading = false, onSearchChange, onCategoryChange, onPageChange, hrefForPage, filterMode = 'local', search = 'palette', searchProps, searchResultProps, headerActions, sidebar, children, empty, error = false, onRetry, onClearFilters }: BlogListPageProps) {
  const scoped = useBlogScope();
  const [localFilters, setFilters] = React.useState<BlogFilterState>({}), [localPage, setPage] = React.useState(1);
  const state = filters ?? localFilters, query = state.search ?? '', category = state.category ?? null;
  const { current, hero, grid, active } = blogListModel({ posts, recentPosts, filters: state, pageSize, localPage, pagination, mode: filterMode,
    showHero: showRecentHero && variant !== 'minimal' && !isLoading && !error });
  const changeSearch = (value: string) => { if (filters === undefined) setFilters(previous => ({ ...previous, search: value })); setPage(1); onSearchChange?.(value); };
  const changeCategory = (id: string | null) => { if (filters === undefined) setFilters(previous => ({ ...previous, category: id })); setPage(1); onCategoryChange?.(id); };
  const changePage = (value: number) => { if (!pagination) setPage(value); onPageChange?.(value); };
  const clearable = filters === undefined || Boolean(onClearFilters) || !state.author && !state.tag
    && (Boolean(query.trim()) && !category && Boolean(onSearchChange) || Boolean(category) && !query.trim() && Boolean(onCategoryChange));
  const clear = () => {
    setPage(1);
    if (filters === undefined) setFilters({});
    if (onClearFilters) { onClearFilters(); return; }
    if (query.trim()) onSearchChange?.(''); if (category) onCategoryChange?.(null);
  };
  const clearAction = active && clearable ? <Button type="button" variant="outline" onClick={clear}>Show all articles</Button> : undefined;
  const emptyState = empty !== undefined ? empty : <EmptyState title={active ? query.trim() ? 'No matching articles' : category ? 'No articles in this category' : 'No articles match these filters' : 'No articles yet'}
    description={active ? 'Try a different search or explore all articles.' : 'New stories will appear here when they are published.'} action={clearAction} />;
  return <div className={cn(!scoped && 'zero-blog', 'zero-public zero-blog-list', className)} data-variant={variant} aria-busy={isLoading && !error}>
    <header className="zero-blog-list-header"><div><Typography variant="h1" balance>{title}</Typography>{description && <Typography variant="lead" color="secondary">{description}</Typography>}</div>{headerActions}</header>
    <div className="zero-blog-list-toolbar">
      {!!categories.length && <CategoryFilter categories={categories} selectedCategory={category} onCategoryChange={changeCategory} />}
      {search && <div className="zero-blog-list-search">{search === 'inline' ? <SearchBar value={query} onChange={changeSearch} isLoading={isLoading && !error} /> : search === 'dropdown' ? <SearchWithResults {...searchResultProps} loading={searchResultProps?.loading ?? isLoading} error={searchResultProps?.error ?? error} onRetry={searchResultProps?.onRetry ?? onRetry} posts={posts} baseUrl={baseUrl ?? searchResultProps?.baseUrl} /> : <BlogSearchPalette {...searchProps} loading={searchProps?.loading ?? isLoading} error={searchProps?.error ?? error} onRetry={searchProps?.onRetry ?? onRetry} baseUrl={baseUrl ?? searchProps?.baseUrl} posts={posts} categories={categories}
        onSelectCategory={searchProps?.onSelectCategory ?? (value => changeCategory(value.id))} />}</div>}
    </div>
    {!!hero.length && <RecentPostsHero posts={hero} baseUrl={baseUrl} onCategoryClick={value => changeCategory(value.id)} />}
    {(grid.length > 0 || hero.length === 0) && <div className="zero-blog-list-body">{variant === 'sidebar' && <aside>{sidebar ?? <CategoryFilter categories={categories} selectedCategory={category} onCategoryChange={changeCategory} />}</aside>}
      <section className="zero-blog-all-posts"><div className="zero-blog-section-heading"><Typography variant="h2">{query.trim() ? `Results for “${query}”` : hero.length ? 'More articles' : 'All blog posts'}</Typography>{!isLoading && !error && <span className="zero-blog-muted">{current.totalItems === undefined ? `${grid.length + hero.length} on this page` : `${current.totalItems} ${current.totalItems === 1 ? 'article' : 'articles'}${hero.length ? ' in total' : ''}`}</span>}</div>
        {error ? <BlogReadError onRetry={onRetry} /> : isLoading ? <BlogGridSkeleton count={Math.min(3, current.itemsPerPage ?? 3)} columns={columns} />
          : <BlogCardGrid posts={grid} columns={columns} baseUrl={baseUrl} variant={variant === 'list' ? 'horizontal' : 'default'} onCategoryClick={value => changeCategory(value.id)} empty={emptyState} />}
      </section>
    </div>}
    {!isLoading && !error && current.totalPages > 1 && <BlogPagination {...current} onPageChange={changePage} hrefForPage={hrefForPage} />}{children}
  </div>;
}
export function BlogListPageSidebar(props: Omit<BlogListPageProps, 'variant'>) { return <BlogListPage {...props} variant="sidebar" />; }
export function BlogListPageList(props: Omit<BlogListPageProps, 'variant'>) { return <BlogListPage {...props} variant="list" />; }
export function BlogListPageMinimal(props: Omit<BlogListPageProps, 'variant'>) { return <BlogListPage {...props} variant="minimal" />; }

export interface BlogPostPageProps {
  post: BlogPost; content?: React.ReactNode; tocItems?: readonly BlogTocItem[]; relatedPosts?: readonly BlogPost[]; recentPosts?: readonly BlogPost[];
  variant?: 'with-sidebar' | 'default' | 'wide' | 'split'; heroStyle?: 'contained' | 'fullwidth' | 'editorial'; shareUrl?: string; baseUrl?: string;
  heroProps?: Pick<BlogHeroProps, 'height' | 'showGradient' | 'showShare'>; relatedPlacement?: 'content' | 'wide';
  showHero?: boolean; showToc?: boolean; showAuthor?: boolean; showRelated?: boolean; showFloatingShare?: boolean;
  className?: string; headerActions?: React.ReactNode; sidebar?: React.ReactNode; newsletter?: React.ReactNode; footer?: React.ReactNode;
}
export function BlogPostPage({ post, content, tocItems, relatedPosts = [], recentPosts = [], variant = 'with-sidebar', heroStyle = 'contained', heroProps, relatedPlacement = 'content', shareUrl, baseUrl,
  showHero = true, showToc = true, showAuthor = true, showRelated = true, showFloatingShare = true, className, headerActions, sidebar, newsletter, footer }: BlogPostPageProps) {
  const scoped = useBlogScope();
  const [contentRoot, setContentRoot] = React.useState<HTMLDivElement | null>(null), [autoToc, setAutoToc] = React.useState<BlogTocItem[]>([]);
  const share = safeBlogHref(shareUrl), canShare = share && /^https?:/u.test(share);
  const seed = React.useId().replace(/[^a-zA-Z0-9]/gu, '');
  const suppliedToc = tocItems ?? post.toc ?? (content === undefined && post.blocks ? blogBlockToc(post.blocks) : undefined);
  React.useEffect(() => {
    if (!contentRoot || suppliedToc || !showToc) return;
    const read = () => {
      const entries = [...contentRoot.querySelectorAll<HTMLElement>('h2,h3,h4,h5,h6')].slice(0, 500).map((element, index) => {
        if (!element.id) element.id = `blog-${seed}-${blogHeadingId(element.textContent ?? '', index)}`;
        return { id: element.id, text: element.textContent ?? '', level: Number(element.tagName.slice(1)) };
      });
      setAutoToc(previous => JSON.stringify(previous) === JSON.stringify(entries) ? previous : entries);
    };
    read(); const observer = new MutationObserver(read); observer.observe(contentRoot, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [contentRoot, suppliedToc, seed, showToc, post.id]);
  const entries = suppliedToc ?? autoToc, withSidebar = variant === 'with-sidebar';
  const recommendations = uniqueBlogPosts(relatedPosts, post.id), recent = uniqueBlogPosts(recentPosts, post.id);
  const related = recommendations.length ? recommendations : recent;
  return <article className={cn(!scoped && 'zero-blog', 'zero-public zero-blog-post', className)} data-variant={variant}>
    {headerActions && <div className="zero-blog-header-actions">{headerActions}</div>}
    {showHero && <BlogHero {...heroProps} title={post.title} excerpt={post.excerpt} featuredImage={post.featuredImage} featuredImageAlt={post.featuredImageAlt}
      author={post.author} publishedAt={post.publishedAt} readingTime={post.readingTime} categories={post.categories} shareUrl={shareUrl}
      variant={variant === 'split' ? 'split' : heroStyle} />}
    <div className="zero-blog-article-body" data-sidebar={withSidebar || undefined}>
      {withSidebar && <div className="zero-blog-article-spacer" aria-hidden="true" />}
      <div className="zero-blog-article-main">
        {showToc && !!entries.length && <div className={withSidebar ? 'zero-blog-inline-toc' : undefined}><TableOfContents items={entries} contentRoot={contentRoot} collapsible defaultCollapsed /></div>}
        <div ref={setContentRoot}><Prose>{content ?? (post.blocks ? <BlockRenderer blocks={post.blocks} /> : null)}</Prose></div>
        {!!post.tags?.length && <div className="zero-blog-tags" aria-label="Article tags">{post.tags.map(tag => tag.href ? <BlogLink key={tag.id} href={tag.href}>{tag.name}</BlogLink> : <span key={tag.id}>{tag.name}</span>)}</div>}
        {canShare && <section className="zero-blog-share-section"><Typography variant="label">Share this article</Typography><SocialShare url={share} title={post.title} /></section>}
        {showAuthor && post.author && <AuthorCardFeatured author={post.author} />}
        {newsletter}
        {showRelated && relatedPlacement === 'content' && !!related.length && <RelatedPosts posts={related} baseUrl={baseUrl} title={recommendations.length ? 'Related articles' : 'Recent articles'} />}
      </div>
      {withSidebar && <aside className="zero-blog-article-sidebar">{showToc && <TableOfContentsSidebar items={entries} contentRoot={contentRoot} />}{sidebar}</aside>}
    </div>
    {showRelated && relatedPlacement === 'wide' && !!related.length && <RelatedPosts posts={related} baseUrl={baseUrl} title={recommendations.length ? 'Related articles' : 'Recent articles'} />}
    {showFloatingShare && canShare && <aside className="zero-blog-floating-share" aria-label="Article sharing"><SocialShare url={share} title={post.title} platforms={[]} /></aside>}
    {footer}
  </article>;
}
export function BlogPostPageWithSidebar(props: Omit<BlogPostPageProps, 'variant'>) { return <BlogPostPage {...props} variant="with-sidebar" />; }
export function BlogPostPageWide(props: Omit<BlogPostPageProps, 'variant'>) { return <BlogPostPage {...props} variant="wide" />; }
export function BlogPostPageSplit(props: Omit<BlogPostPageProps, 'variant'>) { return <BlogPostPage {...props} variant="split" />; }

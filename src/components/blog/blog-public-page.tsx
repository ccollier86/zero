'use client';

/** Managed public reader: existing Magazine/article components, real FTS search, no privileged AppProvider or copied app shell. */
import * as React from 'react';
import { BlogProvider } from './blog-provider';
import { BlogListPage, BlogPostPage } from './blog-layouts';
import { BlogSearchPalette } from './blog-search';
import { presentPublishedBlogPost } from '../../blog/presentation';
import { createPublicBlogClient } from '../../frontend/client/blog-client';
import { serializeBlogPage, type BlogPublicPageModel } from '../../blog/public-page-model';
import type { BlogPost } from './blog.types';
import { ModalManager } from '../../modals/modal-manager';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useBlogPublicObservations } from './blog-public-observations';

/** Preserve native hrefs/new tabs and useful SSR; enhancement only adds component interactions and remote search. */
export function BlogPublicPage(props: BlogPublicPageModel) {
  useBlogPublicObservations(props.metricsEnabled === true, props.site, props.article?.slug);
  const [query, setQuery] = React.useState(''), [results, setResults] = React.useState<readonly BlogPost[]>(props.posts), [loading, setLoading] = React.useState(false), [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!query.trim()) { setResults(props.posts); setLoading(false); setFailed(false); return; }
    const owner = new AbortController(); setLoading(true); setFailed(false);
    const client = createPublicBlogClient(window.location.origin);
    const timer = setTimeout(() => {
      void client.posts(props.site, { search: query, order: 'relevance', limit: 20 }, { signal: owner.signal }).then(page => {
        if (!owner.signal.aborted) setResults(page.items.map(post => presentPublishedBlogPost(post, { site: props.site, basePath: props.basePath })));
      }).catch(() => { if (!owner.signal.aborted) { setFailed(true); setResults([]); } }).finally(() => { if (!owner.signal.aborted) setLoading(false); });
    }, 180);
    return () => { clearTimeout(timer); owner.abort(); };
  }, [props.site, props.basePath, props.posts, query]);
  const href = (values: { page?: number; search?: string; category?: string | null; tag?: string | null }) => {
    const next = { ...props.query, ...values }, params = new URLSearchParams();
    if (next.search) params.set('search', next.search);
    if (next.category) params.set('category', next.category);
    if (next.tag) params.set('tag', next.tag);
    if (next.page > 1) params.set('page', String(next.page));
    return props.basePath + (params.size ? '?' + params : '');
  };
  const search = <BlogSearchPalette posts={results} categories={[]} baseUrl={props.basePath} query={query} onQueryChange={setQuery} filterMode="manual" loading={loading}
    empty={failed ? 'Search is unavailable. Try again or use the article search below.' : 'No matching articles.'} shortcut />;
  return <ModalManager recedeSurface={false}><BlogProvider baseUrl={props.basePath}><main className="zero-blog-public-page zero-public">
    <nav className="zero-blog-public-header" aria-label="Blog"><a href={props.basePath}>{props.siteName}</a>{props.article && search}</nav>
    {props.article ? <BlogPostPage post={props.article} relatedPosts={props.posts} shareUrl={props.canonical} /> : <>
      <BlogListPage posts={props.posts} title={props.title ?? props.siteName} description={props.description} categories={props.categories} filterMode="manual" search={false} headerActions={search}
        filters={{ search: props.query.search, category: props.query.category, tag: props.query.tag ?? undefined }}
        onCategoryChange={category => window.location.assign(href({ category, page: 1 }))}
        pagination={{ currentPage: props.query.page, totalPages: Math.max(1, Math.ceil(props.total / props.pageSize)), totalItems: props.total, itemsPerPage: props.pageSize }}
        hrefForPage={page => href({ page })} onPageChange={page => window.location.assign(href({ page }))} />
      <form action={props.basePath} method="get" className="zero-blog-public-search-form"><label>Search all articles<Input type="search" name="search" defaultValue={props.query.search} maxLength={256} /></label><Button type="submit" variant="outline">Search</Button></form>
      <noscript><nav aria-label="Article categories">{props.categories.map(category => <a key={category.id} href={href({ category: category.id, page: 1 })}>{category.name}</a>)}</nav></noscript>
    </>}
    <script type="application/json" nonce={props.nonce} id="zero-blog-page-props" dangerouslySetInnerHTML={{ __html: serializeBlogPage(props) }} />
  </main></BlogProvider></ModalManager>;
}

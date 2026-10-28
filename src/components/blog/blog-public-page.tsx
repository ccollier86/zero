'use client';

/** Managed public reader: existing Magazine/article components, real FTS search, no privileged AppProvider or copied app shell. */
import * as React from 'react';
import { BlogProvider } from './blog-provider';
import { BlogListPage, BlogPostPage } from './blog-layouts';
import { BlogSearchPalette } from './blog-search';
import { serializeBlogPage, type BlogPublicPageModel } from '../../blog/public-page-model';
import { ModalManager } from '../../modals/modal-manager';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { useBlogPublicObservations } from './blog-public-observations';
import { useBlogPublicSearch } from './use-blog-public-search';

/** Preserve native hrefs/new tabs and useful SSR; enhancement only adds component interactions and remote search. */
export function BlogPublicPage(props: BlogPublicPageModel) {
  useBlogPublicObservations(props.metricsEnabled === true, props.site, props.article?.slug);
  const [query, setQuery] = React.useState('');
  const searchState = useBlogPublicSearch({ site: props.site, basePath: props.basePath, posts: props.posts, query });
  const href = (values: { page?: number; search?: string; category?: string | null; tag?: string | null }) => {
    const next = { ...props.query, ...values }, params = new URLSearchParams();
    if (next.search) params.set('search', next.search);
    if (next.category) params.set('category', next.category);
    if (next.tag) params.set('tag', next.tag);
    if (next.page > 1) params.set('page', String(next.page));
    return props.basePath + (params.size ? '?' + params : '');
  };
  const search = <BlogSearchPalette posts={searchState.posts} categories={[]} baseUrl={props.basePath} query={query} onQueryChange={setQuery} filterMode="manual" loading={searchState.loading}
    error={searchState.error} onRetry={searchState.retry} catalogEmpty={!props.article && !props.query.search && !props.query.category && !props.query.tag && props.total === 0} shortcut />;
  return <ModalManager recedeSurface={false}><BlogProvider baseUrl={props.basePath}><main className="zero-blog-public-page zero-public">
    <nav className="zero-blog-public-header" aria-label="Blog"><a href={props.basePath}>{props.siteName}</a>{props.article && search}</nav>
    {props.article ? <BlogPostPage post={props.article} relatedPosts={props.posts} shareUrl={props.canonical} /> : <>
      <BlogListPage posts={props.posts} title={props.title ?? props.siteName} description={props.description} categories={props.categories} filterMode="manual" search={false} headerActions={search}
        filters={{ search: props.query.search, category: props.query.category, tag: props.query.tag ?? undefined }}
        onCategoryChange={category => window.location.assign(href({ category, page: 1 }))}
        onClearFilters={() => window.location.assign(href({ search: '', category: null, tag: null, page: 1 }))}
        pagination={{ currentPage: props.query.page, totalPages: Math.max(1, Math.ceil(props.total / props.pageSize)), totalItems: props.total, itemsPerPage: props.pageSize }}
        hrefForPage={page => href({ page })} onPageChange={page => window.location.assign(href({ page }))} />
      <form action={props.basePath} method="get" className="zero-blog-public-search-form"><label>Search all articles<Input type="search" name="search" defaultValue={props.query.search} maxLength={256} /></label><Button type="submit" variant="outline">Search</Button></form>
      <noscript><nav aria-label="Article categories">{props.categories.map(category => <a key={category.id} href={href({ category: category.id, page: 1 })}>{category.name}</a>)}</nav></noscript>
    </>}
    <script type="application/json" nonce={props.nonce} id="zero-blog-page-props" dangerouslySetInnerHTML={{ __html: serializeBlogPage(props) }} />
  </main></BlogProvider></ModalManager>;
}

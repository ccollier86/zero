/** Sparse/unknown/retrieval states are presentation, never fabricated articles or global server counts. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlogListPage } from './blog-layouts';
import { BlogCardGrid, RecentPostsHero } from './blog-cards';
import { BlogGridSkeleton } from './blog-states';
import { blogListModel } from './blog-list-model';
import type { BlogPost } from './blog.types';

const posts: BlogPost[] = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, slug: `story-${index}`, title: `Story ${index}`,
  author: { id: 'writer', name: 'Writer' }, categories: [{ id: 'design', slug: 'design', name: 'Design' }], tags: [{ id: 'systems', slug: 'systems', name: 'Systems' }] }));
const model = (extra: Partial<Parameters<typeof blogListModel>[0]> = {}) => blogListModel({ posts, filters: {}, mode: 'local', pageSize: 9, localPage: 1, showHero: true, ...extra });

test('zero to many articles use real unique page slots without repeating featured cards', () => {
  for (const count of [0, 1, 2, 3, 4, 12]) {
    const source = Object.freeze(posts.slice(0, count)), state = model({ posts: source });
    expect(state.current.totalItems).toBe(count);
    expect(state.hero.length).toBe(Math.min(count, 3));
    const shown = [...state.hero, ...state.grid].map(post => post.id);
    expect(shown).toEqual(source.slice(0, 9).map(post => post.id));
    expect(new Set(shown).size).toBe(shown.length);
    const html = renderToStaticMarkup(<BlogListPage posts={source} search={false} />);
    if (count <= 3 && count > 0) { expect(html).not.toContain('All blog posts'); expect(html).not.toContain('zero-blog-all-posts'); }
    if (!count) { expect(html).toContain('No articles yet'); expect(html).not.toContain('zero-blog-card-content'); }
    expect(source).toHaveLength(count);
  }
});
test('one-slot paging and later pages do not lose articles or repeat the first hero', () => {
  const first = model({ pageSize: 1 }); expect(first.hero).toEqual([posts[0]!]); expect(first.grid).toEqual([]); expect(first.current.totalPages).toBe(12);
  const second = model({ pageSize: 1, localPage: 2 }); expect(second.hero).toEqual([]); expect(second.grid).toEqual([posts[1]!]);
  const last = model({ localPage: 99 }); expect(last.current.currentPage).toBe(2); expect(last.grid).toEqual(posts.slice(9));
  const html = renderToStaticMarkup(<BlogListPage posts={posts} pageSize={1} search={false} />);
  expect(html).toContain('Page 2'); expect(html).not.toContain('zero-blog-all-posts');
});
test('server counts and ranking are authoritative; an uncounted manual page never invents a global total', () => {
  const pagination = { currentPage: 2, totalPages: 10, totalItems: 95, itemsPerPage: 10 };
  const state = model({ mode: 'manual', posts: posts.slice(0, 2), filters: { search: 'not in the title' }, pagination });
  expect(state.current).toBe(pagination); expect(state.grid).toEqual(posts.slice(0, 2)); expect(state.hero).toEqual([]);
  const html = renderToStaticMarkup(<BlogListPage posts={posts.slice(0, 2)} filterMode="manual" showRecentHero={false} search={false} />);
  expect(html).toContain('2 on this page'); expect(html).not.toContain('2 articles');
});
test('local filters and independent recent sources never advertise unrelated featured stories', () => {
  for (const filters of [{ search: 'missing' }, { category: 'other' }, { author: 'other' }, { tag: 'other' }]) {
    const state = model({ filters, recentPosts: posts }); expect(state.hero).toEqual([]); expect(state.grid).toEqual([]);
  }
  const state = model({ posts: [posts[0]!, posts[0]!, posts[1]!], recentPosts: [posts[0]!, posts[0]!] });
  expect(state.hero).toEqual([posts[0]!]); expect(state.grid).toEqual([posts[1]!]); expect(state.current.totalItems).toBe(2);
});
test('native skeletons represent pending reads and have one accessible status instead of a false zero', () => {
  const html = renderToStaticMarkup(<BlogListPage posts={[]} isLoading search={false} />);
  expect(html).toContain('aria-busy="true"'); expect(html).toContain('Loading articles'); expect(html).toContain('data-slot="blog-card-skeleton"');
  expect(html).not.toContain('No articles yet'); expect(html).not.toContain('0 articles'); expect(html).not.toContain('href="/blog/');
  const bounded = renderToStaticMarkup(<BlogGridSkeleton count={1000} />); expect(bounded.match(/data-slot="blog-card-skeleton"/g)).toHaveLength(12);
  expect(bounded.match(/role="status"/g)).toHaveLength(1);
});
test('retrieval failure takes precedence over pending or empty, and retry/reset are only real supplied actions', () => {
  const html = renderToStaticMarkup(<BlogListPage posts={[]} error isLoading onRetry={() => {}} search={false} />);
  expect(html).toContain('aria-busy="false"'); expect(html).toContain('role="alert"'); expect(html).toContain('Try again');
  expect(html).not.toContain('No articles yet'); expect(html).not.toContain('Loading articles'); expect(html).not.toContain('0 articles');
  const noRetry = renderToStaticMarkup(<BlogListPage posts={[]} error search={false} />); expect(noRetry).not.toContain('>Try again</button>');
  const filtered = renderToStaticMarkup(<BlogListPage posts={[]} filters={{ search: 'orchid' }} search={false} />);
  expect(filtered).toContain('No matching articles'); expect(filtered).not.toContain('Show all articles');
  const clearable = renderToStaticMarkup(<BlogListPage posts={[]} filters={{ search: 'orchid', author: 'writer' }} onClearFilters={() => {}} search={false} />);
  expect(clearable).toContain('Show all articles');
});
test('standalone card compositions deduplicate and size their actual one/two article content', () => {
  for (const count of [1, 2]) {
    const html = renderToStaticMarkup(<BlogCardGrid posts={[...posts.slice(0, count), posts[0]!]} />);
    expect(html).toContain(`data-columns="${count}"`); expect(html).toContain(`data-count="${count}"`);
    expect(html.match(/zero-blog-card-content/g)).toHaveLength(count);
    const hero = renderToStaticMarkup(<RecentPostsHero posts={[...posts.slice(0, count), posts[0]!]} />);
    expect(hero).toContain(`data-count="${count}"`); expect(hero.match(/zero-blog-card-content/g)).toHaveLength(count);
  }
});

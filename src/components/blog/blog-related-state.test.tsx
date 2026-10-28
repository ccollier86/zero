/** First-post recommendation states use real identities, never self-links or artificial loading cards. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RelatedPosts } from './blog-cards';
import { BlogPostPage } from './blog-layouts';
import { uniqueBlogPosts } from './blog-post-list';
import type { BlogPost } from './blog.types';
const first: BlogPost = { id: 'one', slug: 'first', title: 'First article' };
const next: BlogPost = { id: 'two', slug: 'next', title: 'Another article' };
test('an empty or self-only recommendation set produces no heading or placeholder', () => {
  expect(renderToStaticMarkup(<RelatedPosts posts={[]} />)).toBe('');
  expect(renderToStaticMarkup(<RelatedPosts posts={[first, first]} excludePostId={first.id} />)).toBe('');
  const html = renderToStaticMarkup(<BlogPostPage post={first} relatedPosts={[first]} recentPosts={[first]} />);
  expect(html).not.toContain('zero-blog-related'); expect(html).not.toContain('href="/blog/first"');
});
test('one real recommendation is not repeated when it arrives from overlapping source pages', () => {
  const html = renderToStaticMarkup(<RelatedPosts posts={[next, next]} />);
  expect(html.match(/href="\/blog\/next"/g)).toHaveLength(1);
  expect(html).toContain('Related articles');
});
test('recent articles remain a fallback when all supplied related entries are the current article', () => {
  for (const relatedPlacement of ['content', 'wide'] as const) {
    const html = renderToStaticMarkup(<BlogPostPage post={first} relatedPosts={[first]} recentPosts={[first, next, next]} relatedPlacement={relatedPlacement} />);
    expect(html).toContain('Recent articles'); expect(html).not.toContain('Related articles');
    expect(html.match(/href="\/blog\/next"/g)).toHaveLength(1); expect(html).not.toContain('href="/blog/first"');
  }
});
test('presentation filtering preserves source arrays, order and caller-disabled related sections', () => {
  const source = Object.freeze([first, next, first, { ...next, title: 'Later duplicate' }]);
  expect(uniqueBlogPosts(source)).toEqual([first, next]); expect(source).toHaveLength(4);
  const html = renderToStaticMarkup(<BlogPostPage post={first} relatedPosts={[next]} showRelated={false} />);
  expect(html).not.toContain('zero-blog-related');
});

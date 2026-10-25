/** SSR contracts, omissions and data-only helpers. No application/database/provider calls. */
import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BlogProvider, BlogLink, BlogListPage, BlogPostPage, AuthorCard, NewsletterSignup, SocialShare, BlockRenderer, BlogPagination } from './index';
import { blogBlockToc, blogPageWindow, blogPostHref, safeBlogHref } from './blog-utils';
import type { BlogPost } from './blog.types';
const post: BlogPost = { id: 'one', slug: 'first-article', title: 'A real article', excerpt: 'A public excerpt', blocks: [{ type: 'heading', text: 'Introduction', level: 2 }, { type: 'paragraph', text: 'Readable without JavaScript.' }] };

test('the unconfigured list is Magazine and the article defaults to the sidebar TOC view', () => {
  const listing = renderToStaticMarkup(<BlogListPage posts={[post]} />);
  expect(listing).toContain('data-variant="magazine"'); expect(listing).toContain('Recent blog posts'); expect(listing).toContain('/blog/first-article');
  const article = renderToStaticMarkup(<BlogPostPage post={post} />);
  expect(article).toContain('data-variant="with-sidebar"'); expect(article).toContain('zero-blog-article-sidebar'); expect(article).toContain('On this page');
  expect(article).toContain('Readable without JavaScript.'); expect(article).toContain('href="#introduction-1"');
  expect(article).not.toContain('Switch to'); expect(article).not.toContain('Share this article'); expect(article).not.toContain('zero-blog-author-card');
  expect(article).not.toContain('zero-blog-hero-meta'); expect(article).not.toContain('class="zero-blog-meta"');
  expect(renderToStaticMarkup(<BlogPostPage post={post} shareUrl="javascript:bad()" />)).not.toContain('Share this article');
});
test('missing social/profile/newsletter integrations do not invent UI or claims', () => {
  const author = renderToStaticMarkup(<BlogProvider><AuthorCard author={{ id: 'a', name: 'Avery' }} /></BlogProvider>);
  expect(author).toContain('Avery'); expect(author).not.toContain('social links'); expect(author).not.toContain('href=');
  expect(renderToStaticMarkup(<NewsletterSignup />)).toBe(''); expect(renderToStaticMarkup(<SocialShare title="No URL" />)).toBe('');
  expect(renderToStaticMarkup(<SocialShare url="javascript:alert(1)" />)).toBe('');
});
test('metadata and URLs remain text and escaped links; raw HTML is not an admitted content block', () => {
  const article = renderToStaticMarkup(<BlogPostPage post={{ ...post, title: '<script>bad()</script>' }} content={<BlockRenderer blocks={[{ type: 'paragraph', text: '<script>bad()</script>' }, { type: 'embed', url: 'javascript:alert(1)', title: 'Unsafe' }]} />} />);
  expect(article).not.toContain('<script>bad()'); expect(article).toContain('&lt;script&gt;bad()'); expect(article).not.toContain('href="javascript:');
  for (const href of ['//evil.invalid', 'javascript:alert(1)', 'https://user:password@host.invalid', '/bad\\path', '/bad\npath']) expect(safeBlogHref(href)).toBeUndefined();
  expect(blogPostHref({ ...post, slug: 'a/b' })).toBe('/blog/a%2Fb');
});
test('toc and bounded pagination helpers preserve identity without executing content', () => {
  expect(blogBlockToc(post.blocks!)).toEqual([{ id: 'introduction-1', text: 'Introduction', level: 2 }]);
  expect(blogPageWindow(500000, 1000000).length).toBeLessThanOrEqual(9);
  expect(blogPageWindow(1, 2)).toEqual([1, 2]); expect(blogPageWindow(NaN, NaN)).toEqual([1]);
  const html = renderToStaticMarkup(<BlogPagination currentPage={1} totalPages={12} />);
  expect(html).toContain('data-variant="editorial"'); expect(html).toContain('aria-current="page"'); expect(html).toContain('aria-disabled="true"');
});
test('link adaptation is optional and instance-local; nested layouts retain scoped token overrides', () => {
  function AppLink(props: React.ComponentProps<'a'>) { return <a {...props} data-app-link="" />; }
  const one = renderToStaticMarkup(<BlogProvider linkComponent={AppLink} baseUrl="/articles" style={{ '--zero-blog-type-prose': '20px' } as React.CSSProperties}><BlogListPage posts={[post]} search={false} /></BlogProvider>);
  const two = renderToStaticMarkup(<BlogListPage posts={[post]} search={false} />);
  expect(one).toContain('data-app-link=""'); expect(one).toContain('/articles/first-article'); expect(one.match(/class="zero-blog /gu)).toHaveLength(1);
  expect(two).not.toContain('data-app-link'); expect(two).toContain('/blog/first-article');
  expect(renderToStaticMarkup(<BlogLink href="https://example.test" target="_blank" rel="ugc nofollow">Source</BlogLink>)).toContain('rel="ugc nofollow noopener noreferrer"');
});
test('supplied author and tag filters narrow local rows without advertising unfiltered recent content', () => {
  const selected = { ...post, author: { id: 'a', name: 'Avery' }, tags: [{ id: 'systems', slug: 'systems', name: 'Systems' }] };
  const other = { ...post, id: 'two', title: 'Another author article', author: { id: 'b', name: 'Blair' } };
  const html = renderToStaticMarkup(<BlogListPage posts={[selected, other]} filters={{ author: 'a', tag: 'systems' }} search={false} />);
  expect(html).toContain('A real article'); expect(html).not.toContain('Another author article'); expect(html).not.toContain('Recent blog posts');
});

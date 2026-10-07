/** SSR publication remains readable without JavaScript or an authenticated app provider. */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DocsPageProps } from './types';
import { DocsApp } from './docs-app';
import { serializeDocsProps } from './serialization';

export const readerFixture: DocsPageProps = {
  presentation: { title: 'Zero documentation', basePath: '/docs', breadcrumbs: false, search: true, toc: true,
    pageNavigation: true, headerLinks: [{ label: 'Home', href: '/' }], themeStorageKey: 'zero-docs-test' },
  page: { sourcePath: 'guide.md', route: '/docs/guide', title: 'Build an app', titleHeadingId: 'build-an-app',
    description: 'A useful introduction.', navigation: { label: 'Build an app', hidden: false }, searchable: true,
    headings: [{ id: 'build-an-app', text: 'Build an app', depth: 1 }, { id: 'setup', text: 'Setup', depth: 2 }],
    body: { type: 'root', children: [{ type: 'heading', depth: 1, id: 'build-an-app', children: [{ type: 'text', value: 'Build an app' }] },
      { type: 'paragraph', children: [{ type: 'text', value: 'A useful introduction.' }] },
      { type: 'heading', depth: 2, id: 'setup', children: [{ type: 'text', value: 'Setup' }] },
      { type: 'code', value: 'const app = "Zero";', code: { language: 'ts' } },
      { type: 'callout', tone: 'tip', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Reuse the existing controls.' }] }] },
      { type: 'paragraph', children: [{ type: 'text', value: '<script>alert("never executed")</script>' }] }] },
    markdown: '# Build an app\n\nA useful introduction.', text: 'A useful introduction.', hash: 'fixture', assets: [], generated: false, metadata: {} },
  navigation: [{ type: 'page', label: 'Documentation', route: '/docs' },
    { type: 'group', label: 'Getting started', route: '/docs/start', children: [{ type: 'page', label: 'Build an app', route: '/docs/guide' }] }],
  highlights: [null], previous: { title: 'Overview', route: '/docs' }, next: { title: 'Organization apps', route: '/docs/organizations' },
};

describe('DocsApp public reader SSR', () => {
  test('real content, rails/nav headings and previous/next titles are present without session restoration', () => {
    const html = renderToStaticMarkup(createElement(DocsApp, readerFixture));
    expect(html).toContain('aria-label="Documentation"'); expect(html).toContain('zero-docs-nav-children');
    expect(html).toContain('aria-current="page"'); expect(html).toContain('aria-label="On this page"');
    expect(html).toContain('id="setup"'); expect(html).toContain('Reuse the existing controls.');
    expect(html).toContain('rel="prev"'); expect(html).toContain('Organization apps');
    expect(html).not.toContain('Restoring your secure session'); expect(html).not.toContain('data-slot="breadcrumb"');
    expect(html).toContain('data-slot="kbd"');
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html.match(/<p>A useful introduction\.<\/p>/gu)).toHaveLength(1);
    expect(html).toContain('&lt;script&gt;alert');
  });
  test('explicit breadcrumbs and presentation switches have one consistent SSR tree', () => {
    const html = renderToStaticMarkup(createElement(DocsApp, { ...readerFixture,
      presentation: { ...readerFixture.presentation, breadcrumbs: true, search: false, toc: false, pageNavigation: false } }));
    expect(html).toContain('data-slot="breadcrumb"'); expect(html).not.toContain('zero-docs-search-trigger');
    expect(html).not.toContain('aria-label="On this page"'); expect(html).not.toContain('rel="next"');
  });
  test('inert props escape script termination and preserve Unicode/code exactly', () => {
    const input = { value: '</script><script>attack()</script>\u2028\u2029🦊' }, serialized = serializeDocsProps(input);
    expect(serialized).not.toContain('</script>'); expect(serialized).not.toContain('\u2028');
    expect(JSON.parse(serialized)).toEqual(input);
  });
  test('inline code is valid phrasing content rather than a nested block component', () => {
    const props: DocsPageProps = { ...readerFixture, page: { ...readerFixture.page, body: { type: 'root', children: [
      { type: 'paragraph', children: [{ type: 'text', value: 'Use ' }, { type: 'inlineCode', value: 'docs()' }, { type: 'text', value: ' in an extension.' }] },
    ] } } };
    const html = renderToStaticMarkup(createElement(DocsApp, props));
    expect(html).toContain('<p>Use <code class="zero-docs-inline-code">docs()</code> in an extension.</p>');
    expect(html).not.toContain('zero-code-block-inline');
  });
});

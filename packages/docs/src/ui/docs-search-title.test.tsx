/** Search targets and visible reader titles/descriptions agree with the compiler projection. */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileDocsContent } from '../content/compile';
import { docsFixture } from '../content/test-fixture';
import { searchDocs } from '../server/search';
import { DocsApp } from './docs-app';
import type { DocsManifest } from '../content/types';
import type { DocsPageProps } from './types';

function props(manifest: DocsManifest): DocsPageProps {
  return { page: manifest.pages.find(page => !page.generated)!, navigation: manifest.navigation, highlights: [], presentation: {
    title: 'Documentation', basePath: '/docs', breadcrumbs: false, search: true, toc: true, pageNavigation: true,
    headerLinks: [], themeStorageKey: 'docs-title-unit',
  } };
}

describe('visible documentation search projection', () => {
  test('a different frontmatter title does not hide the still-searchable authored first H1', async () => {
    const fixture = await docsFixture({ 'index.md': '---\ntitle: Public title\n---\n# Source heading\n\nDetails.' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root }), value = props(manifest);
      const result = searchDocs(manifest, 'Source heading')[0]!;
      expect(value.page.titleHeadingId).toBeUndefined();
      const html = renderToStaticMarkup(createElement(DocsApp, value));
      expect(html).toContain('>Public title</h1>');
      expect(html).toContain(`id="source-heading" class="zero-docs-heading" data-docs-passage="${result.passageId}"`);
      expect(result.route).toBe('/docs#source-heading'); expect(result.excerpt).toBe('Source heading');
    } finally { await fixture.close(); }
  });
  test('the inferred matching H1 is rendered only once with the original passage and heading anchor', async () => {
    const fixture = await docsFixture({ 'index.md': '# Matching title\n\nDetails.' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root }), result = searchDocs(manifest, 'Matching title')[0]!;
      const html = renderToStaticMarkup(createElement(DocsApp, props(manifest)));
      expect(html.match(/<h1\b/gu)).toHaveLength(1);
      expect(html).toContain(`<h1 id="matching-title" data-docs-passage="${result.passageId}">Matching title</h1>`);
    } finally { await fixture.close(); }
  });
  test('a long inferred introduction is not duplicated as a separate metadata description', async () => {
    const fixture = await docsFixture({ 'index.md': '# Home\n\n' + 'A useful introduction. '.repeat(20) });
    try {
      const value = props(await compileDocsContent({ contentDir: fixture.root }));
      expect(value.page.description).toHaveLength(240);
      expect(renderToStaticMarkup(createElement(DocsApp, value)).includes('data-docs-description')).toBe(false);
    } finally { await fixture.close(); }
  });
  test('a distinct configured description is visible and searchable instead of becoming an invisible metadata-only hit', async () => {
    const fixture = await docsFixture({ 'index.md': '---\ndescription: Metadata needle for visitors.\n---\n# Home\n\nSeparate introduction.' });
    try {
      const manifest = await compileDocsContent({ contentDir: fixture.root }), result = searchDocs(manifest, 'needle')[0]!;
      expect(result.passageId).toBeUndefined(); expect(result.excerpt).toContain('Metadata needle');
      expect(renderToStaticMarkup(createElement(DocsApp, props(manifest)))).toContain('data-docs-description="true">Metadata needle for visitors.</p>');
    } finally { await fixture.close(); }
  });
});

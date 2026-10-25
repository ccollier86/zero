import { describe, expect, test } from 'bun:test';
import { mergePageMetadata, renderSeoMetadata } from './metadata';
import { createSeoRuntime, renderRobotsTxt, resolveSeoConfig } from './runtime';
import { serializeSeoJson } from './validation';
import type { SeoJson } from './types';

describe('shared SEO metadata', () => {
  test('renders complete escaped cards, canonical, alternates and nonce-bearing safe JSON-LD', () => {
    const defaults = resolveSeoConfig({ title: 'Site', titleTemplate: '%s · Site', description: 'Default',
      openGraph: { siteName: 'Site', images: [{ url: '/card.png', width: 1200, height: 630, alt: 'A "card"' }] }, twitter: {} }, 'https://public.example');
    const result = renderSeoMetadata({ title: 'Page <safe>', description: '"quoted" & safe',
      alternates: { languages: { en: '/page', 'x-default': '/page' } },
      jsonLd: { '@context': 'https://schema.org', '@type': 'WebPage', name: '</script><script>attack()</script>' } },
      { defaults, requestUrl: 'https://hostile.example/page?secret=not-canonical', siteUrl: 'https://public.example', nonce: 'nonce' });
    expect(result.canonical).toBe('https://public.example/page');
    expect(result.head).toContain('<title>Page &lt;safe&gt; · Site</title>');
    expect(result.head).toContain('property="og:image" content="https://public.example/card.png"');
    expect(result.head).toContain('property="og:image:width" content="1200"');
    expect(result.head).toContain('name="twitter:card" content="summary_large_image"');
    expect(result.head).toContain('hreflang="x-default" href="https://public.example/page"');
    expect(result.head).toContain('type="application/ld+json" nonce="nonce"');
    expect(result.head).not.toContain('</script><script>');
    expect(result.head).not.toContain('hostile.example'); expect(result.head).not.toContain('secret=');
    expect(result.headers['X-Robots-Tag']).toBe('index, follow');
  });

  test('retains old title/description behavior without implicit Host-derived canonical or cards', () => {
    const result = renderSeoMetadata({ title: 'Legacy', description: 'Still works' }, { requestUrl: 'https://attacker.example/page' });
    expect(result.head).toBe('<title>Legacy</title>\n<meta name="description" content="Still works">');
    expect(result.headers).toEqual({}); expect(result.canonical).toBeUndefined();
    expect(renderSeoMetadata({ title: '$&' }, { requestUrl: 'https://example.test', defaults: { titleTemplate: '%s · Site' } }).head).toContain('$&amp; · Site');
  });

  test('merges root/layout/page metadata while false suppresses inherited cards', () => {
    const result = mergePageMetadata({ title: 'Root', description: 'Default', openGraph: { siteName: 'Site', images: ['/image'] } },
      { title: 'Layout', openGraph: { type: 'article' } }, { title: 'Page', twitter: false });
    expect(result).toEqual({ title: 'Page', description: 'Default', openGraph: { siteName: 'Site', images: ['/image'], type: 'article' }, twitter: false });
    expect(mergePageMetadata(result, { openGraph: false }).openGraph).toBe(false);
    const unsafe = JSON.parse('{"__proto__":{"polluted":true},"title":"Safe"}');
    expect(mergePageMetadata(unsafe)).toEqual({ title: 'Safe' });
  });

  test('global preview/protected/error constraints cannot be weakened by page indexing flags', () => {
    for (const options of [{ defaults: { indexing: false } }, { indexable: false }, { status: 404 }]) {
      const result = renderSeoMetadata({ robots: { index: true, follow: true }, canonical: 'https://public.example/page' },
        { ...options, requestUrl: 'https://request.example/page' });
      expect(result.indexable).toBe(false); expect(result.headers['X-Robots-Tag']).toBe('noindex, nofollow');
      if ('status' in options) expect(result.canonical).toBeUndefined();
    }
  });

  test('supports explicit canonical queries, base paths, card opt-out and robot preview controls', () => {
    expect(renderSeoMetadata({ robots: { index: false, follow: true } }, { requestUrl: 'https://public.test' }).robots).toBe('noindex, follow');
    const result = renderSeoMetadata({ canonical: '/page?lang=en#fragment', openGraph: false, twitter: false,
      robots: { index: false, follow: false, maxSnippet: -1, maxImagePreview: 'large', maxVideoPreview: 0 } },
      { defaults: { openGraph: {}, twitter: {} }, siteUrl: 'https://public.example/base', requestUrl: 'https://request.example/page' });
    expect(result.canonical).toBe('https://public.example/base/page?lang=en');
    expect(result.head).not.toContain('og:'); expect(result.head).not.toContain('twitter:');
    expect(result.robots).toContain('max-snippet:-1'); expect(result.robots).toContain('max-video-preview:0');
  });

  test('rejects unsafe URLs and bounded JSON-LD violations without exposing content', () => {
    for (const value of ['javascript:alert(1)', '//host.example', 'https://user:secret@example.test', '/safe\r\nInjected: yes', '/back\\slash']) {
      expect(() => renderSeoMetadata({ canonical: value }, { requestUrl: 'https://request.test', siteUrl: 'https://public.test' })).toThrow('Invalid SEO metadata: url.');
    }
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const getter = { get name() { throw new Error('PRIVATE_SENTINEL'); } };
    for (const input of [cycle, getter, { n: Infinity }, { n: 1n }, { huge: 'x'.repeat(65537) }]) {
      expect(() => serializeSeoJson(input as SeoJson)).toThrow('Invalid SEO metadata: jsonLd.');
    }
  });

  test('validates and freezes app defaults and robots configuration at startup', () => {
    for (const input of [{ indexing: 'yes' }, { titleTemplate: '%s %s' }, { robots: { index: 'yes' } }, { robotsTxt: { rules: [{ userAgent: '*\nSitemap: https://evil.example' }] } }]) {
      expect(() => resolveSeoConfig(input as any, 'https://public.test')).toThrow();
    }
    for (const input of [{ openGraph: null }, { openGraph: [] }, { robots: false }, { alternates: {} }, { twitter: { images: [null] } },
      { openGraph: { images: null } }, { robotsTxt: null }, { robotsTxt: { rules: [null] } }]) {
      expect(() => resolveSeoConfig(input as any, 'https://public.test')).toThrow(/Invalid SEO metadata/);
    }
    const config = resolveSeoConfig({ openGraph: { images: ['/card.png'] } }, 'https://public.test');
    expect(Object.isFrozen(config)).toBe(true); expect(config && Object.isFrozen(config.openGraph)).toBe(true);
    const robots = renderRobotsTxt({ robotsTxt: { rules: [{ userAgent: ['*', 'ExampleBot'], allow: '/', disallow: ['/private', '/settings'] }] } }, 'https://public.test', '/sitemap.xml');
    expect(robots).toContain('User-agent: ExampleBot'); expect(robots).toContain('Disallow: /private');
    expect(robots).toContain('Sitemap: https://public.test/sitemap.xml');
  });

  test('sitemap contributors are app-local, removable and suppressed in noindex mode', async () => {
    const first = createSeoRuntime(resolveSeoConfig({}, 'https://one.test'), 'https://one.test');
    const second = createSeoRuntime(resolveSeoConfig({}, 'https://two.test'), 'https://two.test');
    const remove = first.registerSitemap('docs', () => [{ href: '/docs' }]);
    expect(await first.sitemapEntries()).toEqual([{ href: '/docs' }]); expect(await second.sitemapEntries()).toEqual([]);
    expect(() => first.registerSitemap('docs', () => [])).toThrow();
    remove(); first.registerSitemap('docs', () => [{ href: '/new-docs' }]); remove();
    expect(await first.sitemapEntries()).toEqual([{ href: '/new-docs' }]);
    const preview = createSeoRuntime(resolveSeoConfig({ indexing: false }));
    preview.registerSitemap('must-not-run', () => { throw new Error('Must not run'); });
    expect(await preview.sitemapEntries()).toEqual([]);
  });
});

---
id: zero.configuration.seo
type: how-to
audience: [developer, agent, operator]
owner: platform-configuration
status: in-review
visibility: internal
system: platform-configuration
feature: seo
maturity: preview
applies_to: ["2.6.0 SEO extension on feature/seo-foundation; qualify the exact archive"]
modes: [managed-server, SSR, client-shell, native-plugin-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "fc61dcc4cd107c6467bff498d3a772e8f5bdea9d"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Configure Site Metadata and Search Discovery

[Configuration index](./index.md) · [Documentation index](../../index.md)

Declare site defaults once in `AppConfig.seo`, then override individual pages
through their existing `meta` export. Zero renders canonical URLs, Open Graph
and Twitter cards, JSON-LD, language alternates and crawler directives in the
server HTML, including client-route shells. Native plugin pages use the same
serializer rather than a separate hand-built head.

This extension belongs to the SEO feature branch. A historical `2.6.0` archive
does not establish that these exports or options exist; pin the qualified source
commit and archive before adopting them. The optional docs package must also
contain its corresponding integration.

## Start With Site Defaults

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';

export default defineZeroConfig({
  app: { name: 'Example', publicUrl: 'https://example.test' },
  db: { mode: 'file', path: './data/app.db' },
  tables: {},
  auth: false,
  seo: {
    title: 'Example',
    titleTemplate: '%s · Example',
    description: 'The public description of this application.',
    openGraph: {
      siteName: 'Example',
      images: [{ url: '/social-card.png', width: 1200, height: 630, alt: 'Example' }],
    },
    twitter: { card: 'summary_large_image' },
  },
});
```

Supply the referenced public image through the app's normal asset-serving
configuration. Zero describes that asset; it does not generate, upload or verify
its contents by making an external request. An image is not invented when none
is configured. [Open Graph](https://ogp.me/) defines the card properties.

With an SEO object and trusted `app.publicUrl`, an omitted `sitemap` enables
the ordinary `/sitemap.xml` route. Explicit `sitemap: false` wins.
`/robots.txt` is also enabled by default. Without a trusted site URL, SEO does
not automatically enable a Host-derived sitemap or canonical link.
Omitting `seo`, or setting it to `false`, preserves the previous opt-in behavior;
an explicit page `meta` can still use supported rich fields.

These are trusted server configuration values read during resolution/startup,
not database-backed preferences or environment-variable bindings. Restart or
rebuild through the normal app lifecycle to change site defaults. They do not
alter design tokens, public branding, Guardian permissions or database schemas.

## Page and Layout Overrides

```tsx
// app/guides/[slug]/page.tsx — fragment
import type { PageMeta } from '@zero/framework/server';

export const meta = (params: Record<string, string>): PageMeta => ({
  title: `Guide ${params.slug}`,
  description: 'Instructions for this public guide.',
  canonical: `/guides/${encodeURIComponent(params.slug)}`,
  openGraph: { type: 'article' },
  jsonLd: {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `Guide ${params.slug}`,
  },
});
```

Metadata resolves in site → root layout → nested layouts → page order.
Static objects and synchronous/asynchronous parameter functions are supported.
Functions receive route params, not a privileged service object. Page loaders
remain separate; sitemap discovery does not execute them. Avoid side effects or
private data in metadata functions because public discovery evaluates metadata
as well as ordinary page rendering.

Undefined inherits. Scalars and JSON-LD replace inherited values; social and
robots objects merge by field. Setting `openGraph: false` or `twitter: false`
suppresses that inherited card family. Arrays such as images replace, not append.
The site title template applies when a layout/page supplies a title; it must
contain exactly one `%s`. Titles and descriptions remain ordinary text.

| Metadata field | Input and behavior |
| --- | --- |
| `title`, `description` | Strings, emitted as escaped title/description text. |
| `canonical` | Absolute HTTP(S) URL, root-relative URL, or `false`. Auto canonical uses the trusted site URL plus pathname, without request query/fragment. An explicit canonical may retain an intentional query; fragments are removed. |
| `openGraph` | Object or `false`. Fields: title, description, url, type, siteName, locale, images. Type defaults to website; title/description/url fall back to resolved page values. |
| `twitter` | Object or `false`. Fields: card, site, creator, title, description, images. Card accepts summary/summary_large_image; omitted card follows image availability. Images can fall back to Open Graph images. |
| `images` | At most 12 URLs or `{url, alt?, width?, height?, type?}` records. Relative URLs need the configured site URL; positive integer dimensions describe the actual asset. |
| `robots` | index/follow booleans; noarchive/nosnippet booleans; maxSnippet/maxVideoPreview integers at least -1; maxImagePreview none/standard/large. Defaults are index, follow. |
| `jsonLd` | JSON data, not raw HTML or a script string. Objects/arrays serialize into application/ld+json with optional caller nonce; cycles, getters, non-JSON values, excessive depth and payloads over 64 KiB reject. |
| `alternates.languages` | Language tag to HTTP(S)/site-relative URL map, including x-default; at most 100 alternates. |

URLs containing credentials, unsafe schemes, protocol-relative hosts, whitespace
or backslashes reject. Relative values use trusted site configuration, never
the request's Host or forwarded headers. Metadata strings are bounded and
control characters reject; output attribute/text values are escaped. JSON-LD
cannot close its script element. This protects output serialization, not the
truth of an application's structured-data claims.

Metadata is delivered with server documents. The planned router/SSR redesign
is not implemented by this feature; it does not execute server metadata functions
inside the browser or add a new client-navigation transport. Keep public
content server-rendered and verify both direct loads and the app's navigation.

## Preview and Crawler Controls

Set `seo.indexing: false` before launch to force `noindex, nofollow` in HTML
and `X-Robots-Tag`, even if page metadata asks for indexing. The application
and docs sitemaps then contain no page entries. Protected file pages and error
documents also cannot opt themselves into indexing through metadata.

`robots.txt` defaults to allowing crawlers to fetch the page so they can read
its noindex directive. A disallow rule prevents fetching; it is not equivalent
to noindex. Neither mechanism is authentication or protection for confidential
content. Keep Guardian/server access policies in place. See Google's
[robots directive specification](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag).

```ts
// AppConfig fragment
seo: {
  indexing: false,
  robotsTxt: {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/search'] }],
    sitemaps: ['https://example.test/another-sitemap.xml'],
  },
},
```

`robotsTxt: false` leaves `/robots.txt` to application code. Otherwise rules
accept a userAgent string/list plus allow/disallow strings/lists. Rules and
values are bounded; embedded control characters reject. Additional sitemap
URLs must be HTTP(S). The built-in sitemap URL is added when configured and
indexing is enabled. Custom explicit sitemap lines remain caller-owned.

## Automatic Documentation Integration

The optional [Markdown docs plugin](../../plugins/docs/index.md) uses the shared
metadata renderer. When a trusted site URL exists, its pages emit canonical
links, social metadata and WebPage JSON-LD automatically. Its existing canonical
HTTP Link and CSP nonce remain intact. Missing documents return 404/noindex,
not a successful canonical page.

Each docs mount registers its current admitted public pages with the app-local
sitemap service. App `/sitemap.xml` combines file routes, published docs and
explicit entries; `/docs/sitemap.xml` remains available independently. Private,
excluded, redirected and attachment routes are not invented as page entries.
Development withdrawal/rebuild uses the current snapshot, not an old cached
page list; pending publication causes safe unavailability rather than stale
discovery. Stopping the mount removes its contribution.

One mount can use an explicit `siteUrl`. Canonicals on another origin are
omitted from the app's sitemap instead of being listed under the wrong host.
Do not publish the repository or private documentation merely to improve SEO.

## Public Helpers and Verification

`@zero/framework/seo` exposes PageMetadata/SeoConfig and related types,
`mergePageMetadata`, `renderSeoMetadata`, `renderRobots` and `SeoError`.
The pure renderer returns `{head, canonical?, robots, indexable, headers}`;
it does not mutate a DOM or make network calls. Normal apps use `createApp`
and page exports rather than assembling their own head strings.

Server extensions can use the optional setup `context.seo`: `render`,
`registerSitemap(name, provider)`, `sitemapEntries`, `robotsTxt`, and read-only
defaults/siteUrl/indexingEnabled. Registration returns an unregister function.
Providers must return only deliberately public, currently admitted entries;
registration is not authorization to publish data. Do not query tenant tables
or enumerate private IDs through this public discovery path.

Invalid metadata raises content-free `SEO_METADATA_INVALID` with the field
name. Invalid app defaults reject configuration; request-time failures use the
normal safe renderer error response. Discovery failures emit
`ZERO_SEO_DISCOVERY_FAILED` and return a content-free 503, never a partially
successful or stale sitemap. Restart/retry after correcting the source;
no database repair or migration is part of this feature.

Verify the initial HTML without JavaScript, canonical host/query behavior,
actual image serving, private/noindex exclusions, preview settings, inherited
layouts, client shells, ISR headers and docs publication changes. Validate the
rendered structured data against the intended schema; syntactically valid JSON
does not promise a search feature or ranking improvement.

## Related Guides and Next Steps

- [Sitemap configuration](./sitemap.md) owns route admission, dynamic entries and XML bounds.
- [Page rendering](../../frontend/router/rendering-and-hydration.md) explains server/client document boundaries.
- [Docs configuration](../../plugins/docs/configuration.md) selects the published folder and trusted URL.
- [App identity](./app-identity.md) owns the trusted public deployment URL.
- [Google canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) explains how crawlers interpret canonical hints.

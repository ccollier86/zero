# Zero Markdown Documentation

An optional, read-only documentation reader for Bun/Elysia Zero apps. Point it
at a Markdown folder; the plugin builds a grouped sidebar, focused article,
on-page headings, server search, syntax-highlighted examples and previous/next
page navigation using Zero's shared controls and current public design tokens.

## Prerequisites

The current **0.1.1 preview** targets Zero framework **2.6.0 or newer within major 2**, React and
React DOM 19.2 or newer within major 19, and Bun 1.3.14+. Its parser dependencies
belong to this optional package, not the framework's required runtime
dependencies. Install it only alongside the compatible framework release.
A working checkout or archive
is not evidence that a registry version has been published.
The reader uses the framework's shared `Kbd`/`KbdGroup` exports, so disabling
search does not make this package compatible with framework 2.5.x. The previous
0.1.0 preview's 2.5.0 qualification remains historical evidence for that pair.

## Use

Install `@zero/plugin-docs` alongside `@zero/framework`. In a normal discovered
server extension, such as `server/plugins/docs.ts` (the default discovery folder):

```ts
import { docs } from '@zero/plugin-docs';

export default docs({ contentDir: './documentation' });
```

For unpublished source/local installs, pack this directory using
`bun pm pack --ignore-scripts --filename /absolute/artifacts/zero-plugin-docs-0.1.1.tgz`
and add that archive from the app root. If the framework is also a saved archive,
the app's root framework dependency and override must identify the same archive
for this package's framework peer. A normal framework update alone does not
install the optional docs package.

From the consuming app root, the local-archive install command is:

```sh
bun add file:/absolute/artifacts/zero-plugin-docs-0.1.1.tgz
```

Add `documentation/index.md` and other `.md` files. The default mount is `/docs`.
The root is relative to Zero's captured application project root, not the
request's current working directory. Production must use the declared app-build
workflow and its compiled manifest; it does not silently rescan source files.

## Configuration

```ts
export default docs({
  contentDir: './documentation',
  title: 'Acme Docs',
  basePath: '/help',
  headerLinks: [{ label: 'App', href: '/app' }],
  exclusions: ['notes/'],
  siteUrl: 'https://example.test',
});
```

Search, wide-screen TOC, previous/next links and development watching are on by
default. Breadcrumbs are off. Optional `include`, `ignoreFile`, `allowEmpty`,
`limits`, `editUrl`, `themeStorageKey` and a unique `name` control publication
and presentation. Unsupported options fail explicitly.

Frontmatter is optional. `title`, `description`, `slug`, `id`,
`navigation: {label, order, hidden}`, `searchable` and `redirects` are supported.
Plain Markdown uses folder/file labels; `index.md` is the landing and `README.md`
its fallback. Other folders receive a generated landing.

## Publication Boundary

Use a content-root `.docsignore` with Git pattern grammar. It is not ambient
`.gitignore` or global Git configuration. Missing default `.docsignore` is fine;
an explicit missing or existing unreadable file fails closed. Config
`exclusions` are additional denies; `include` is an allowlist for both pages and
attachments. Ignoring the root input cannot disable mandatory safety rules.

Internal/private/protected and draft/in-review pages are excluded. Dot/underscore
paths, tooling/dependency/build folders and unsafe symlink targets are excluded.
Hidden sidebar/search items are still public pages. Only referenced, admitted
passive attachments get manifest-owned hashed routes; the source directory is
never a static file mount. Changes retire the entire dev snapshot before a new
one is admitted, so excluded content does not survive through another endpoint.

Markdown is non-executable data: CommonMark/GFM, footnotes, four callout tones and
CodeBlock fences. Raw HTML is escaped; scripts and arbitrary MDX/component
imports never execute. Broken local routes/fragments and unsafe links fail the
build. Code is prepared on the server and remains useful without JavaScript.

## Public Facades

- `@zero/plugin-docs`: `docs`, options and content/error types; **server-only**.
- `@zero/plugin-docs/content`: bounded compiler and admitted-asset tooling.
- `@zero/plugin-docs/react`: reader components/types for advanced composition.
- `@zero/plugin-docs/styles.css`: centralized `--zero-docs-*` tokens and layout.

For `/docs`, read-only projections include `/_api/search?q=…`, `/_api/manifest`,
`/_api/markdown?path=<canonical page>`, `/llms.txt`, and `/sitemap.xml` (with a
trusted app `publicUrl` or explicit `siteUrl`). Every projection uses the same
admitted content and passive-attachment boundary.

## Search And Navigation

Click **Search documentation** or press `Cmd/Ctrl+K`. The palette searches
admitted titles, descriptions, heading ancestry and visible body passages.
Two trimmed characters start a 180ms-debounced request; obsolete requests are
cancelled or ignored. Loading, no results, failures and retry are explicit.

Matching is NFC-normalized, case-insensitive literal search, not semantic or
typo-tolerant search. The reader caps its query at 200 UTF-16 code units; matching
considers at most eight distinct terms. Direct HTTP requests exceeding 200 code
units or containing U+0000–U+001F controls return `400 DOCS_SEARCH_INVALID`, not
a truncated search. Shorten the query/remove controls before retrying. The
two-character minimum and debounce are reader-only; an empty API query returns
an empty result set. Exact titles, whole words and prefixes rank ahead of weaker
substring matches. Up to 20 hits are grouped by page, with at most three distinct
section targets per page, path/ancestry context and excerpts up to 240 characters.
Safe original-text ranges highlight title, section and excerpt matches.

Arrow keys and Enter select a result. Result URLs are real canonical links, so
copying a link, modified clicks and new tabs retain native behavior;
`Cmd/Ctrl+Enter` opens the selected link in a new tab. Input/footer stay visible
while results scroll within the current visual viewport. Escape returns focus to
the actual invoking control, including inside an open mobile navigation drawer.

An ordinary current-tab selection can focus and highlight its destination
passage without rewriting inline markup or CodeBlock syntax. A clear-highlights
control dismisses that context. The handoff is stored once in per-tab,
mount-scoped `sessionStorage`, expires after five minutes and is bound to the
destination page hash. Queries are not appended to result URLs/history or
included in standard failure logs. The search request itself contains `q`, so
custom proxy/access logs need their own query redaction.

`DocsSearchResult` includes `route`, `pageRoute`, public `path`, `title`,
`excerpt`, optional section/ancestry/passage target, page identity and match
ranges. Ranges are zero-based, end-exclusive UTF-16 offsets into original result
text. The reader rejects malformed/excessive responses before rendering them.
Advanced custom composition must pass its actual mount to `DocsContent`'s
`basePath` when it is not `/docs`.
Custom navigation/search must also share `DocsNavigationScope` inside Zero's
`SidebarProvider`; `DocsApp` installs it automatically. This coordinates both
modal close-focus lifecycles before a same-page mobile result lands in the article.

## HTTP And Deployment

Nonce-bearing HTML uses `Cache-Control: private, no-store` and never returns
304. Its ETag hashes fully rendered bytes, including emitted reader JS/CSS URLs
and nonce; its CSP matches that request's markup. Public text projections and
admitted attachments use `public, max-age=0, must-revalidate` with representation-
specific validators. GET and HEAD share status/admission/security behavior;
HEAD has no body. Safe errors and ordinary missing-page HTML are not cached.

Production requires matching compiled artifacts. Browser-entry declarations
enforce their source-root and content-hash admission before bundling admitted
bytes; this is not a sandbox for arbitrary imported app dependencies. Development
rebuilds retire the previous snapshot before replacement, so old search/HTML/
attachment endpoints cannot retain content removed by a publication change.

From an installed app root, use Zero's declared build command, adjusting the
config and entry paths to match the existing application:

```sh
zero build --config ./zero.config.ts --entry ./app/server.ts --outdir ./dist
bun ./dist/server.js
```

Replace an existing bare `bun build` script when adding required plugin content;
a framework update does not rewrite app-owned build scripts. Build imports run
trusted config/plugin code and write output, but do not deploy or migrate the
application. Copy the **complete** output directory for JavaScript deployments,
not only `server.js`. Apps with file-routed pages retain their existing source/
dependency deployment requirements; the source-free case is docs/plugin-only.

Keep private content and attachments outside public `/_build`; do not replace
admitted routes with a static content-folder mount. A CDN or service worker must
honor the HTML no-store policy rather than blanket-cache nonce-bearing pages.

## Scope And Future Work

V1 is public read-only, not a Guardian-protected tenant document editor. Future
plans include permission-gated authoring, protected mounts, versions and curated
interactive previews. Those are not implemented flags. The separate global Zero
theme redesign is also not part of this package.

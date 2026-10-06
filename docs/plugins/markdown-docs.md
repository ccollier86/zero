# Markdown Documentation Plugin

[Optional plugins](./index.md)

The 2.5.0 source/local framework release introduces the separately installed
`@zero/plugin-docs` 0.1.0 package. It provides a public, read-only docs section
from a Markdown folder. Registry publication/release qualification is separate
from implementation; do not assume a 2.4.x package has this build seam.

## Source And Local Archive Installation

The framework remains updateable through the normal main-branch `zero-update`.
The optional plugin is a separate package in the Zero repository's
`packages/docs` directory; it is not implicitly installed by that updater.
Do not assume an npm registry release exists. For the qualified source/local
channel, build its archive from the selected Zero checkout:

```sh
cd /path/to/zero/packages/docs
bun pm pack --ignore-scripts --filename /path/to/artifacts/zero-plugin-docs-0.1.0.tgz
```

Then, from the consuming application's root:

```sh
bun add file:/path/to/artifacts/zero-plugin-docs-0.1.0.tgz
```

Use framework 2.5.0 or newer within major 2. If the framework is itself an
unpublished saved archive, keep the root `@zero/framework` dependency and root
override pointing to that same archive so Bun resolves the plugin's framework
peer to the installed package. The normal updater preserves that override
relationship. Do not patch the plugin's imports or its installed framework copy.
See [upgrading](../upgrading-2.2.md#25-documentation-and-codeblock-update) and
[package qualification](../../docs-next/_work/audits/docs-plugin-qualification.md).

## Minimal Usage

In a normal discovered Zero server extension:

```ts
import { docs } from '@zero/plugin-docs';

export default docs({ contentDir: './documentation' });
```

The root resolves against the app configuration/project root. Add
`documentation/index.md` and other `.md` files; `/docs` is the default mount.
`index.md`, then `README.md`, supply folder landings; otherwise a landing is
generated from eligible children. Nested folders become grouped nav with rails.

The default reader reuses Zero's sidebar, command dialog, theme control and
[replacement CodeBlock system](../frontend/code-block.md). It has a calm article,
wide-screen TOC and title-bearing previous/next links. Breadcrumbs are off by
default. Mobile has a closeable navigation sheet; useful SSR content/ordinary
links remain available without JavaScript or authenticated session restoration.

## Configuration

```ts
export default docs({
  contentDir: './documentation',
  title: 'Acme Docs',
  basePath: '/help',
  breadcrumbs: false,
  headerLinks: [{ label: 'App', href: '/app' }],
  exclusions: ['notes/'],
  siteUrl: 'https://example.test',
});
```

Search, TOC, page navigation and dev watching default to true. Other options
are `name`, `include`, `ignoreFile`, `allowEmpty`, `limits`, `editUrl` and
`themeStorageKey`. Unique non-overlapping mounts are required. Unknown options,
bad URLs and required build failures reject startup/build.

## Content And Publication

Supported syntax includes CommonMark, GFM tables/tasks/delete, footnotes,
`note/tip/warning/danger` callouts and shared CodeBlock fence metadata. Raw HTML
is literal text; no arbitrary MDX/imports or executable fences. Broken local
links/fragments and unsafe/excluded assets reject publication.

Frontmatter is optional. It can set `title`, `description`, `slug`, `id`,
`navigation: {label, order, hidden}`, `searchable`, `redirects`, and explicit
publication classification. Standard bounded documentation metadata such as
`modes`, `related_packages`, `audience` and `reviewed_against` is retained as data;
other custom metadata is namespaced. None of these fields grants publication
permission or configures the application.

The selected content-root `.docsignore` uses Git patterns and ordered negation.
It does not read ambient `.gitignore` or global Git state. Mandatory internal
paths/classification and config exclusions cannot be bypassed by negation.
Missing default ignore file is fine; explicit missing or existing unreadable
inputs fail closed. An `include` allowlist covers both pages and attachments.

Dot/underscore paths, tooling/dependency/build folders, escaped/private symlink
targets and non-public/draft/in-review pages never enter any projection. Hidden
nav/search items are still public. The same immutable manifest powers HTML,
search, Markdown, agent index, sitemap and referenced passive attachments.

## Read API

Under the mount, GET/HEAD readers include:

- Canonical pages and a themed 404.
- `/_api/search?q=…` returning at most 20 title/section/excerpt results.
- `/_api/manifest` returning a lightweight admitted public index.
- `/_api/markdown?path=<canonical route>` returning published Markdown.
- `/llms.txt` and `/sitemap.xml` (trusted app `publicUrl` or explicit `siteUrl`).
- Manifest-owned hashed attachment routes, not a source-directory file server.

Successful reads use explicit content types, `nosniff` and representation-specific
validators. Errors return safe stable code/error bodies and are not cached.
nonce-bearing HTML uses `private, no-store` and never returns 304; its ETag
identifies fully rendered bytes, including actual reader script/CSS URLs and
nonce. Each request's CSP matches its markup. Public text projections and
admitted attachments use `public, max-age=0, must-revalidate` with their own
representation validators. GET and HEAD share admission/status/security
behavior; HEAD has no body. Do not apply blanket HTML caching in a proxy or
service worker.

Search failure logs omit raw query text; runtime/compiler diagnostics use Zero
observability stage/counts. Custom request/access logs need their own redaction
if they record the `q` parameter.

## Search Experience

The search button and `Cmd/Ctrl+K` open the existing named Command dialog.
Two trimmed characters start a 180ms-debounced request. Superseded requests are
cancelled or ignored. Input and footer remain visible while results scroll
within the current visual viewport, including short/keyboard-shrunk layouts.
Escape returns focus to the actual invoking control, including an open mobile
drawer rather than an inaccessible header behind it.

The server indexes admitted titles, descriptions, heading ancestry and visible
passages, including code titles, table rows and callout labels. Matching uses
NFC-normalized, case-insensitive literal terms, with at most 200 UTF-16 code
units/eight distinct terms. Exact titles, whole words and prefixes rank ahead
of weaker substrings. At most 20 hits and three distinct sections per page are
grouped by page with public path, ancestry and bounded excerpts. This is
matching as you type, not query completion, typo tolerance or semantic search.

Result highlights use original-text ranges rather than injected HTML. Normal
selection can focus/highlight the matching destination passage without rewriting
its markup or CodeBlock colors. The context has a clear/dismiss control; its
one-use per-tab/mount handoff expires after five minutes and is bound to the page
hash. Queries are not appended to result URLs/history. Native links retain
modified clicks, copy-link and new-tab behavior; `Cmd/Ctrl+Enter` opens the
selected result in a new tab without navigating the current one.

The detailed [search guide](../../docs-next/plugins/docs/search.md) documents the
result fields, Unicode offsets, bounds, fallback behavior and privacy boundary.

## Build And Lifetime

Use the [declared Zero app-build workflow](../app-build.md). It produces public reader JS/CSS and
private content/files. Production requires matching compiled artifacts, and
can serve a docs-only deployment without its original source folder. This does
not change existing file-page apps' source-deployment requirements.

The native build pipeline validates browser-entry `sourceRoot` and `contentHash`
before bundling admitted bytes, preserving relative imports/chunks. This is not
an imported-dependency sandbox: application build code remains trusted.

Dev changes retire the old snapshot immediately. A valid complete rebuild replaces
it; stale work cannot publish after a newer input or shutdown. Invalid pending
builds return safe 503 rather than retaining newly excluded content. App stop
awaits watcher drain through the normal plugin lifecycle.

Visual defaults live in `@zero/plugin-docs/styles.css` as `--zero-docs-*` roles
derived from the current public palette, typography/radius roles and restrained
motion. Ordinary plugin builds include these styles automatically. No global
theme redesign is included.

## Further Reference

The optional package README is self-contained. The detailed isolated draft
reference starts at [Docs plugin index](../../docs-next/plugins/docs/index.md)
and includes configuration, authoring, publication, reader, search, operations, API
and roadmap. These drafts do not retarget the current docs entrypoints.

V1 has no embedded editor/protected mounts/version selector/executable previews.
Permission-gated authoring is a planned follow-up, not an existing option.

---
id: zero.plugin-docs.api
type: reference
audience: [developer, agent]
owner: docs-plugin
status: draft
visibility: internal
---

# Public API And Agent Projections

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

## Package Facades

| Import | Surface |
| --- | --- |
| `@zero/plugin-docs` | Server declaration `docs`, `DocsOptions`, `DocsContentError` and content types |
| `@zero/plugin-docs/content` | Advanced `compileDocsContent`, admitted asset reader, base-path normalization and compiler types |
| `@zero/plugin-docs/react` | `DocsApp`, `DocsContent`, `DocsNavigation`, `DocsNavigationScope`, `DocsToc`, `DocsCallout`, `DocsFooter`, `DocsSearch` and presentation types |
| `@zero/plugin-docs/styles.css` | Scoped reader tokens/layout for custom composition; normal plugin builds include it automatically |

The server facade imports filesystem/compiler/runtime integration and is not a
browser entry. The React facade does not parse Markdown or discover files.

`docs(options)` returns the existing Zero-native `ZeroPluginDefinition`.
It does not immediately start an app, mutate a database or create a second
backend. The normal extension loader mounts its declaration.

## HTTP Projections

For the default `/docs` mount, GET and HEAD are read-only:

| URL | Result |
| --- | --- |
| `/docs` and admitted canonical page routes | SSR reader; ordinary missing pages render a 404 |
| `/docs/_api/search?q=phrase` | `{results}` with page/section targets, ancestry, bounded excerpts and original-text match ranges |
| `/docs/_api/manifest` | Lightweight public index: version/basePath/hash/pages/navigation/redirects |
| `/docs/_api/markdown?path=%2Fdocs%2Fguide` | Frontmatter-free published Markdown for one canonical page |
| `/docs/llms.txt` | Public page index intended for agent discovery |
| `/docs/sitemap.xml` | Public canonical URLs, with `siteUrl` or trusted app `publicUrl` |
| Manifest-owned `/_assets/...` routes under the mount | Referenced admitted passive attachments |

Search accepts queries of at most 200 UTF-16 code units without U+0000–U+001F
control characters. Invalid input returns `400 DOCS_SEARCH_INVALID`; shorten
the query and remove controls rather than expecting server-side truncation.
Matching considers at most eight distinct literal terms and returns at most 20
hits, with at most three distinct section targets per page. The two-character
minimum and 180ms debounce are reader behavior, not an API minimum; empty API
queries return `{results: []}`. Disabling `search` hides its UI and returns
`404 DOCS_NOT_FOUND` from its endpoint. A retired/pending snapshot returns
`503 DOCS_REBUILD_PENDING`. Lightweight manifest pages expose
`route`, `title`, `description`, `headings` and optional semantic ID—not private
filesystem roots or a dump of all source/metadata.

Markdown links/assets target admitted public routes. Code text/fence metadata
remains content, never executable instructions. The agent index is derived
from the same snapshot; it is not a second crawler or a full raw-repository
export. These outputs give agents public documentation, not Guardian authority.

## Search Result Contract

The public `DocsSearchResult` type is available from the React facade. Its
required fields are `route`, `pageRoute`, `path`, `title` and `excerpt`.
The packaged server also supplies `pageHash` and `matches`, with `section`,
`sectionPath` and `passageId` when a passage/section target exists.

| Field | Meaning |
| --- | --- |
| `route` | Canonical mount-owned page URL with an optional encoded heading fragment. |
| `pageRoute`, `path` | Canonical public page pathname; never an absolute source path. |
| `pageHash` | Immutable page identity used to reject stale destination highlights. |
| `title`, `section?`, `sectionPath?` | Page title, nearest heading label and its ancestry, respectively. |
| `excerpt` | At most 240 UTF-16 code units, centered around useful matches. |
| `passageId?` | Deterministic `docs-p-<number>` target within the admitted AST. |
| `matches` | `title`, optional `section`, and `excerpt` arrays of `{start, end}` original-text UTF-16 offsets; zero-based and end-exclusive. |

The response is literal public data, not prepared HTML. Advanced clients must
render ranges as text, validate route ownership and retain snapshot boundaries.
The default reader performs these checks, preserves native links and avoids
placing the query in destination URLs. [Search and result navigation](./search.md)
documents matching, ranking, exact bounds and transient highlight ownership.

## Conditional Reads And HEAD

Nonce-bearing HTML is request-local: it uses `Cache-Control: private, no-store`
and never returns 304. Its quoted ETag identifies the fully rendered bytes,
including emitted script/CSS references and nonce. Each response's CSP matches
its own markup; clients must not treat a fresh nonce as a validator for cached
HTML. Ordinary missing-page HTML and safe errors are also non-cacheable.

Public text projections and admitted attachments use
`public, max-age=0, must-revalidate`. Text validators include emitted content and
media type; assets use the admitted byte hash. A valid `If-None-Match` match can
return 304 after current publication admission. Weak validators and complete
quoted lists are compared correctly; malformed lists are ignored rather than
partially accepted.

HEAD uses the same status, content/security metadata and admission path as GET,
without a response body. HTML is fully rendered before its body is omitted, so
render failures and snapshot retirement cannot be hidden behind an early HEAD
success. See [Operations](./operations.md#http-cache-and-security-policy) for
deployment implications.

## Advanced Compiler Use

```ts
import { compileDocsContent } from '@zero/plugin-docs/content';

const manifest = await compileDocsContent({
  contentDir: '/absolute/trusted/project/documentation',
  basePath: '/docs',
  mode: 'production',
});
```

This compiles admitted content and validates its links. It does not mount routes,
create a React root or publish files. Prefer the ordinary `docs()` declaration
unless building deliberate tooling. Use its structured diagnostics rather than
reading excluded files or catching failure and publishing an old raw scan.

## Related Guides And Next Steps

- [Configuration](./configuration.md) covers defaults and the trusted root.
- [Publication](./publication.md) defines which content may appear here.
- [Search](./search.md) defines the detailed search and result contract.
- [Operations](./operations.md) defines failure, artifacts and cache behavior.

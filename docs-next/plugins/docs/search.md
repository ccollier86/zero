---
id: zero.plugin-docs.search
type: reference
audience: [developer, agent, operator]
owner: docs-plugin
status: draft
visibility: internal
system: docs-plugin
feature: search
maturity: preview
applies_to: ["@zero/framework 2.5.0 source/local release with @zero/plugin-docs 0.1.0"]
modes: [public read-only, development, production]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "0ef2cb30d47788722627014c7a28da616f33b5c8"
  snapshot: clean
  date: "2026-10-06"
  evidence_level: source-observed
---

# Search And Result Navigation

[Docs plugin index](./index.md) · [Documentation index](../../index.md)

The default reader includes server-ranked, passage-aware search. Enable it with
the existing `search` option; it is on by default. No external search service,
provider credentials, second crawler or browser Markdown parser is required.
Search reads the same admitted immutable manifest as the article and other
[public projections](./api.md), not the repository or excluded source files.
The current 0.1.1 preview requires framework 2.6.0 or newer within major 2;
the search trigger/footer reuse Zero's shared `Kbd`/`KbdGroup` hints. Disabling
search does not remove that package prerequisite. See
[installation](./operations.md#source-and-local-archive-installation).

## Reader Experience

Click **Search documentation** or press `Cmd/Ctrl+K`. Type at least two trimmed
characters; the reader waits 180ms before requesting matches. Loading, no
matches, failure and retry states are explicit. A newer query, changed mount or
closed dialog cancels obsolete work and prevents late results replacing the
current response.

Results are grouped by page with their public path. Each hit shows the page or
section label, heading ancestry where available, and a passage-centered excerpt.
Matched text is highlighted through safe React text ranges, not injected HTML.
The footer announces the result count and number of matching pages.

Use the arrow keys and Enter to open the selected result. Results are real
canonical links: context-menu **Copy link**, modified clicks and opening a new
tab retain native browser behavior. `Cmd/Ctrl+Enter` opens the selected result
in a new tab without navigating the current tab. Modified navigation does not
close the original mobile drawer or store a highlight handoff for that tab.

Escape closes the palette and returns focus to its actual invoking control.
If search was opened from the mobile navigation drawer, focus returns within
that drawer rather than to an inaccessible header behind it. Search input and
footer remain reachable while only the result list scrolls; palette dimensions
follow the visual viewport, including changes caused by the on-screen keyboard.

## What Is Searched

The compiler creates passages with stable, deterministic IDs, nearest headings
and heading ancestry. The index includes admitted page titles, frontmatter
descriptions and visible text from paragraphs, lists, headings, code/fence
titles, table rows, image alternatives, footnotes and callout titles/content.
Raw HTML is searched only as the literal escaped text the reader displays.

Inline formatting does not insert artificial spaces: `get**User**` is
`getUser` in the title, heading anchor and search. Different table cells and
block boundaries remain separated, so `ten | ant` is not a false `tenant` hit.
A page with `searchable: false` is omitted from search but remains public.
[Hiding navigation or search](./publication.md#inclusion-is-not-a-permission)
is not an access-control policy.

Matching uses case-insensitive literal terms with NFC Unicode normalization.
All considered distinct terms must occur in the page's searchable context;
they may be distributed between metadata, headings and body passages. This is
not a phrase-only search, stemming, accent removal, spelling correction or
semantic/AI search. For distributed matches, a result can show a useful witness
passage rather than pretending that every term occurs in one excerpt.

Exact titles rank above weaker matches; whole words and prefixes rank ahead of
arbitrary substrings. Titles and heading ancestry provide context. A title-only
match does not produce hits for every unrelated descendant paragraph. Results
are bounded to 20 globally and at most three distinct section targets per page,
with deterministic ordering for ties.

## Destination Focus And Highlighting

An ordinary current-tab selection opens the canonical page/heading and then
focuses its matching passage after hydration or after the search dialog releases
its focus trap. When mobile navigation is also open, both modal close-focus
lifecycles finish before article landing; no timer guesses when the traps ended.
A metadata-only result can focus the displayed description; if
there is no more specific target, it falls back to the page heading. Normal
heading links remain useful without JavaScript.

The destination shows a **Showing matches** banner and **Clear highlights**
button. Highlights remain until cleared, Escape is pressed without another
dialog open, or the page/snapshot/history/hash location changes. They are not a
permanent change to document content. Reduced-motion preferences suppress the
smooth landing scroll.

Article highlighting uses the browser's CSS Custom Highlight API and native
text ranges. It does not rewrite paragraph markup or replace CodeBlock syntax
colors. If that API is unavailable, focus, scroll and the target outline still
work. Result text highlights do not require the API.

## Query Privacy And Snapshot Ownership

The query is never appended to result URLs or page history, and standard search
failure events do not log its raw text. The search HTTP request necessarily
contains `q`; reverse proxies and custom access logs must apply their own query
redaction if they record URLs.

The reader stores one short-lived highlight handoff in `sessionStorage`, scoped
to the documentation mount and current tab. It expires after five minutes and is
consumed once. It must match the destination route and immutable page hash;
stale results from a replaced snapshot cannot apply a highlight to newer content.
This is a transient reader convenience, not a cross-tab search history or saved
query service. Failure to use browser storage does not grant access or expose
private content.

## Bounds And Search API

| Boundary | Limit |
| --- | --- |
| HTTP query | At most 200 UTF-16 code units, with no U+0000–U+001F controls; invalid input returns 400 |
| Matching terms | At most eight distinct literal terms from the admitted query |
| Reader minimum / debounce | Two trimmed characters / 180ms |
| Results | At most 20, with at most three distinct section targets per page |
| Title, section and each heading ancestry label | At most 256 UTF-16 code units |
| Ancestry | At most six headings |
| Excerpt | At most 240 UTF-16 code units, including ellipses |
| Public page pathname | At most 4,096 UTF-16 code units |
| Match ranges | At most 16 original-text ranges per result field |
| Index windows / query cache | At most 2,048 characters per window; 32 query-result sets cached per immutable manifest |
| Destination handoff | Five-minute, one-use, per-tab/mount receipt |

`GET /docs/_api/search?q=token` returns `{results}`. `DocsSearchResult` contains
`route`, `pageRoute`, `path`, `title` and `excerpt`, plus optional `section`,
`sectionPath`, `passageId`, `pageHash` and `matches`. The packaged server supplies
the page hash and bounded match ranges. `path` is a public pathname, not a local
filesystem path. `route` may add an encoded heading fragment.

The default input caps its value at 200 UTF-16 code units; its request hook trims
and bounds the query before fetching. That reader behavior is not the HTTP
admission contract: a direct API request with more than 200 code units or any
U+0000–U+001F control character is rejected with `400 DOCS_SEARCH_INVALID`, not
silently truncated. Shorten the query and remove controls before retrying.
The two-character minimum and debounce apply to the reader only; an absent or
empty API query returns an empty result set. A disabled search endpoint returns
`404 DOCS_NOT_FOUND`, and a retired/pending snapshot returns
`503 DOCS_REBUILD_PENDING` until a valid publication is admitted.

Each match range is `{start, end}`: zero-based, end-exclusive UTF-16 offsets into
the corresponding **original** title, section or excerpt. Normalized matching is
mapped back to original text before projection; composed/decomposed Unicode and
length-changing lowercase transformations do not shift highlights into adjacent
text. Browser response admission rejects malformed URLs, excessive labels,
duplicate targets and invalid/out-of-range match spans before rendering them.

The immutable manifest owns the index and bounded query cache. A new manifest
does not share results with a retired publication. Search remains synchronous
local literal matching; these bounds are not a claim of production throughput
or a substitute for request-level deployment controls.

## Composition And Extension Boundaries

Ordinary apps use `docs()` and the default reader. Advanced composition can use
`DocsSearch` with its `DocsPresentation`, and `DocsContent` with an admitted page,
ordered server highlights and the correct `basePath`. Pass the mount explicitly
when it differs from `/docs`, so destination handoffs remain scope-correct.
Custom navigation/search must share `DocsNavigationScope` inside Zero's
`SidebarProvider`; `DocsApp` installs that public lifecycle broker automatically.
It coordinates nested mobile navigation and same-page search landing.
Do not replace public admission with an independent raw-file scanner.

Query completion, typo tolerance, recent/popular queries, an all-results page,
protected tenant search, external indexes and semantic search are not current
options. See the [roadmap](./roadmap.md) for staged follow-ups rather than
assuming that type-ahead matching is a suggestion engine.

## Related Guides And Next Steps

- [Reader and theme](./reader.md) covers layout, accessibility and token overrides.
- [Authoring](./authoring.md) covers headings, descriptions and visible labels.
- [API](./api.md) covers every public projection and package facade.
- [Publication](./publication.md) defines the shared admission boundary.
- [Operations](./operations.md) covers caching, rebuilds and standard observability.
- [Qualification ledger](../../_work/audits/docs-plugin-qualification.md) distinguishes
  observed source behavior from completed browser/archive release evidence.

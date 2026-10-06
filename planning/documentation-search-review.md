# Documentation Reader, Search And CodeBlock Review

[Working plans](./index.md) · [Docs plugin plan](./documentation-plugin.md)
· [Reader design](./documentation-page-design.md)

Recorded 2026-10-06 against the uncommitted
`feature/markdown-documentation-plugin` implementation, based on main
`636b1c01b3484317df56ce624c7cd57976ee417c` (2.4.0), targeting framework 2.5.0
and optional docs package 0.1.0.

Status: correction implementation and documentation are in progress on
2026-10-06 after user approval. Backend search/content and HTTP/artifact admission
are implemented and passing their focused source regressions. Reader interaction,
CodeBlock/build and rebuilt installed-artifact qualification require their owner’s
final recorded gates; UI acceptance is **in progress**, not yet a release claim.
No confirmed defect is accepted as a documentation-only limitation. The original
review was read-only; the authorized correction pass is not.

## Original Confirmed Findings

These paragraphs preserve the original reproductions. They describe the
pre-correction implementation, not the new supported contract below.

1. **Deployment cache invalidation.** HTML ETags include the content manifest and
   options, but not frontend assets/render build identity. A synthetic deployment
   changed its emitted script and CSS URLs while returning the same validator;
   revalidation returned 304, retaining obsolete HTML asset references. Include
   page/render/build identity in validators, reconcile nonce-bearing HTML and
   GET/HEAD headers, and test upgrades with unchanged Markdown.
   Owner: [request handler](../packages/docs/src/server/handler.ts),
   [page renderer](../packages/docs/src/server/page.ts).
2. **Short-viewport search sizing.** With 20 valid results at 640×360, the input
   sits entirely above the viewport; at 390×400 the input is mostly clipped and
   footer is below the viewport. Background scrolling is locked. Constrain the
   whole palette to available height, pin input/footer and scroll only results;
   account for the mobile visual viewport and keyboard.
   Owner: [docs styles](../packages/docs/src/ui/docs.css).
3. **Nested-modal focus.** Open mobile navigation, press Ctrl+K, then Escape:
   search closes but the drawer remains modal; focus returns to the header search
   button within an aria-hidden background. Return to the actual invoking focus
   or coordinate search/drawer replacement. Owner:
   [search component](../packages/docs/src/ui/docs-search.tsx).
4. **Unnamed search input.** Its generated aria-labelledby targets an empty cmdk
   label; a named combobox query finds zero elements. Naming the dialog alone
   does not name its input. Supply a proper primitive/input label and test the
   accessibility tree. Owners: search component and
   [Command composition](../src/components/ui/command.tsx).
5. **Modifier-click focus.** Cmd-clicking a mobile nav link opens a new tab but
   closes the original drawer and suppresses focus return, leaving BODY focused.
   Treat only genuine current-window navigation as such. Owner:
   [navigation](../packages/docs/src/ui/docs-navigation.tsx).
6. **Unicode excerpt offsets.** Search finds offsets in lowercased text and
   applies them to original text. Lowercasing can change UTF-16 length (`İ` to
   `i̇`); a reproduced `needle` hit returns only later `after` text. Map normalized
   positions back to original text before excerpting/highlighting. Owner:
   [search implementation](../packages/docs/src/server/search.ts).
7. **Text projection boundaries/labels.** Table cells `ten | ant` merge into
   `tenant`, creating false matches. Hard breaks/nested block boundaries can also
   disappear; displayed callout titles and fence filenames are omitted. Preserve
   block/cell boundaries while keeping adjacent inline spans contiguous, and
   index visible labels. Owner:
   [text projection](../packages/docs/src/content/markdown-text.ts).
8. **Formatted heading identity.** `# get**User**` becomes inferred `get User`
   with `get-user`, while the body retains `getUser`. `auth**Role**` similarly
   breaks heading targeting. Do not apply root/block separators to inline heading
   children. Owner: [Markdown conversion](../packages/docs/src/content/markdown.ts).
9. **Inferred-title/anchor/result bounds.** An admitted 240,002-byte Markdown file
   containing a giant H1 yields one 720,259-byte HTTP search response, with
   239,999-character title/section and 240,005-character route. Frontmatter bounds
   do not cover inferred headings; browser label truncation happens after JSON
   download/parse. Add compiler/server bounds for headings, anchors, labels and
   result payloads. This proves disproportionate cost, not a demonstrated DoS.
   Owners: [compiler](../packages/docs/src/content/compile.ts), search implementation.
10. **Search-description mismatch.** Authoring docs call frontmatter description
    the search/HTML description, but it is neither searched nor used as an
    excerpt. Include it in the search projection to meet that contract.
11. **Custom CodeBlock transformer identity.** Different trusted transformers
    named `custom-stamp` produce different HTML but identical keys, so prepared
    old HTML is accepted under new options and client highlighting is skipped.
    Separate live options/generation binding from the fingerprint; provide a
    serializable configuration identity for prepared custom-transformer results
    when needed. Not an XSS finding. Owners:
    [metadata fingerprint](../src/components/code-block/code-block-metadata.ts),
    [code renderer](../src/components/code-block/code-block-code.tsx).
12. **Browser-entry admission contract.** Browser entries bypass the shared file
    reader and silently ignore declared contentHash/sourceRoot. A deliberately
    incorrect hash and out-of-bound source still produce a script. Admit the
    canonical entry and bytes through the existing reader, then compile those
    bytes while preserving relative import/chunk resolution. This is not a
    request for an imported-dependency sandbox. Owners:
    [asset builder](../src/frontend/server/server-plugin-build-assets.ts),
    [admitted file reader](../src/frontend/server/server-plugin-build-file.ts).

## Correction Status

| Findings | Current state and acceptance boundary |
| --- | --- |
| 1: HTTP deployment/nonce cache | Corrected. Complete rendered HTML identity, nonce-matched no-store policy, GET/HEAD, quoted validators and exact text projections pass controlled cache regressions. |
| 2–5: palette sizing, nested focus, naming, native navigation | Implemented in the reader/shared Command composition. Final real styled-browser acceptance remains in progress; source presence alone is not a browser pass. |
| 6–10: Unicode, projections/headings, bounds, description | Corrected in compiler/search with focused regression coverage, including original-text ranges, separated cells and displayed labels. Eight title/metadata follow-up regressions also pass. |
| 11: custom CodeBlock identity | Correction owned by the shared CodeBlock track; final regression/rebuilt-package evidence must be recorded before closeout. |
| 12: browser-entry admission | Source now uses the shared canonical/hash-bound admitted-byte reader before bundling, without claiming a transitive import sandbox. Final build/archive evidence must be recorded before closeout. |
| Additional: compiled search metadata | Artifact admission validates bounded passage IDs/text/order/ancestry against the admitted AST; rejects orphaned/stale/inconsistent metadata and supports legacy snapshots without additive annotations. Focused regressions pass. |
| Additional: pending SSR retirement | GET and fully rendered HEAD cannot return a snapshot retired while asynchronous SSR was pending. Controlled generation-barrier regression passes. |

See the [qualification ledger](../docs-next/_work/audits/docs-plugin-qualification.md)
for exact evidence. Old archives/screenshots predate these changes and cannot
qualify the current runtime by implication.

## Implemented Search Contract

| Capability | Current behavior |
| --- | --- |
| Presentation | Existing Command dialog, not a separate results page. |
| Type-ahead | Two-character minimum; 180ms debounce; Cmd/Ctrl+K. |
| Indexed content | Admitted titles/descriptions and visible passages, including code/fence titles, separated table cells, callout labels/content, lists, image alternatives and footnotes. |
| Matching | NFC-normalized, case-insensitive literal AND terms across page context; first eight distinct terms and 200 UTF-16 code units. No stemming/accent removal/typo or semantic matching. |
| Ranking | Exact titles, whole words and prefixes before weaker substrings; title and heading ancestry provide context without flooding unrelated descendants. |
| Results | Maximum 20, at most three distinct section targets per page; page grouping, public path, ancestry and passage-centered excerpts bounded to 240 UTF-16 code units. |
| Targeting | Manifest-owned passage/nearest-heading targets; metadata-only fallback can focus a visible description or page heading. |
| Suggestions | Matching pages as you type, not query completion/spelling correction/recent or popular queries. |
| Highlighting | Safe original-text ranges in result text; native CSS text highlights, focus and outline in the destination. Code/inline markup preserved; explicit clear/Escape/navigation cleanup. |
| Privacy | Query absent from canonical links/history and standard failure events; one-use, five-minute per-tab/mount handoff bound to pageHash. HTTP q still requires proxy access-log redaction. |
| Native links/focus | Modified clicks/new tabs preserve browser behavior; Escape restores actual invoker, including an open mobile drawer. |
| Viewport | Input/footer pinned, results independently scroll, palette follows current visual viewport; final browser acceptance in progress. |
| Lifecycles | Query/base-path ownership, abort/late-result fencing, loading/empty/error/retry states. |
| Index lifetime | Prebuilt bounded passage windows and at most 32 cached query results per immutable manifest; new publication cannot reuse retired results. |
| Publication | One admitted immutable manifest; no separate private-source search scanner. |

## Focused Search Polish Delivery

Implemented contracts are documented in the [search guide](../docs-next/plugins/docs/search.md).
Checked entries mean source implementation exists; final browser/archive gates
remain separately required.

- [x] Index passages with nearest heading and section ancestry.
- [x] Return a useful section target and passage-centered excerpt.
- [x] Highlight matched terms in title/section/excerpt through safe React text
  ranges and tokenized match styles, not HTML injection.
- [x] On selection, focus/highlight the matching passage until explicitly cleared,
  Escape or navigation; no auto-disappearing reading context.
- [x] Preserve code syntax colors, inline formatting, keyboard reading and reduced motion.
- [x] Keep search context transient by default; shareable query URLs are a
  deliberate option because they affect history/sharing/privacy.
- [x] Show public path context and group related section hits under their page.
- [x] Prefer exact titles, whole words and prefixes before arbitrary substrings.
- [x] Add NFC Unicode normalization with original-text range mapping.
- [ ] Add bounded typo tolerance only after measured demand; not part of this pass.
- [x] Preserve native result-link behavior: open in new tab and copy link.
- [x] Announce result counts for assistive technology.

An all-results page, recent/popular query suggestions and external/semantic
search are optional later features, not prerequisites for this pass.

## Evidence And Scale

Current correction gates:

- Root-reported integrated unit/content/server/search closeout: 96 passed /
  592 assertions, followed by eight passing title/metadata regressions. Earlier
  focused checkpoints below overlap and are not additive coverage totals.

- `bun --no-env-file test packages/docs/src/server`: 35 passed, zero failed,
  312 assertions across eight files. Includes controlled cache/nonce/GET/HEAD
  barriers, compiled metadata admission, runtime, watcher/drain and search.
- Focused compiler/search/text gate: 19 passed / 56 assertions, as reported by
  its owner. The earlier broad compiler/search/server/SSR gate was 76 / 482;
  these overlap and are not additive totals.
- UI range/route/selection helpers: 18 passed / 101 assertions, as reported by
  their owner. Helpers are not a substitute for real styled-browser behavior.
- Full framework TypeScript passed after HTTP/artifact changes. Final integrated
  typecheck/browser/build/archive gates remain the root owner’s closeout.

The following evidence and timing are **historical pre-correction observations**.
They explain why the work was requested, not the performance or release status
of the new passage index.

The unchanged runtime/compiler suite passed 44 tests /258 assertions. Independent
focused composition/highlight/SSR tests passed 27 /132. Passing historical
tests do not cover the new edge cases. Focused synthetic HTTP/parser/browser
reproductions above found them without changing production code or using apps,
credentials, live databases or providers.

Retained external diagnostic evidence:

- `diagnostics/docs-plugin/search-review-T3mOtS/observations.json` and
  `search-640x360.png` under the project artifacts root.
- `docs-search-review-94Qul4/search-review.ts` under the project scratch root.
- `docs-plugin-review-runtime.log` under the project logs root.

Synthetic search timing on this machine, not production benchmarks:

| Corpus | Warm query |
| --- | --- |
| 500 pages /4MB | About 2ms |
| 5,000 pages /10MB, broad hit | About 15–17ms |
| 5,000 pages /~128MiB, eight distinct late-body terms | About 91–103ms; cold about 286ms |

The reviewed old implementation synchronously scanned text, created all matching
excerpts and sorted all matches before taking 20. The correction uses prebuilt
bounded passage windows, bounded top-result selection and per-manifest caching.
Do not relabel the old timings as a benchmark of that implementation. No
availability exploit was established. Preserve the optional package and existing
publication boundaries.

## Final Closeout Procedure

1. Retain source regression coverage for every original finding and late discovery.
2. Complete the real styled-browser gates for short/keyboard-shrunk viewports,
   nested modal focus, named input, modified navigation and destination highlighting.
3. Record final CodeBlock/build identity evidence and full integrated TypeScript.
4. Finish current/docs-next guides, backlinks and structural/example checks.
5. Rebuild and requalify actual installed/compiled artifacts; record their new
   identities before any main merge or publication claim.

Do not merge the unfinished docs/CodeBlock feature merely to deliver an unrelated
urgent platform update.

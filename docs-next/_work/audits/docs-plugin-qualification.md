---
id: zero.audit.docs-plugin-qualification
type: operations
audience: [agent, maintainer]
owner: docs-plugin
status: in-review
visibility: internal
---

# Documentation Plugin And CodeBlock Qualification

[Audit index](./index.md) · [System inventory](./systems/docs-plugin.md)
· [Plugin guide](../../plugins/docs/index.md)
· [Documentation index](../../index.md)

## Identity And Scope

Inspected 2026-10-06 on `feature/markdown-documentation-plugin`, based on
committed main `636b1c01b3484317df56ce624c7cd57976ee417c` (framework 2.4.0).
The additive working tree targets framework **2.5.0** and optional
`@zero/plugin-docs` **0.1.0**. This is a dirty-source/archive qualification,
not a clean release-commit qualification, registry publication or main merge.
The original whole-platform 2.1.1 audit baseline remains historical.

All checks used synthetic content, isolated browser contexts and disposable
databases/artifacts outside the repository. No Pantheon/live application,
accounts, credential files or provider APIs were used. Browser automation used
the existing isolated test lease after the in-app connection failed to initialize.

The release scope is public read-only docs, shared CodeBlock replacement and
native build/SSR seams. It does not include protected tenant docs, authoring,
version collections, arbitrary MDX execution or the global theme redesign.

The obsolete public renderer is replaced in place. A final dependency check also
removed three unused source-local Animate UI Code/CodeTabs/CodeBlock files and
their private import alias, leaving generic Tabs/copy controls untouched. Those
tracked removals are recoverable from the baseline commit. The actual archive
gate checks that no obsolete renderer files are shipped.

## Current Correction Qualification

The follow-up [reader/search review](../../../planning/documentation-search-review.md)
found correctness gaps after the initial gates below. User-authorized fixes are
now implemented across HTTP/artifact admission, compiler/search, reader and
shared CodeBlock/build tracks. **Final UI acceptance and rebuilt installed-artifact
qualification are in progress.** This ledger must not claim the current tree is
ready merely because an older archive passed.

| Current gate | Executed evidence / remaining boundary |
| --- | --- |
| HTTP/artifact/server | `bun --no-env-file test packages/docs/src/server`: 35 passed / 312 assertions, zero failures, eight files. Includes frontend-reference invalidation, nonce/CSP no-store, exact projection validators, GET/HEAD, pending SSR retirement and strict search metadata admission. |
| Integrated unit/content/server/search | Root-reported latest closeout: 96 passed / 592 assertions, followed by eight passing title/metadata regressions. These overlap earlier focused gates and are not additive coverage totals. |
| Compiler/search/text | Owner-reported focused gate: 19 passed / 56 assertions. Earlier broad compiler/search/server/SSR gate: 76 / 482; retained as earlier checkpoints, not current totals. |
| UI response/range/selection helpers | Owner-reported 18 passed / 101 assertions. Real styled-browser acceptance remains pending. |
| Framework TypeScript | HTTP/artifact checkpoint passed with no diagnostics. Final integrated checkpoint remains required. |
| Reader browser/SSR closeout | In progress: short visual viewport, mobile keyboard geometry, nested drawer/search focus, native modified links, destination highlights and title/description cases. |
| CodeBlock/build/rebuilt archive | Final owner-reported regressions and a newly built installed/compiled artifact identity must be recorded. Historical hashes below do not qualify these corrections. |
| Documentation | Current package/plugin/search/cache guides reconciled with source. Structural traversal: 715 pages/IDs/reachable, zero problems; `git diff --check` clean. Final combined example/closeout gate remains required. |

Current HTTP logs: `docs-http-server-final.log` and `docs-http-typecheck.log`
under the configured project logs root. `docs-http-cache-red.log` records the
unchanged pre-fix cache reproduction (zero passing/five failing tests), not a
current failure. Source and helper counts establish narrow contracts; they do
not imply a clean release commit, registry publication or whole-platform audit.

## Historical Initial Evidence

The gates below predate the follow-up search/cache/build corrections. Retain
them as evidence of the initial implementation, not final current readiness.

Counts below are separate overlapping gates, **not additive coverage totals**.

| Gate | Result and boundary |
| --- | --- |
| Content compiler and runtime | 44 tests / 258 assertions: bounded parsing, admission, links/assets, generation fences, search/read projections, caching and watcher/drain behavior. |
| Reader source browser + SSR/theme checks | 14 tests / 81 assertions: styled responsive layouts, saved theme hydration, safe semantics, navigation/TOC/search, stale-query barrier, focus, actual reduced motion, long footer titles and no-JS rendering. |
| Shared CodeBlock source/composition | 32 tests / 170 assertions, including ten actual browser cases verifying composition, metadata, syntax/notation, themes/tokens, package selection and copy lifecycles. |
| Core build/scaffold | 68 tests / 410 assertions before the final SSR identity refinement; subsequent renderer/build gate 14 / 78 and focused hookful renderer gate 2 / 26. |
| Real installed archive and deployment | 1 test / 131 assertions using public exports and the normal CLI: installed peers, copied output, no-source/no-node_modules deployment, compiled executable, JS/CSS/chunks, private assets, SSR/read endpoints, config identity, awaited drain and obsolete renderer absence. |
| Compiled installed reader in Chromium | 5 tests / 47 assertions: actual emitted ESM under nonce CSP; light/dark at 1440/390px; loaded admitted image; server search and page navigation; mobile focus/reduced Web Animations; code/page clipboard; no-JS reading. |
| Full framework TypeScript | Passed with no diagnostics. Optional package TypeScript passed separately. |
| Documentation structure/examples | Final closeout traversal 714 pages/IDs/reachable with zero problems; targeted AST link/anchor audit 16 pages / 304 links; UI Markdown snippet compiler 1 / 59. |

After removal of the unused private renderer chain, the combined CodeBlock,
reader SSR/browser and theme gate passed **46 tests / 251 assertions**, including
the regenerated platform CSS. That combined count covers the source component
rows above rather than being additional independent coverage.

Retained initial implementation archives were built in `installed-2uav9Q` under
the configured external diagnostics root. Their `provenance.json` records branch,
source HEAD, Bun 1.3.14, exact archive paths/SHA-256 and normal/compiled deployment
routes. These hashes identify the checked archives, not an uncommitted tree as a
clean release. Runtime corrections have since changed the implementation;
these archives must be rebuilt and requalified for eventual release.

Historical initial runtime/package archive identities:

- Framework 2.5.0 SHA-256:
  `09a491dcaa8be670efeafc3a8db025f93380c9e57d0db00da4cac973e7ebaf49`.
- Optional docs 0.1.0 SHA-256:
  `dde500e554c696b837290ebec84b80a1ecfaca298bb2a2be3fbde4586c693bfc`.

Logs: `docs-plugin-browser.log`, `docs-plugin-compiled-browser.log`,
`docs-plugin-ui-typecheck.log` under the configured project logs directory.
Styled source and actual compiled screenshots are retained under the docs-plugin
diagnostics directory. The opt-in installed browser gate requires only its
dedicated `ZERO_DOCS_INSTALLED_BROWSER_URL`, validated as a loopback fixture.

## Confirmed Corrections

Current follow-up corrections:

| Finding | Resolution and evidence |
| --- | --- |
| HTML validators ignored frontend assets and could return 304 with a different CSP nonce. | Fully rendered representation identity and fresh nonce-matched `private, no-store` HTML; never 304. Controlled frontend-swap and nonce regressions pass. |
| HEAD skipped renderer security/failure metadata; public projections shared a validator. | Fully rendered body-free HEAD, static safe error metadata, and media-type/body-specific text validators. Quoted/weak validator and exact-projection regressions pass. |
| Pending SSR could outlive the publication snapshot. | Final generation admission follows full async GET/HEAD rendering; controlled retirement barrier passes. |
| Compiled passages/headings/labels could be oversized or inconsistent with rendered AST. | Per-page bounds and canonical annotation/text/order/ancestry validation reject stale/orphaned data; old snapshots without additive metadata derive from admitted AST. Five focused admission cases pass. |
| Lowercase offsets, merged cells, missing visible labels and formatted heading identity corrupted search. | NFC-aware original-text ranges, boundary-preserving visible-text passages and heading anchors; compiler/search/text regressions pass. |
| Search ranking/targeting lacked section context and descriptions. | Bounded per-page section results, ancestry, visible labels/descriptions, original-text highlights, immutable index windows and per-manifest bounded query cache. Source tests pass; final interaction/archive checks pending. |
| Search viewport, nested focus, input naming and modifier navigation were broken. | Reader/shared Command corrections implemented; final real styled-browser acceptance in progress. |
| CodeBlock transformer/build entry identities were incomplete. | Owned by the shared CodeBlock/build correction track; source implementation present, final regression/archive evidence pending. |

The following rows retain the initial correction history; their tests do not
substitute for follow-up qualification above.

| Finding | Resolution and evidence |
| --- | --- |
| File growth between metadata check and read could allocate beyond content budgets. | Capped Bun file slices enforce limits before allocation; controlled stat/read growth regression passed 1 / 5 independently. |
| Private Markdown could be aliased as a passive `.txt` attachment through a symlink. | Canonical target type and publication admission are checked before manifest/byte publication. The unchanged reproduction rejects `DOCS_ASSET_INVALID`; independent regressions 2 / 6 passed. |
| Async content/highlight work could publish a superseded development generation. | One shared generation/retirement boundary covers all projections, prepared highlighting and copy/admission; delayed work cannot restore retired content. |
| Bundled plugin SSR could resolve the consuming app's React instead of its bundled React. | Private build metadata selects the matching renderer for bundled plugin components; source file routes retain their app renderer. Hookful installed and relocated fixtures pass. |
| Saved theme preferences caused SSR/first hydration disagreement in the shared theme button. | Existing `useMounted` gives deterministic initial render, then reflects the persisted selection; no suppression of hydration warnings. Source and actual compiled light/dark checks pass. |
| Prose inline code incorrectly used a copyable block composition. | Safe AST prose uses a semantic inline `code` element; fenced blocks reuse the one shared CodeBlock family. |
| Long unbroken page titles widened the document at small widths. | Footer tracks/links are bounded and wrap; unchanged 320/768px reproduction now equals viewport width. |
| Closing mobile navigation left focus on BODY. | Native close-focus callback restores the actual trigger while allowing genuine page navigation; unchanged reproduction and installed gate pass. |
| CSS reduced motion did not stop reused Sheet/Dialog Motion effects. | Scoped public content AND overlay transitions honor the actual preference. Original 200/550/650ms animations now yield zero active animations in unchanged and installed tests. |
| Shiki JavaScript-regex output lost comment/notation boundaries on the supported Bun floor. | The existing single Oniguruma engine remains authoritative; focused syntax/notation checks pass without another highlighter engine. |
| Shared Button utilities overrode CodeBlock token metrics; radius aliases were absent. | CodeBlock's scoped action style uses tokenized metrics and actual core radius fallbacks; browser token overrides pass. |
| Default-discovery example pointed at `app/server/docs.plugin.ts`. | Package README and plugin index now use `server/plugins/docs.ts`, matching the real default discovery directory. |

No known confirmed defect is accepted as a documentation-only limitation here.
Staged features are product boundaries, not workarounds for broken implemented behavior.

## Release And Remaining Boundaries

- V1 correction implementation is being qualified. Final UI/build/installed-
  artifact closeout is in progress; no registry publish or main merge was
  performed by the checks recorded here.
- Local unpublished Bun archive consumers use an exact framework archive root
  override to resolve the optional package's framework peer, without patching
  package sources/imports. This is not a claim that an unpublished version exists
  in the registry.
- File-page apps retain their normal source-deployment requirements. The checked
  docs-only source-free artifact does not claim all arbitrary app routes are compiled.
- No global docs-next publication cutover or theme/component reorganization is
  inferred. Read-only behavior and staged authoring remain explicit in the
  [plugin roadmap](../../plugins/docs/roadmap.md).

## Related Reading

- [Inventory](./systems/docs-plugin.md) maps feature ownership and public exports.
- [Build contributions](../../backend/runtime/build-contributions.md) explains private artifact/runtime identity.
- [Reader](../../plugins/docs/reader.md) documents tokens, interaction and composition.
- [Search](../../plugins/docs/search.md) documents the implemented contract and privacy.
- [CodeBlock](../../frontend/components/public-pages/code-block.md) documents the replacement facade.

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

Inspected 2026-10-06 on `feature/markdown-documentation-plugin`. Implementation
commit `d342418` includes the feature plus current main `b960920` (2.4.3),
retaining the intervening array-policy, trigger and sidebar corrections.
The source release targets framework **2.5.0** and optional
`@zero/plugin-docs` **0.1.0**. Final archive/browser qualification is tracked
separately below; no npm registry publication or public docs-tree cutover is inferred.
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
shared CodeBlock/build tracks. Source UI acceptance and **rebuilt installed-artifact
qualification now pass** at implementation commit `d342418`. A release-commit
repeat retains exact provenance outside the repository; earlier artifacts are
not substituted for that final gate.

| Current gate | Executed evidence / remaining boundary |
| --- | --- |
| HTTP/artifact/server | `bun --no-env-file test packages/docs/src/server`: 35 passed / 312 assertions, zero failures, eight files. Includes frontend-reference invalidation, nonce/CSP no-store, exact projection validators, GET/HEAD, pending SSR retirement and strict search metadata admission. |
| Integrated unit/content/server/search | Final closeout: 104 passed /618 assertions, zero failures; includes title/description and standard frontmatter regressions. These overlap earlier focused gates and are not additive coverage totals. |
| Compiler/search/text | Owner-reported focused gate: 19 passed / 56 assertions. Earlier broad compiler/search/server/SSR gate: 76 / 482; retained as earlier checkpoints, not current totals. |
| UI response/range/selection helpers | 18 passed /101 assertions; included in integrated unit closeout. |
| Framework TypeScript | Integrated root and optional package checks passed with no diagnostics after the main merge. |
| Reader browser/SSR closeout | 23 passed /180 assertions including the existing sidebar suite: short viewports, independent scrolling, named controls, nested drawer/search focus and two-modal landing, native links, destination highlights, syntax preservation, reduced motion and no-JS reading. |
| CodeBlock/build | 45 focused tests /235 assertions; 11 CodeBlock browser tests /66 assertions. Native build/scaffold/UI examples: 24 /264. Subsequent exact-entry production serializer gate: 13 /67, including root/hash/replacement/chunks regressions. |
| Rebuilt archive | Fresh clean-implementation archive gate passed 1 /131 assertions, including an awaited five-test compiled-reader browser suite. Checks cover public package imports, normal CLI, copied/compiled source-free deployment, private admission, actual nonce-CSP hydration, section search/landing, mobile focus/motion, clipboard and no-JS reading. |
| Documentation | Current package/plugin/search/cache guides reconciled with source. Structural traversal: 715 pages/IDs/reachable, zero problems; `git diff --check` clean. Final combined example/closeout gate remains required. |

Current HTTP logs: `docs-http-server-final.log` and `docs-http-typecheck.log`
under the configured project logs root. `docs-http-cache-red.log` records the
unchanged pre-fix cache reproduction (zero passing/five failing tests), not a
current failure. Source and helper counts establish narrow contracts; they do
not imply a clean release commit, registry publication or whole-platform audit.

Corrected implementation archives are retained in `installed-k9QBpw` under the
external docs-plugin diagnostics root. `provenance.json` binds source commit
`d342418`, Bun 1.3.14, exact framework/docs archives and their SHA-256 to copied
and compiled deployment checks. The compiled-reader gate is now mandatory in
the installed test, so an HTTP-only success cannot hide a broken browser graph.
The release-commit repeat writes its own archive identities/provenance alongside
these records, without self-referential archive hashes inside the package.

Final source logs: `docs-reader-browser-qualified-final.log` (23 /180),
`docs-plugin-final-unit-qualification.log` (104 /618),
`docs-plugin-final-installed-qualification.log` (archive + compiled browser),
`docs-plugin-final-root-typecheck.log` and `docs-plugin-final-package-typecheck.log`.

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
| Search ranking/targeting lacked section context and descriptions. | Bounded per-page section results, ancestry, visible labels/descriptions, original-text highlights, immutable index windows and bounded query cache; unit and real-browser interactions pass. |
| Search viewport, nested focus, input naming and modifier navigation were broken. | Reader/shared Command and coordinated drawer-close corrections pass actual styled-browser acceptance. |
| CodeBlock transformer/build entry identities were incomplete. | Exact captured live hooks, explicit portable configuration identity and canonical/hash-bound entry snapshots pass focused unit/browser regressions. |
| Broad entry snapshot callbacks broke Shiki linkage in real production output. | Exact anchored entry filters restore Bun's dependency graph without disabling minification or splitting. Production ESM serializer regression is red→green; installed gate now requires browser hydration. |
| Standard `modes`/`related_packages` metadata was rejected. | Only those documented keys added to bounded safe metadata admission; actual Guardian frontmatter and private-publication regressions pass. |

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

- V1 implementation and correction qualification pass. The main-branch release
  retains all 2.4.1–2.4.3 fixes; the release-commit archive repeat is required
  before its tag/push. No npm registry or documentation-site publication is
  implied by source/local release qualification.
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

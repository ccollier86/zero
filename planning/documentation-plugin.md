# Optional Markdown Documentation Plugin

[Working plans](./index.md) · [Upcoming UI rework](./ui-rework.md)

Status: implemented working feature on `feature/markdown-documentation-plugin`;
not a shipped feature or public API reference.
Recorded 2026-10-06. Source inspection baseline: Zero 2.4.0 main
`636b1c01b3484317df56ce624c7cd57976ee417c`.
Framework target 2.5.0; optional `@zero/plugin-docs` target 0.1.0. The original
design below includes staged ideas as well as implemented V1 behavior. Supported
exports/options are defined by the [current plugin guide](../docs/plugins/markdown-docs.md)
and [configuration reference](../docs-next/plugins/docs/configuration.md), not
every illustrative proposal in this planning record. Installed archives and
source-free builds have been qualified; publication remains a separate step.

## Implementation Reconciliation

- [x] Optional package and native plugin declaration with a required build.
- [x] Bounded CommonMark/GFM/directive parsing and one admitted publication manifest.
- [x] `.docsignore`, private/draft admission, safe links and manifest-owned attachments.
- [x] Tokenized Elysia-inspired reader, nested navigation rails, TOC and page links.
- [x] Shared replacement CodeBlock implementation; no duplicate renderer family.
- [x] Development withdrawal/rebuild lifecycle and awaited shutdown.
- [x] Normal CLI build, installed archives, relocated/no-source and compiled SSR.
- [ ] Publish compatible releases after the feature handoff; working archives are not registry releases.

Detailed evidence and confirmed corrections belong in the
[qualification ledger](../docs-next/_work/audits/docs-plugin-qualification.md).
Protected reads, version collections, registered previews and authoring remain
the staged roadmap, not quietly implemented configuration flags.

## 1. Product Contract

**Install the optional package, point it at a Markdown folder, and get a
complete documentation experience.** Folder discovery, routes, navigation,
page rendering, search, table of contents, styling, and build assets are the
plugin's responsibility. Ordinary applications should not implement those
pieces or copy a page template per Markdown file.

It should work as a `/docs` section of an existing Zero application or, with an
optional base-path change, the documentation-first experience of a Zero site.
The plugin requires no additional documentation database, Fabric mode, external
search service, new authentication system, or per-page React component. The
host remains a normal Zero app with its existing required configuration; this
plan does not silently introduce a separate database-free application mode.

The first implementation is a **read-only viewer**. Permission-gated editing
inside that same viewer is a [roadmap feature](#12-roadmap-and-reserved-extension-points).

### Initial Release Boundary

V1 includes the public folder-to-docs experience, responsive/tokenized UI,
SSR, automatic navigation/TOC/search, links/assets, code/callouts, development
refresh, production packaging, basic metadata/sitemap, public Markdown projection,
and optional branding/base-path/navigation/publication settings.

Protected read mounts, multiple version collections, and registered interactive
component previews are staged optional follow-ups after that core is qualified.
Their contracts are designed below so V1 does not preclude them; they must not
quietly become prerequisites for releasing the basic plugin. Editing is later
roadmap work, not part of either read-only milestone.

### Reference And Scope

[Starlight](https://starlight.astro.build/getting-started/) is an Astro-based
documentation integration. Adding it to an existing project includes framework
and content-collection setup; it is not literally a standalone folder reader.
See its [manual setup](https://starlight.astro.build/manual-setup/).

The experience to adopt is its easy content-driven documentation, including
[generated sidebar navigation](https://starlight.astro.build/guides/sidebar/)
and [search enabled without separate app configuration](https://starlight.astro.build/guides/site-search/).
Zero should deliver that experience through its own Bun/Elysia/React integration.
Astro is an inspiration, not a required second application runtime.

This pass does not implement the global UI redesign, reorganize the component
library, change current documentation entry points, or publish `docs-next/`.

## 2. Minimal Installation And Sensible Defaults

The implemented minimal application setup is shown below; the package is not
published yet, so the install command applies after compatible publication:

```sh
bun add @zero/plugin-docs
```

```ts
// server/plugins/docs.ts — native factory in the default discovery folder
import { docs } from '@zero/plugin-docs';

export default docs({ contentDir: './documentation' });
```

The existing server-plugin discovery convention is the preferred installation
surface. The factory should return a native Zero extension declaration with
the new build/render contributions it needs. Resolve `contentDir` against the
application's established project/configuration root; file location or a changed
process working directory must not silently alter the selected folder.

Do not require another configuration file, a manually maintained route array,
Tailwind setup, content collections, a copied layout, or a search index command.
An eventual install/scaffold helper can generate this tiny declaration; it must
not perform undocumented application edits just because a dependency is installed.

If an app deliberately disables plugin-directory discovery, diagnose the missing
registration clearly. A small explicit extension-list option may be justified
for that composition, using the existing native extension type; it is not a
current AppConfig field or required setup for the default path.

| Concern | Default behavior |
| --- | --- |
| Required setting | Only `contentDir`. |
| URL | `/docs`, with pages below that mount. |
| Site name/logo | Existing app metadata where available; a useful fallback title. |
| Titles | Frontmatter title, otherwise first H1, otherwise a readable filename. |
| Metadata | Optional; normal `.md` files work without frontmatter. |
| Navigation | Folder hierarchy, readable labels, deterministic natural ordering. |
| Optional exclusions | A content-root `.docsignore` file, plus explicit config exclusions; no ignore file is required. |
| Root/section landing | `index.md`; `README.md` as fallback; generated index if neither exists. |
| Search | Built in; headings and text from admitted pages, with path/context results. |
| Table of contents | Generated from headings with stable linkable anchors. |
| Code | Escaped, highlighted, copyable; plain-text fallback for unknown languages. |
| Theme | Current shared Zero tokens and app theme selection. |
| Reading layout | Elysia-inspired left navigation/article/right TOC using current public/docs tokens; breadcrumbs optional/off. |
| Access | Public read-only documentation from the explicitly selected folder. |
| Development | Watch selected content and refresh the relevant docs snapshot. |
| Production | Deterministic compiled content/assets, without a live source watcher. |

If both `index.md` and `README.md` exist, `index.md` owns the landing route and
README remains an ordinary `readme` page. Explicit slug collisions fail with
actionable diagnostics; ordering must not choose a winner accidentally.

Optional controls should be progressive: `basePath`, title/logo links, manual
navigation overrides, publication selection, access policy, site URL/SEO,
version collections, and trusted example registration. These are proposed
configuration groups, not additional required setup. Access policy, version
collections and trusted preview registration belong to the staged follow-ups.

Support more than one independently named docs mount through the same factory;
validate overlapping paths and asset namespaces. A root mount must preserve
Zero's reserved system/API/build routes and reject conflicting app-page ownership.

## 3. Content And Navigation Contract

### One Canonical Content Manifest

```text
selected folder
  → contained file discovery + metadata validation + publication admission
  → Markdown AST + normalized links, headings and assets
  → immutable document manifest
  → SSR pages / navigation / TOC / search / SEO / raw Markdown projection
```

All outputs consume this same admitted manifest. A separate recursive search
scanner or raw-file server must not bypass the admission rules.

Each entry carries a source-relative identity, canonical route, title,
description, navigation attributes, headings, normalized content, content hash,
asset references, and access classification. Optional semantic IDs remain
distinct from route slugs so file moves and version matching can be handled.

Choose and qualify a maintained Markdown/AST pipeline during the first spike.
Inspect compatibility, license, sanitization, supported syntax, Bun's supported
runtime floor, and installed-package behavior before choosing dependencies.
Reuse the existing Shiki dependency/highlight responsibility where appropriate.
Do not write a new Markdown parser or require executable MDX for normal content.

### Supported First-Pass Authoring

- Standard Markdown plus useful GFM features: tables, task lists, strikethrough,
  fenced code, links, and images; include footnotes if the selected pipeline
  supports them with a qualified, documented extension.
- Stable heading anchors, including repeated headings and non-ASCII titles;
  TOC and rendered HTML use the exact same anchor calculation.
- Optional frontmatter for title, description, slug, navigation label/order,
  navigation visibility, search inclusion, redirects, and classification.
- Clear note/tip/warning/danger callouts, rendered through existing Zero UI.
- Code-block filename/title, line numbers, and line emphasis where the current
  reusable code rendering supports them or a scoped enhancement is qualified.
- Relative Markdown links resolve to generated routes, preserving fragments
  and query strings. Resolve relative images through the admitted asset manifest.
- Explicit custom navigation can mix automatic folder groups and manual links;
  autogenerated navigation remains the complete default.
- Unknown namespaced metadata can be retained as data. Invalid recognized values
  receive file/field diagnostics; they must not silently alter authorization.

Avoid duplicate titles when a document already contains its first H1, while
preserving that heading's anchor or an equivalent alias in the article header.
Hide from navigation is a presentation choice, not an access-control or publication rule.
Search inclusion is separately configurable and never overrides denied admission.

Local link checking should cover files, routes, assets, and heading fragments.
Broken local references are production build errors by default; development
provides actionable diagnostics. Do not fetch external links or remote images
at build time by default.

A missing folder is a configuration error. An existing empty folder gets an
understandable development landing page showing how to add the first document;
production builds reject an empty admitted collection unless deliberately allowed.
An internal-only folder must not be made public just to satisfy that check.

### Folder Organization And Optional Ignore File

The user requested familiar folder-driven organization and an optional ignore
file. Proposed V1 name: **`.docsignore`**, placed at the selected content root.
It uses [Git-compatible ignore pattern syntax](https://git-scm.com/docs/gitignore),
not Git's repository tracking state or every Git configuration source. The
plugin must work without a Git repository and must not silently inherit the
project's `.gitignore`, a user's global Git excludes, or unrelated parent files.

Illustrative proposed `documentation/.docsignore`:

```gitignore
# Working material that should not become documentation pages
/internal/
/meeting-notes/
**/*.draft.md
**/*.backup.md
```

Use a qualified maintained matcher for comments, escaping, slash anchoring,
directory rules, `*`/`?`/`**`, and ordered `!` negation rather than a homegrown
glob approximation. Patterns match normalized paths relative to the content
root. Re-inclusion follows the documented parent-directory semantics; do not
promise that a file exception can rescue a still-excluded parent directory.
The initial contract uses one root file per mount, with a documented optional
custom ignore-file path/disable setting. Nested ignore-file cascading can be
considered separately without changing the meaning of the root patterns.

Optional config exclusions provide additional explicit deny patterns. They
cannot be undone by a file-level negation. An explicit publication allowlist,
mandatory containment/safe-file rules, and internal/draft/access classification
remain authoritative: ignore exceptions never grant publication or authority.
Ignore files themselves are never served or indexed.

Apply exclusions before Markdown-body parsing and before manifest construction.
The resulting eligible set powers pages, navigation, search, TOC/link resolution,
sitemap, raw Markdown, attachments and package/build outputs. Referenced assets
are subject to the same applicable exclusions; an admitted page referring to
an excluded local page/asset gets an actionable broken-reference diagnostic.
Do not silently copy an ignored asset to make that link work.

Watch changes to the root ignore file and config publication inputs as well as
ordinary documents. Recompute admission and replace the full snapshot atomically;
excluded documents must disappear from new search/navigation projections together.
Include these inputs in the deterministic build identity. A missing optional
default ignore file is normal. Any selected existing ignore file, default or
custom, that cannot be read/interpreted must fail closed, as must an explicitly
configured missing input or matcher failure. Never fall back to publish-all.

Sidebar organization derives labels/order from folder structure and optional
page/section metadata, with authored navigation overrides when wanted. Distinguish
three different intentions: **exclude from publication**, **hide from navigation**,
and **omit from search**. A hidden navigation entry can remain a valid, searchable
page; an ignored document has no published route in this mount.

## 4. Publication And Security

Pointing at a folder is an explicit content-publication choice. A default public
mount admits ordinary Markdown there, while denying dotfiles, dependency/build
folders, underscore working directories including `_work`, and pages explicitly
marked internal/private or draft/in-review. Only referenced, allowed assets are served.
Do not treat the surrounding app/repository as the content root.

The compiler must actually enforce classification. It must reject path traversal,
outside-root symlinks, unsafe URL schemes, duplicate canonical routes/IDs,
unsupported file types, and unbounded document/frontmatter sizes. Validate
real paths and final asset targets; checking a path string prefix is insufficient.
Markdown never executes JavaScript. Raw HTML is escaped by default; any future
trusted-HTML capability needs an explicit, tested allowlist/sanitization contract.
SVG and other active assets need a deliberate safe-serving policy.

Denied documents must be absent from routes, navigation, search snippets,
JSON manifests, Markdown downloads, sitemap/SEO, agent bundles, browser assets,
and copied production files. An authorized source scan is not permission to
publish everything it can read.

### Zero's Own Documentation

`docs-next/` is an internal/draft preparation tree today. The Zero docs-site
fixture must consume an explicit reviewed **public-only projection/allowlist**,
not point directly at the entire tree or flip every visibility value.
Preserve indexes, backlinks, semantic IDs, package-version applicability, and
the [existing publication gates](../docs-next/documentation-process.md#review-and-publication-gates).
Current package-local guides and root entry points remain unchanged until an
approved handoff, with an old-to-new URL/anchor map prepared first.

### Optional Protected Read Mounts

The access-policy seam must reuse Guardian's live page-session/authorization
contract. A protected mount checks access before returning HTML, search,
navigation data, raw Markdown, or attachments. Browser gating alone is not enough.
Do not copy the authentication implementation into the docs package.

Public and protected content manifests, search indexes and attachments remain
separate. Shared non-content CSS, icons and enhancement code can be reused;
they must contain no private text, titles or resource references. Never compile
private document text into publicly served JavaScript/search indexes. Protected responses
default to private/no-store; logout or organization changes clear in-memory
results and fence late search responses. Per-document/tenant policy expansion
can be added later without assuming every member of an organization has read access.
Explicitly protected mounts may admit `private` pages behind their configured
read policy; internal working notes and draft/in-review pages remain excluded.
Protected configuration with Guardian disabled must fail clearly at startup.

## 5. Reader Experience And Reusable Components

The initial experience must be polished in both themes, not just a functioning
Markdown renderer. The user's primary layout reference is now
[Elysia's documentation](https://elysiajs.com/at-glance): nested left links with
vertical guides, right TOC, readable article, rounded code/callout surfaces and
lightweight Previous/Next footer links. Keep **current Zero public/docs tokens**
for now; breadcrumbs are optional and off by default.

[Starlight](https://starlight.astro.build/) remains useful for content-driven
generation, [shadcn/ui's component pages](https://ui.shadcn.com/docs/components/base/button)
for preview/code/usage hierarchy, and [ReUI](https://reui.io/docs) for controls.
These are design references; exact code reuse needs license review and attribution.

The [page-experience design](./documentation-page-design.md) specifies the actual
article layout, callout/alert family, examples, related links, article-end
Previous/Next navigation, responsive behavior, and reference study. This is
additional to the architecture, not a replacement for it. The package should
produce that coherent reader experience from the selected Markdown folder.

Design the documentation shell, navigation and search through the
[Linear-inspired shared UI direction](./ui-rework.md#linear-as-the-main-visual-reference):
compact precise chrome, useful hierarchy and tasteful microinteractions. Keep
comfortable article typography. This is the current feature's design lens, not
a prerequisite to redesign every existing Zero component first or permission
to replace current theme defaults during this feature.

### Layout

- A compact header with identity, useful links, search, and the existing theme
  control; version selection only when versions are configured.
- A collapsible, active-route-aware left navigation with persistent group state,
  indented nested links and subtle vertical guide lines.
- A readable article with optional-off breadcrumbs, clear type hierarchy, anchors, code,
  callouts, previous/next pages, and useful related links.
- An optional right TOC with current-heading indication. Sidebars stay reachable
  and scroll within bounded areas; wide code/tables scroll inside the article.
- A deliberate mobile layout: accessible navigation sheet and on-page contents,
  usable search, no offscreen controls, safe areas, and text zoom support.
- Semantic SSR content: the article and links remain useful without JavaScript.
  Search, theme interaction, copying, and enhancements must not hide the article
  behind frontend authentication restoration or a hydration-only shell.

### Component Reuse

Compose public Zero Buttons, Button Groups, icons, Sidebar, Command/search
presentation, breadcrumbs, cards, tables, tooltips, collapsibles, and CodeBlock
where their supported behavior fits. Generic Tabs, Sheet, Dialog, Accordion and
internal generic controls exist but lack supported public exports; add narrowly qualified
facades if needed by this optional package. Domain-level DocsShell/navigation/
article components compose these responsibilities; they do not recreate them.

The user subsequently authorized making the missing docs-specific compositions
and selected the CodeBlock upstream. Keep reusing existing Zero controls/icons
where their contract fits; this authorization does not call for another general
UI primitive library. Do not replace a Zero control with an unstyled native
control for convenience.

Reusable preview/code panels can compose the existing tab implementation behind
a supported facade together with public CodeBlock controls.
The registered interactive-preview feature is a staged follow-up; the initial
Markdown reader still provides polished code-example presentation. Plain Markdown
does not need a preview registry, and arbitrary code fences never execute.
Live playgrounds and generated API-reference tooling are separate roadmap work.

### CodeBlock Upgrade Candidate

The user nominated
[pheralb's Code Blocks](https://code-blocks.pheralb.dev/docs/getting-started/prerequisites)
for a possible near-term upgrade, including its surrounding UI/highlighting
features. Evaluate it during the dependency/component spike before freezing
the documentation code-example design. No replacement is approved by this plan.

Its [component composition](https://code-blocks.pheralb.dev/docs/react/code-block)
and [demonstrated features](https://code-blocks.pheralb.dev/) are useful candidates
for more flexible headers/actions, filename/language indication, numbers,
wrapping, emphasis, diffs, focus, and linkable lines. These need integration
with Zero's existing file tabs, copy hooks, icons, errors, and public API.

The [upstream prerequisites](https://code-blocks.pheralb.dev/docs/getting-started/prerequisites)
describe Tailwind styling, icon dependencies and optional Base UI blocks.
Review what is actually needed; Bun support is a qualification requirement,
and Node-oriented setup instructions do not authorize adding a Node runtime.
Select the supported highlighter path rather than requiring every engine.

Before adoption, qualify license/provenance, token-driven Shiki colors and
notation styles, SSR/browser consistency, escaping, optional language loading,
bundle size, keyboard/accessibility, and copy fidelity. Test line anchors across
multiple code blocks and avoid duplicate page IDs. Focus effects must not make
text inaccessible or remove it from copied code.

Preserve Zero's existing CodeBlock imports/props unless an explicit migration
is approved. Prefer one upgraded component responsibility, with focused utility
modules and additive options, over a docs-only duplicate. If adopted, update
the existing CodeBlock guide and the new documentation examples together.

## 6. Full Theme Contract

Everything visual must be token-driven: typography and prose, spacing/density,
control/icon sizing, surfaces, contrast, borders, radii, shadows, focus and
selection, code syntax colors, motion, and reduced-motion behavior.

Docs-specific aliases such as reading width, sidebar width, TOC width, header
height, prose rhythm, and code surface/line emphasis extend Zero's shared
theme. Their defaults can match today's design. They must not introduce a
second palette, fixed third-party typography theme, or independently selected
syntax-highlighting colors.

Reuse does not prove tokenization: [CodeBlock](../src/components/code-block/code-block.tsx)
currently defaults to GitHub Shiki themes and fixed metrics. Inspect the actual
primitives used and close necessary token gaps in their owning responsibilities.
Keep compatibility for existing explicit component theme overrides.

Acceptance includes overriding shared font, spacing, surface, border, radius,
code, and motion tokens and verifying that the whole docs experience follows.
Theme values may have centralized defaults; unexplained visual literals in
components do not qualify. Structural values such as `min-width: 0` are layout
mechanics, not a competing theme.

## 7. Native Framework Integration Required

### Verified Existing Seams

| Seam | Inspected implementation |
| --- | --- |
| Public native extension factories | [server exports](../src/frontend/server.ts) and [extension definitions](../src/frontend/server/server-extensions.ts). |
| Plugin-folder discovery and mounting | [route loader](../src/frontend/server/server-route-loader.ts) and [platform routes](../src/frontend/server/app-platform-routes.ts); extensions mount before the page catch-all. |
| Awaited extension drain before service disposal | [app composition](../src/frontend/server/app-factory.ts). |
| Shared CSS and browser asset build | [asset build](../src/frontend/server/app-build-assets.ts), [style build](../src/frontend/server/style-bundle.ts), and [client build](../src/frontend/server/client-bundle.ts). |
| SSR and page authorization | [renderer](../src/frontend/router/renderer.ts) and [router](../src/frontend/server/router-plugin.ts). |

### Missing Connections To Implement, Not App Workarounds

1. **Discover declarations before assets are built.** Today asset construction
   precedes plugin discovery. Read extension contributions once, validate them,
   then compile the docs content and required frontend assets. Privileged
   runtime `setup` remains separate and is invoked only at its normal lifecycle.
   Capture an immutable application/configuration root in this declared-build
   context: current config normalization does not expose config-origin metadata.
   Accept explicit absolute paths/file URLs and fail ambiguous root resolution
   instead of silently selecting a folder from a different launch directory.
2. **Provide a small build-contribution contract.** Admit namespaced plugin
   outputs/browser entries and either declared stylesheet sources or prebuilt
   scoped CSS that references Zero tokens. Installed package classes are not
   currently part of app Tailwind scanning.
3. **Expose a resolved read-only frontend asset manifest.** Setup/rendering
   receives actual shared stylesheet and plugin enhancement URLs; packages do
   not import private files, guess hashed filenames, or scan output directories.
4. **Provide shared page rendering/admission.** Resolve public/protected page
   policy through the normal Zero page-session path. Ordinary extension Bearer
   middleware is not by itself equivalent to authenticated browser page access.
5. **Qualify deployment asset inclusion.** Register content and referenced assets
   in production builds, packaged consumers, container deployments, and supported
   self-contained/compiled builds. The standard Zero application build must
   execute declared docs compilation before bundling the server, then include
   the resulting manifest/assets. Today's scaffold runs bare `bun build`, which
   does not execute runtime plugin discovery or `createApp()`; wire the normal
   build/scaffold path and document the corresponding existing-app build-script
   upgrade. Runtime production startup consumes the built result and does not
   rebuild silently from absent sources. Dynamic folder reads are not embedding.
6. **Respect required build failures.** The current optional app-asset builder
   catches failures. A declared docs plugin's essential content/style assets
   must fail qualification/startup clearly rather than serve a broken docs page.

Keep these additions additive and narrowly reusable by optional plugins. Do not
build a universal plugin marketplace/framework or refactor the entire page router
as a prerequisite. Prefer a small SSR docs route with isolated enhancement assets
over requiring every document to become an interactive file-router module.

Use an isolated plugin asset namespace; existing client-bundle cleanup must not
delete it. Reuse the consuming application's compatible React/React DOM identity
and respect its application-owned CSP policy. Current rendering has no public
CSP/nonce contribution contract; the new render seam should accept a request-local
nonce where the app supplies one, or use compatible external enhancement scripts.
Do not cache a request nonce in a content manifest. Base-path handling and sitemap
entries have one owning registry, with collisions detected before routes mount.

## 8. Build, Search, Versioning, And Lifecycle

- Content compilation produces deterministic hashes/manifests from normalized
  admitted inputs; no ambient timestamp, current working directory, or raw
  machine-specific path affects route identity.
- Build and publish each snapshot atomically. A partially generated navigation
  tree must not reference old search results or missing assets.
- Production reads compiled snapshots, with stable ETags for public content and
  content-hashed public assets. Protected content never inherits public caching.
- Development watches only admitted roots/assets, coalesces edits, fences stale
  rebuilds, and handles deletions/renames. Invalid rebuilds show safe diagnostics
  and fail closed for affected docs instead of showing partially admitted data.
- Watchers, search workers, and pending rebuild work are app-owned and bounded.
  Drain/abort them before their dependencies disappear on shutdown.
- Built-in search is bounded and content-derived, with heading/context matches,
  keyboard navigation, clear no-results/error states, and superseded-query
  cancellation. Public search can use a lazy-loaded public index; protected
  search goes through authorized server endpoints. Choose the engine after a
  realistic corpus/package benchmark, not through a required external service.
- Optional version collections map explicit names to content roots. They reuse
  the pipeline and namespace routes/indexes/assets; ordinary use has one version
  and no version selector. Cross-version page matching uses semantic identity
  where available and an understandable fallback when a page does not exist.
- Generate titles/descriptions and optional canonical/OpenGraph/sitemap data.
  An absolute site URL comes from explicit configuration or trusted app metadata;
  do not fabricate production origins from arbitrary Host headers.
- Provide a generated document index and per-page Markdown view/download for
  agents from the same public projection. Aggregate full-text bundles are
  optional and bounded; no second manually maintained documentation corpus.

These are implementation requirements and design choices to qualify, not claims
that Zero's current build/search system already implements them.

## 9. Responsibilities, Errors, And Observability

Suggested small responsibilities within the optional package:

- Config and frontmatter validation.
- Contained discovery and publication admission.
- Markdown parsing/link normalization and safe rendering.
- Immutable manifest compilation and version/route identity.
- Asset and build contribution.
- Navigation/search projection and search execution.
- Thin Elysia routes using shared page admission.
- Docs shell/article/navigation components and focused enhancement hooks.

Keep transport, domain policy, file/build mechanics, and React interaction
separate. Use Bun APIs where suitable; Node compatibility is acceptable only
when no appropriate direct Bun replacement exists. Do not introduce a database
for read-only file-based documentation.

Follow [Zero engineering](../docs/engineering-standards.md) and
[observability](../docs/observability.md). Add stable domain error/`OBS_CODES`
entries in the owning namespace; proposed families include config/content/build
failure, missing document, denied access, search failure, rebuild, and lifecycle.
Use app-bound backend emission and `emitFrontendCode()` for browser failures;
no reusable `console.*` logging or process-global cross-app event ownership.

Expected config/content failures should give trusted developer tooling bounded
file/field diagnostics and a useful correction. Public HTTP responses stay
sanitized, preserve appropriate machine codes/statuses, and do not include
absolute paths or raw exceptions. Do not log document bodies, private titles,
search terms, credentials, or arbitrary frontmatter. Cancellation and ordinary
not-found/no-results states are not operational failures. Report a failure once
at its owning boundary rather than duplicating it across each layer.

Add focused Doctor/build diagnostics for declared roots, effective mount paths,
collisions, metadata, admitted page/asset counts, broken local references, and
missing required outputs. Use the same validators as compilation. Diagnostics
must not fetch third-party services, execute preview code, expose private content,
or alter source files. A Doctor contribution seam, if needed, is a scoped
implementation addition rather than an already available plugin API.

## 10. Delivery Sequence

Each item is incomplete until implementation and its checks exist.

1. [ ] Freeze the minimal factory/configuration and content/publication contract;
   create a feature branch for implementation and inventory exact public imports.
2. [ ] Qualify the Markdown/search/highlighting dependencies with a small synthetic
   folder; verify Bun/runtime compatibility, license, security, and token support.
   Include the [CodeBlock candidate](#codeblock-upgrade-candidate) decision without
   assuming that the reference implementation can be copied unchanged.
3. [ ] Add the narrow extension declaration/build/asset/page-admission seams with
   focused regression tests, preserving apps without the plugin.
4. [ ] Implement one complete public `/docs` mount: ordinary Markdown, generated
   routes/sidebar/TOC, links/assets, search, SSR, code/callouts, and both themes.
5. [ ] Complete V1 optional configuration, metadata/sitemap and public agent
   Markdown projection. Keep protected reads, versions and registered interactive
   previews behind separately qualified follow-up milestones.
6. [ ] Qualify watchers/shutdown, deterministic production manifests, archive
   consumers, deployment assets, and supported compiled packaging.
7. [ ] Build a documentation-site fixture from an approved public projection of
   Zero's own content; review the reader/component-page experience with the user.
8. [ ] Finish guides, exact config/token references, examples, indexes/backlinks,
   install/upgrade instructions, independent review, and release qualification.
9. [ ] After V1 qualification, implement/review the optional protected-read,
   versioned-content and registered-preview milestones using the reserved seams.

Do not mark this complete after rendering one page. Do not silently publish
the new Zero docs as part of testing the plugin. Fix confirmed defects in scope;
discuss meaningful scope changes instead of documenting around broken behavior.

## 11. Acceptance Gates

These gates qualify the core release. Checks for protected reads, versions and
interactive previews apply when those staged features are implemented; record
their status separately rather than claim V1 has already passed their contracts.

- [ ] Fresh package-mode app installs the package and supplies only a folder;
  `/docs` works with plain Markdown and without application-owned pages/styles.
- [ ] No plugin means no docs routes, content scans, watchers, search loading,
  parser/browser dependency imports, or build/runtime regressions in ordinary apps.
- [ ] Standalone/root and multiple mounts resolve links/assets correctly while
  preserving system routes and rejecting collisions; non-default project roots
  and changed launch directories cannot select unintended content.
- [ ] Article HTML, navigation links, headings and metadata are present in SSR;
  deep links and a no-JavaScript reader work.
- [ ] Filename/frontmatter/H1 precedence, index/README rules, natural ordering,
  Unicode/duplicate headings, local links/fragments, and image paths are tested.
- [ ] Unknown/invalid metadata, malformed Markdown extensions, oversized inputs,
  unknown code languages, and safe raw-HTML handling have clear behavior.
- [ ] Internal/draft/_work sentinel content appears in none of the public HTML,
  manifests, search, Markdown, attachments, sitemap, JS, or production archive.
- [ ] `.docsignore` rules cover files/directories, anchored and recursive patterns,
  comments/escaping, CRLF, ordered negation and parent exclusion. Config denies
  and mandatory publication boundaries cannot be overridden by negation.
- [ ] Ignore-file edits invalidate complete manifests; removed documents/assets
  do not linger in new navigation/search/build projections. Missing default
  files work; unreadable existing default/custom files, explicit missing inputs
  and matcher failures fail safely.
- [ ] Traversal, encoded-path tricks, unsafe schemes, symlink escape, malicious
  HTML/active assets, and route/asset namespace conflicts are rejected.
- [ ] Protected reads and search reuse live Guardian admission; fresh signed-out
  users can reach public docs, revoked users lose private access, and cross-org
  cached/late results cannot leak. Private data is never in a public bundle.
- [ ] Theme-token overrides affect typography, spacing, controls, surfaces,
  highlighting and motion. Light/dark, keyboard, touch, text zoom, narrow layouts,
  reduced motion, and focus restoration receive actual browser/visual review.
- [ ] The [reader-experience review](./documentation-page-design.md#7-design-review-before-calling-it-polished)
  covers real overview/how-to/reference/component-page compositions, including
  callouts and title-bearing Previous/Next article navigation.
- [ ] Preview/code tabs execute only registered trusted examples and do not require
  every normal page to download an entire component-library demo bundle.
- [ ] Search handles a realistic Zero-sized corpus with bounded work and lazy
  loading; older query results cannot replace newer results.
- [ ] Version navigation, canonical URLs, redirects and sitemap entries agree;
  absent cross-version pages have a defined fallback.
- [ ] Dev edit/delete/rename and overlapping/failed rebuild tests prove complete
  snapshot replacement; shutdown leaves no plugin work/timers running.
- [ ] Deterministic builds, required failure propagation, two apps in one process,
  fresh installed archives, and deployment with no source folder are verified.
- [ ] Doctor/build diagnostics agree with runtime configuration and publication
  admission without reading live app data or executing component previews.
- [ ] Guide examples typecheck against the frozen package; docs and package
  exclusions are inspected rather than inferred from source-tree success.

Use focused unit/integration/browser/package checks by responsibility. Run the
wider release gates at the actual release boundary, not after every prose edit.

## 12. Roadmap And Reserved Extension Points

### Permission-Gated Editing In The Viewer — Explicitly Not V1

The same documentation viewer could expose edit controls when the current user
has the appropriate Guardian permissions. Reading and editing are independent
capabilities; hiding the editor is not server authorization.

Future design must cover:

- [ ] Configurable organization/platform author/editor/publisher authority and
  document scope, with live revocation and no membership-only privilege grant.
- [ ] A supported writable content backend: repository/filesystem adapter or
  persisted content/revision adapter. Deployment snapshots are not assumed writable.
- [ ] Revision-checked saves, conflict handling, autosave/drafts, history, and
  a clear distinction between saved work and published content.
- [ ] Visual/Markdown editing, previews, unsaved changes, asset attachment rules,
  and optional approval/review before publication.
- [ ] Authorized durable mutations and audit receipts, with atomic manifest/search
  refresh or a deliberate build/deploy publication workflow.
- [ ] Multi-tenant content isolation where configured, safe rollback, and cache/
  public-index replacement when visibility changes.

V1 reserves document identity, revision/hash and projection boundaries so this
can be added cleanly. It creates no editor, write endpoint, database schema,
authoring roles, or background publishing service.

### Other Later Opportunities

- [ ] Interactive playgrounds and prop/config playground controls.
- [ ] Generated API references from verified public exports/types.
- [ ] Localization and locale-aware navigation/search/version selection.
- [ ] Richer documentation extensions and reusable page-block packs.
- [ ] Git/repository editing integration and controlled publication tooling.
- [ ] Agent discovery/MCP integrations consuming the same admitted manifest.
- [ ] Adoption of the [future global UI rework](./ui-rework.md), preserving the
  docs token contract and application overrides.

These roadmap ideas are not prerequisites for the basic install-and-folder
experience and must not inflate its required configuration.

# Documentation Page Experience

[Working plans](./index.md) · [Plugin architecture and delivery](./documentation-plugin.md)
· [Shared UI rework](./ui-rework.md)

Status: implemented V1 reader on `feature/markdown-documentation-plugin`, with
staged follow-up ideas; not a published release or public API reference.
This complements the plugin architecture; it does not replace the install-and-
folder contract. Recorded 2026-10-06 against Zero 2.4.0 main
`636b1c01b3484317df56ce624c7cd57976ee417c`.

The reference study below is retained as design provenance. The working reader
now lives in `packages/docs/src/ui/`; the existing CodeBlock implementation is
replaced by the tokenized, upstream-adapted composable family. See the
[reader reference](../docs-next/plugins/docs/reader.md),
[CodeBlock guide](../docs/frontend/code-block.md) and
[qualification ledger](../docs-next/_work/audits/docs-plugin-qualification.md)
for implemented behavior and evidence. The global theme/library reorganization
remains later work.

## 1. Reference Study And Design Direction

Study actual documentation pages, their layouts, reusable blocks, navigation,
and mobile transitions. Framework feature lists alone are not sufficient design
references. Choose one coherent reading experience and express it using Zero's
shared design tokens and existing component responsibilities.

The user's latest primary reference for the documentation layout is
**[Elysia's documentation](https://elysiajs.com/at-glance)**, illustrated by their
four supplied screenshots: grouped nested left links with vertical guides, a
right TOC, an uncluttered central article, rounded code/callouts, and lightweight
article-end navigation. Those screenshots are the visual reference for this
feature; they do not authorize copying the site's palette or implementation.

For now use **Zero's existing public/frontend design tokens**. The
[shared UI plan](./ui-rework.md#linear-as-the-main-visual-reference) records
Linear as the longer-term direction for typography, density, surfaces and
microinteractions. We can apply its interaction principles while designing this
component without replacing today's palette or redesigning every app control.
The docs experience will inherit later approved token improvements.

Initial references inspected as rendered public pages:

| Reference | Observed pattern | Direction for Zero |
| --- | --- | --- |
| [Elysia At Glance](https://elysiajs.com/at-glance) and user screenshots | Group/category headings, indented left links with connecting guides, subtle active pills/markers, a right TOC, calm reading surface, rounded code/callouts and restrained Previous/Next links. | Primary reference for this plugin's docs layout and reading/navigation feel. |
| [Starlight Markdown guide](https://starlight.astro.build/guides/authoring-content/) | Persistent header, grouped left navigation, readable central article, right TOC, code examples, and article-end Previous/Next cards with destination titles. | Secondary reference for content-driven generation and reading behavior, not the default footer-card styling. |
| [Starlight Asides](https://starlight.astro.build/components/asides/) | Named note/tip/caution/danger blocks with an icon/title, contextual body content and optional custom titles. | A compact, consistent callout family mapped to Zero's semantics. |
| [Astro content collections guide](https://docs.astro.build/en/guides/content-collections/) | A substantial technical article with contextual notes/tips, headings, code and article-end navigation/source links. | Verify that the layout remains usable for long, deeply technical guides. |
| [shadcn/ui Button documentation](https://ui.shadcn.com/docs/components/base/button) | Concise title/description, examples and code, installation choices, usage, variants, API reference and secondary TOC. | Reference for component-guide hierarchy and compact example presentation. |

The earlier isolated browser inspection covered desktop article tops/ends, Starlight
callouts in light/dark themes, and its mobile layout. Reference screenshots are
diagnostic evidence under the project's external artifacts directory, not new
product assets or a promise to copy those sites' exact dimensions/palettes.
The Elysia reference above was inspected from the user's screenshots and its
published page; do not describe it as a completed interactive-browser audit.

[Starlight link cards](https://starlight.astro.build/components/link-cards/),
[reading steps](https://starlight.astro.build/components/steps/), and
[tabs](https://starlight.astro.build/components/tabs/) provide focused references
for additional documentation blocks. Their authoring/component syntax is not
automatically Zero's API.

## 2. Default Page Composition

```text
Shared docs header: identity · search · useful links · theme
─────────────────────────────────────────────────────────────
Section navigation │ Article                         │ On this page
                   │ Optional breadcrumbs (off)      │ Headings
                   │ Title + short description       │ Active section
                   │ Text / code / callouts / tables │
                   │ Related reading, when supplied  │
                   │ Source/review metadata, if known│
                   │ ← Previous title | Next title →│
```

- Navigation is compact and grouped; the article receives the main reading
  space. TOC is secondary and optional, never a competing control plane.
- Use the Elysia-inspired three-column reading composition with restrained
  section dividers, rounded code/callout surfaces, and a quiet article canvas.
  Use current Zero token values; do not hardcode the reference's pink/purple
  colors, font or corner radii.
- Reading width, navigation widths, heading/body scales, padding, gaps and
  surface separation come from shared tokens and documented docs aliases.
- Apply the Linear-inspired motion vocabulary to controls and meaningful state
  transitions while keeping article text and reading position stable. SSR text
  is immediately readable; decorative entrances do not postpone the content.
- The header remains reachable. Navigation/TOC have bounded independent
  scrolling where needed; the article remains a normal reading flow.
- A docs section mounted inside an existing site must not accidentally nest
  two application headers, double the chrome, or widen the surrounding page.
- Article code, tables and long identifiers have contained overflow. Wide
  examples do not displace navigation or make the whole page scroll sideways.

### Article Header And Hierarchy

Use one H1, a concise introductory description, and optional small badges for
genuinely useful metadata. **Breadcrumbs are optional and off by default** in
this documentation layout: grouped navigation already provides orientation.
An app can enable a lightweight breadcrumb row for a deep hierarchy or hosted
site context. Do not reserve blank space when the row is absent.
Distinguish release/
feature maturity from documentation review state; a generic "verified" badge
must not imply a security audit or broader version support.

When extracting an existing Markdown H1 into the article header, preserve its
generated heading target or an equivalent anchor alias. Removing a duplicated
visible title must not break existing fragment links, even when frontmatter
supplies a different display title.

Prefer readable prose and intentional heading rhythm. Do not put each section
inside a large Card. An index, how-to, API reference, and component guide share
the shell but need different content compositions.

Heading anchors work by keyboard as well as pointer. Sticky headers must not
obscure the destination heading. TOC state derives from the same generated
headings, and a short page need not reserve an empty TOC column.

### Navigation Organization And Interaction

- Generate groups from the admitted folder hierarchy. Use section/index titles
  when supplied, readable folder labels otherwise, and one deterministic order
  shared by the sidebar, landing pages and Previous/Next destinations.
- Allow optional label/order/badge and manual grouping overrides without making
  them required for each file. Keep generated navigation useful on its own.
- Use compact rows, aligned icons/disclosure controls, subtle separators and
  a clear current-page state. A shared sliding highlight can enrich appropriate
  navigation/segments without moving the clickable target.
- **Make the user's preferred nested-link treatment the default:** a thin
  vertical guide for each nested group, consistent indents, and child text
  aligned on a shared inset. Guides come from public border tokens, with their
  spacing/weight controlled through shared/docs aliases.
- Group headings may use existing Zero icons and disclosure chevrons. Use a
  quiet rounded current-page pill and small leading accent marker, with subdued
  inactive text. Nested groups remain a navigable disclosure list; do not add
  ARIA tree-widget roles without implementing the corresponding keyboard model.
- Keep guides aligned through expanded nested sections, including long wrapped
  labels. The active leaf and its ancestor path should be identifiable without
  making every expanded or hovered link look like a second current page.
- Preserve expansion state for the current docs mount/version. Reveal the active
  page's ancestors after direct navigation; do not collapse the reader's context
  on every article change. Respect modified clicks and ordinary browser history.
- Treat hover, keyboard focus, expanded group and current page as separate states.
  Animate disclosures briefly and interruptibly; reduced motion stays usable.
- Apply [publication/ignore rules](./documentation-plugin.md#folder-organization-and-optional-ignore-file)
  before generating groups. Empty excluded groups disappear, and excluded pages
  do not leak through navigation labels, counts or generated landing cards.

### Built-In Search Experience

- Put a compact search trigger in the docs header with an icon and discoverable
  keyboard shortcut; reuse public CommandDialog/Command controls.
- Keyboard search respects inputs/editable content and existing shortcut owners.
  Opening/closing transfers focus deliberately and restores it when dismissed.
- Search all admitted article titles, headings and prose, with useful weighting
  and heading-fragment destinations. Exact titles/heading matches should be easy
  to find, not buried under long body-text matches.
- Present compact keyboard-selectable results with page title, section/path,
  heading where relevant, and a short safely escaped contextual excerpt. Repeated
  page titles remain distinguishable by path.
- Give clear pending, no-results, retry/error and loaded states. Cancel/fence
  superseded queries and snapshot/mount changes; preserve a stable result list
  during ordinary query refresh within the same admitted snapshot/scope. An
  ignore/publication/authorization change clears excluded results immediately;
  old results cannot remain while a new index loads. Avoid empty-list flashes
  for every keystroke without relaxing these boundaries.
- Use consistent restrained result/selection transitions. Highlight matches as
  text/semantic marks, without treating a query or excerpt as trusted HTML.
- Search the same eligible manifest as the sidebar and pages; no separate raw
  folder scan. Ignore-file changes remove results along with routes/navigation.
- Keep the existing Gooey search scoped to its table use cases. This docs search
  is a header/command-palette experience, not an automatic reuse of table chrome.

No external search setup, app-owned search endpoint or manually generated index
is required for normal public docs. The eventual protected-search variant must
also obey the architecture plan's server authorization and cache boundaries.

### Right-Hand Table Of Contents

Use the Elysia-like compact heading list with a subtle vertical rail, indented
subheadings, subdued inactive text and a small active-section marker. Keep it
sticky/reachable within its own bounded area, with stable anchor destinations
and a clear distinction between the current heading and hover/focus.

The TOC should not steal article width or render a permanent empty column on
short pages. On narrow screens, use the documented on-page disclosure. A
supplementary right-rail slot can support configured links or sponsor blocks
later; sponsor images, AI-chat controls and unrelated widgets are not required
parts of the first Markdown viewer.

## 3. Documentation Blocks

### Callouts And Alerts

Provide note, tip, warning/caution, and danger variants with:

- A recognizable Zero icon, meaningful title, and compact body spacing.
- Restrained semantic surface/border treatment, readable in both themes.
- Optional author-supplied title and ordinary Markdown inside the body.
- Accessible meaning beyond color; long content and code still fit the article.
- Static supplementary-information semantics. A documentation warning is not
  automatically a live `role="alert"` announcement on every page load.

Distinguish these from runtime error feedback, transient toasts, or a modal
AlertDialog. Runtime search/copy/load failures follow Zero's normal error
presentation and observability contracts.

Prefer a small consistent authoring notation that works in `.md`, documented
after the parser contract is qualified. Authors should not need to import React
components just to write a warning. Do not color every note as an urgent error.

### Code And Installation Examples

- File/language indication, useful copy action, syntax highlighting and optional
  line numbers through the reusable CodeBlock responsibility.
- Existing file tabs for multi-file examples; selectable alternatives for
  genuinely different approaches, with clear labels and documented persistence.
- Installation examples should use Bun first for Zero; other package-manager
  alternatives can be configured rather than hardcoded into every page.
- Long snippets may have a deliberate expand/wrap interaction. Never hide
  necessary code behind a visually ambiguous clipped area.
- Copy the source code, not decorative line numbers, diff markers, UI labels,
  or unrelated invisible examples.
- Evaluate the [CodeBlock upgrade candidate](./documentation-plugin.md#codeblock-upgrade-candidate)
  before finalizing diff/focus/emphasis and composable header features.

### Tables, Steps, Details And Link Cards

- Reference tables present option/name, type, default and explanation with
  readable alignment and contained horizontal overflow.
- Numbered reading steps preserve ordered-list semantics and may contain text,
  code or callouts. They are not the application's form Wizard.
- Optional details/disclosures keep supporting material available; prerequisites
  and essential safety instructions should not be buried by default.
- Related-reading links and index cards can include a title, short purpose,
  optional icon/badge and a clear destination. Use them selectively.
- Render Markdown's ordinary lists, links and blockquotes well without requiring
  decorative blocks or custom syntax throughout the content.

Interactive component previews remain a staged follow-up. Their eventual
preview/code/API hierarchy should fit this same shell and use registered,
trusted examples; a Markdown code fence must never become executable implicitly.

## 4. Article-End Navigation And Footer

Use a deliberate end-of-article composition:

1. Related reading when the author/manifest supplies it, without duplicating
   an existing related-guides section mechanically.
2. Previous and Next destination links derived from admitted navigation order.
3. A restrained metadata/source row only when valid information is available.

The default navigation follows the Elysia reference: lightweight linked text
regions with a small Previous/Next caption, actual destination title and arrow.
Use left/right alignment where both exist, then a deliberate narrow-screen
arrangement. Do not default to large raised/bordered navigation cards. The whole
destination region is a semantic link, not an unlabeled icon-only button.

On the first/last article, omit the unavailable direction. Do not render disabled
blank cards or numeric page counts. Reading order must use the same explicit/
generated navigation order as the sidebar and exclude non-admitted pages.

This is article navigation, not DataTable pagination or a floating administrative
action bar. The footer belongs after the article and must not cover its content.
A standalone site's optional global footer is separate from this article footer.

Show a source/repository link only when configured. An external source link is
not the future in-app documentation editor. Show last-updated/reviewed metadata
only from a qualified source; build time must not masquerade as a content update.
Feedback links can be optional simple links, not a mandatory new feedback service.

## 5. Mobile And Accessibility

- Compact header with usable identity/search/navigation controls.
- Deliberate section-navigation drawer/sheet and a separate, lightweight
  "On this page" disclosure. Avoid stacked permanent sidebars.
- Maintain route/heading labels, close/return behavior, focus restoration, and
  keyboard access through existing Zero interaction primitives.
- Provide useful SSR section/index links when enhancement is unavailable;
  Sidebar's client-powered mobile sheet alone is not a no-JavaScript fallback.
- Keep wide code/tables inside their own horizontal scroll boundaries, preserve
  text zoom and touch usability, and avoid floating controls covering content.
- Honor reduced motion. Hover/current-page/current-heading/focus are distinct
  states, with purposeful restrained transitions from Zero's shared motion system.

## 6. Actual Zero Reuse Boundaries

### Public And Application Token Lanes

Zero already has distinct public/docs and application/admin presentation lanes
in [the shared stylesheet](../src/frontend/styles/globals.css), described by
[the token guide](../docs/frontend/design-tokens.md). These are two frontend UI
lanes, not a frontend versus backend-runtime styling boundary.

Public surfaces use `public-background`, `public-surface`, `public-muted`,
`public-accent`, `public-border`, `public-ring` and paired text roles. App/admin
surfaces use the core background/card/popover/sidebar roles. Fonts, radius,
semantic status colors and theme selection are shared today; typography metrics
and motion are not yet completely separated/tokenized per lane.

The default docs shell uses public-lane surfaces from the current theme. Keep
the reading canvas quiet instead of assuming that the marketing page's radial
background/glass treatment belongs everywhere. Changing public palette tokens
can be isolated from app palette changes, but a shared font/radius change still
needs deliberate cross-lane review.

A public wrapper does not automatically remap nested Sidebar or Command/Dialog
tokens, and portaled search/mobile surfaces may sit outside that wrapper. Use
a supported lane-aware composition/alias boundary for reused controls and their
portals. Do not fix mismatches by globally changing app/admin variables or by
reaching into private DOM structure with app-specific selectors. This bridge
is an implementation requirement, not a claim that all current controls already
support a complete public-lane variant.

The inspected [frontend barrel](../src/frontend/index.ts) and
[package exports](../package.json) establish these boundaries:

| Pattern | Existing public Zero pieces | Docs responsibility |
| --- | --- | --- |
| Header/breadcrumb metadata | Breadcrumb family, Badge, Button, Separator, theme controls | Content labels and article hierarchy. |
| Section navigation/mobile | Sidebar family and Collapsible | Manifest grouping, active route and expansion state; reuse Sidebar's existing internal mobile Sheet. |
| Search | Command/CommandDialog and child controls | Search controller, grouping, path/context results and cancellation. |
| Code examples | CodeBlock, its file tabs/copy behavior | Markdown mapping and the qualified highlighting/token upgrade. |
| Tables and bounded content | Table family, ScrollArea/ScrollBar, Separator | Prose styling, AST mapping and contained overflow. |
| Previous/next and related links | Card family, Button asChild, Zero icons | Semantic linked article composition and navigation metadata. |
| TOC | ScrollArea, Collapsible and links | Heading projection and active-heading controller. |

Generic Tabs, Sheet, Dialog and Accordion exist in source
but are not currently public barrel/subpath exports. If needed directly by
the optional package, add a narrow tested public facade to the existing owning
implementation; do not recreate them or import private source paths.

There is no dedicated public inline Alert/Callout, reading Steps, TOC, or docs
page-navigation family. Some are docs-specific compositions of existing Cards,
icons, lists and links; that is different from claiming an existing public
component exists. The user subsequently authorized the missing docs-specific
compositions. V1 now supplies a safe AST callout renderer, TOC and page navigation
inside the optional package, reusing Zero controls/icons instead of another UI kit.

The qualified CodeBlock replacement now exposes its own root/header/content,
file tabs, copy and package-manager compositions through the Zero facade; the
legacy block renderer and obsolete block styles are removed. CommandDialog and
Sidebar gained narrow portal/motion/focus options, not new parallel primitives.
Unused source-local Animate UI Code/CodeTabs/CodeBlock implementations and their
private import alias are also removed. Generic Tabs and copy controls remain
available to their other consumers.

Zero's public app `Link` depends on RouterProvider/client route interception.
Plugin SSR pages outside that app route manifest should use proper anchors
through existing `asChild`/link compositions unless explicitly integrated into
the router. Ordinary HTML navigation must remain correct without enhancement.

## 7. Design Review Before Calling It Polished

- [ ] Assemble an overview/index page, a long technical how-to, a dense
  configuration/API reference, and a component/code-example page in the fixture.
  The V1 component guide is read-only text/code presentation; registered live
  previews remain the staged follow-up.
- [ ] Review shell proportions, type hierarchy, prose rhythm, callouts, code,
  reference tables, search results and article-end navigation as one system.
- [ ] Exercise long titles, deeply nested navigation, no-TOC pages, first/last
  destinations, empty search, and very wide code/tables.
- [ ] Review the Elysia-inspired nested rails/indents, active leaf/heading markers,
  lightweight footer navigation and optional-off breadcrumb behavior.
- [ ] Review light/dark, narrow/wide, keyboard, text zoom, touch and reduced motion.
- [ ] Override core font/spacing/surface/border/code/motion tokens and confirm
  the entire composition follows, including reused primitives.
- [ ] Verify public-lane docs/search/mobile portals are consistent and do not
  restyle app/admin controls outside the docs surface.
- [ ] Verify heading destinations, focus restoration, readable static warnings,
  no-JavaScript reading/navigation, and the same admission/order across surfaces.
- [ ] Present the representative reading experience to the user before broad
  documentation-site cutover; preserve the architecture/publication gates.

These are implementation acceptance tasks. The reference-site inspection is
design research, not evidence that the Zero plugin or its UI already exists.

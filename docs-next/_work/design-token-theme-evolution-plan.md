---
id: zero.design-token-theme-evolution-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: design-system
status: draft
visibility: internal
system: design-system
feature: default-theme-evolution
maturity: planned
applies_to: ["Future theme work after the ingestion and search visualization components"]
modes: [browser, SSR, light, dark, application, public-pages]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Design Token and Default Theme Evolution Plan

[Working evidence](./index.md) · [Design system roadmap](../frontend/design-system/roadmap.md) · [Product roadmap](../../docs/platform-roadmap.md#user-interface-and-application-building)

Arc is now the user's selected leading reference for Zero's overall future
design language, across ordinary application controls and public pages as well
as charts. Build on the complete ingestion/search and supplied chart interfaces
already recorded here, preserving their explicitly approved behavior. Qualify
shared roles and representative compositions before replacing global defaults.
The Arc-led direction is agreed. The parallel backing foundation now has a first
concrete palette, type/spacing/density scale, task geometry and motion recipes;
see the [implementation and migration gates](#parallel-foundation-implementation-and-migration-gates).
Component variants and platform-wide default promotion remain unqualified.
The [typography system plan](./typography-system-plan.md) now separates Arc's
standard type scale from Zero's compact/analytical exceptions and defines actual
consumer adoption; declared size/font roles alone are not the completed system.
The user's subsequent requirements are explicit exceptions: preserve and expand
Zero's magnetic highlights, use Arc Morph Select as the default select visual
direction, make application dashboards more compact, and use Arc UI ScrollArea's
overflow treatment throughout bounded scrolling surfaces. These directions are
approved; the backing roles are implemented, while real component adoption,
compatible picker APIs and dashboard density still require qualification.

The [visualization implementation plan](./vector-visualization-plan.md) owns the
components, runtime integration and verification. This plan owns the visual
language they help establish, including the information panels around the maps.
The [chart implementation plan](./charts-system-plan.md) adds the supplied Sankey
and Race Bar as component-first foundations, preserving the existing Recharts API
while developing Zero-owned chart composition.
The [handmade coverage extension](../frontend/charts/native.md) uses
original Cartesian, statistical, polar and observed-time rendering to fill common
gaps; the installed Recharts source informs mathematics, not this visual language.

## Reference Scope

The supplied **Ingestion Pipeline.html** and **Vector Search.html** provide the
first detailed references. Preserve the character of both the animated scenes
and their functional interface. Do not reduce the reference to the isometric map
while replacing its surrounding UI with unrelated presentation.

Include the stage strip across the top; section labels and inline metadata;
query and chunk text; dimension labels; vector-value previews; small dividers;
counts; source markers; result titles and subtitles; aligned scores; miniature
score tracks; rank-change arrows; and the relationship between these regions.
Standalone demo headings, explanatory articles, speed controls and page chrome
are not the component's theme specification.

These are early inputs, not the entire future design system. The user's subsequent
Arc-wide direction is recorded in the
[Arc design language and effects analysis](./arc-design-language-audit.md), backed
by the [broader source inventory](./arc-design-token-inventory.json). That evidence
expands Arc from a chart reference into the primary influence for the wider
language; representative Zero screens still determine compatibility and usability.

Keep reference scopes distinct: Arc's public-page typography, washes and showcase
composition inform public presentation. They do not become mandatory chrome
inside every chart, modal or visualization organism. Compact dashboard scopes
and spacious foundation values are inputs to one intentional density system,
not competing component themes.

The supplied Sankey reference includes the chart itself, stage labels, name/value
hierarchy, Flow control and the hover inspector. Its demo-page heading, period
selector, theme/width controls and explanatory articles are not organism chrome.
Preserve the compact inspector's title, prominent total, muted share line and
aligned value rows as a candidate shared tooltip/popover language. Do not replace
all current overlays while implementing this chart.

The Race Bar reference adds tinted ranked bars, a crisp series-colored end cap,
ordinary-font tabular values, an animated period readout and a small playback
timeline. Its title/subtitle, total, legend and inspector belong to the organism.
The demo stage/card, data-mode selector and theme/width controls do not. Its
four-series blue/orange/green/amber order is deliberate and separate from the
Sankey's six-series flow order; do not merge either into the legacy palette by
reordering colors already used by applications.

## Visual Direction

Use quiet neutral surfaces, subtle layering and fine borders to organize dense
information. Color should distinguish meaningful series, sources, selections and
activity without saturating every control. Typography and alignment carry most
of the hierarchy; decorative depth remains selective.

The reference's compact readouts should feel deliberate, not undersized. Keep
labels secondary to content, technical values easy to compare, and important
state readable in both light and dark themes. A soft decorative grid may be
faint; a score, result title or error must remain legible.

Carry this direction into ordinary lists, settings, forms and tables as later
work. Isometric planes and model blocks belong to these visualizations, not to
every application surface.

## Reference Anatomy and Token Responsibilities

| Reference element | Direction to preserve | Existing foundation or planned responsibility |
| --- | --- | --- |
| Stage strip and short progress lines | Compact labels, clear current/completed state, restrained motion | Existing Zero buttons, tabs where appropriate, semantic text/borders and component progress tokens; stage progress is not necessarily a tab selector. |
| Query or current-chunk header | Label at the start, dimensions or chunk position at the end | Shared information-header typography, spacing and alignment. |
| Query and chunk text | Stronger content hierarchy without a heavy heading | Foreground and body-type tokens; configurable truncation and an accessible full value. |
| Vector bars and numeric preview | Small, precise technical readout | Monospace/tabular-number treatment, series colors, chart geometry and diagnostic-density tokens. |
| Results header and top-k metadata | Two aligned levels of information | Existing semantic text roles and a reusable section-header composition. |
| Result and source rows | Rank, source media, title/subtitle and score remain aligned | Reuse DenseList composition where suitable; add only the ranking/score behavior it does not own. |
| Rank changes and score tracks | Compact supplemental indicators linked to real changes | State/series tokens, stable numeric alignment and motion tokens; retain non-color explanations. |
| Section and row dividers | Fine separators rather than repeated nested cards | Existing border roles; review the need for a shared subtle-border role. |
| Map, plane faces and links | Quiet depth, distinct series and a clear active query | Visualization-specific aliases derived from semantic surfaces, borders and chart series. |
| Document/chunk preview | Clear source identity and visible overlap | Existing card/text/highlight roles plus bounded preview geometry. |

The current [semantic token reference](../frontend/design-system/tokens.md) and
[global stylesheet](../../src/frontend/styles/globals.css) already define
background, surface, raised/inset surface, foreground, secondary/subtle text,
borders, accents, state colors, chart series and platform font stacks. Start
there rather than introducing a competing palette.

The [DenseList family](../frontend/components/dense-list.md) already owns grouped
rows with leading media, title/description, trailing content and separators.
Preserve that shared ownership when adapting search-result rows.

## Token Architecture

Keep three responsibilities distinct:

1. Shared semantic tokens express surfaces, content hierarchy, state, focus and
   series roles across the platform.
2. Component tokens express density, geometry, readout sizing, plane shading and
   other genuinely local requirements. Their defaults derive from shared tokens.
3. Application theme/configuration selects the effective appearance; components
   do not install an independent palette or hardcoded font family.

During the component build, record the exact reference values and each mapping
decision in the implementation ledger. Add a token only when an existing role
cannot express the requirement cleanly. Do not silently change global defaults
to obtain a match in one component.

Potential gaps to review include shared fine/subtle separators, compact
information-header typography, technical readout density, stroke widths, disabled
and secondary-content opacity, named elevation roles, accessible categorical
foreground/background pairs, and visualization face/link/marker geometry. Define
fallbacks when topics exceed the existing series palette. These are review
candidates, not approved new public token names.

Rank decreases are directional changes, not errors; use the arrow, text and
secondary emphasis rather than automatically applying destructive colors. Keep
metadata in semantic definition lists and result actions in actual links/buttons.
DenseList is a native list, not a listbox or selection controller.

Preserve the hand-tuned table, calendar, modal and tooltip motion contracts.
Theme work must not round timings, replace curves with presets or erase existing
microinteractions. New visualization motion needs explicit CSS/TS tokens where
both styling and playback consume the same values. Live operation timing stays
separate from presentation timing.

## Required Magnetic Highlight Contract

Confirmed by the user on 2026-10-10: the existing spring-driven hover surface in
the AppShell sidebar and public navbar is a defining Zero interaction. Preserve
it through the Arc-led redesign and expand it to calendar dates, context menus,
dropdown/submenus and menu-like popover content. Ordinary independent hover-fill
fades are not equivalent to the requested magnetic handoff.

One decorative surface should travel between the group's active targets and
reshape to their actual bounds, retaining continuity when the pointer moves
quickly or reverses direction. This is a moving highlight, not buttons moving
toward the cursor. Keep labels, icons, hit targets and layout stable. First entry
appears at the actual target rather than flying from a default origin; leaving
the group retires the hover surface or restores its intentional resting state.

### Initial Source Coverage

This is the initial local source audit, not the later implementation ledger below.
The source entry points below determine the integration work; surface entrance
animations and calendar month transitions do not prove moving row/date highlights.

| Family | Observed ownership | Required work |
| --- | --- | --- |
| AppShell/sidebar | [Sidebar](../../src/components/animate-ui/components/radix/sidebar.tsx) uses parent-mode [Highlight](../../src/components/animate-ui/primitives/effects/highlight.tsx), hover activation and a 350-stiffness/35-damping spring. Menu items register their bounds through HighlightItem. | Preserve the magnetic behavior, collapse/icon-only geometry and animated icons; qualify focus, disabled items, scrolling and reduced motion before wider reuse. |
| Public desktop navbar | [ResizableNavbar](../../src/components/navbar/resizable-navbar.tsx) uses an instance-scoped shared layout ID, a 360/32 spring with mass .7, and hover-to-active-route fallback. | Preserve this tuned handoff and route identity; add focus/reduced-motion parity where needed. Touch/mobile does not require simulated hover. |
| Calendar dates and month/year choices | [Calendar](../../src/components/ui/calendar.tsx) and [month presentation](../../src/components/ui/calendar-month-presentation.tsx) use local ghost/selected fills. Month/view motion has a separate owner; no shared date-to-date hover surface is present. | Add magnetic handoff across eligible date cells, including row boundaries, and month/year choice grids. Coordinate visible months within a calendar; preserve selection, range preview, today/focus and DayPicker semantics. |
| Dropdown menus | [Content wrapper](../../src/components/animate-ui/components/radix/dropdown-menu.tsx) owns a shared Highlight; [primitive](../../src/components/animate-ui/primitives/radix/dropdown-menu.tsx) follows Radix's highlighted state with the 350/35 spring. Submenu content lacks its own equivalent highlight boundary. | Preserve existing main-menu movement, qualify scoped submenu highlights and keep parent/submenu ownership independent across portals. |
| Context menus | [Rows](../../src/components/context-menu/context-menu-items.tsx) use [static highlighted-state fill](../../src/components/context-menu/context-menu-styles.ts); [surface motion](../../src/components/context-menu/context-menu-surface.tsx) only animates entry. | Add one moving highlight per menu/submenu surface; retain Radix keyboard/typeahead, destructive paint, checks/radios and close behavior. |
| Menu-like popovers and option lists | Generic Popover owns its floating surface, not child selection. [Select](../../src/components/ui/select.tsx), [Command](../../src/components/ui/command.tsx), [Combobox](../../src/components/ui/combobox.tsx) and [TimePicker](../../src/components/ui/time-picker.tsx) use local active/focus fills rather than magnetic row movement. | Give each coherent choice/action list a shared highlight under its existing semantic owner. Do not add menu behavior to arbitrary popover forms, prose or tooltips. |

The existing springs are the feel reference. Arc's Morph preset must not replace
them merely to reduce the number of motion constants. Preserve justified family
tuning while introducing shared role-based spring/entry/retirement/inset/shape/paint
tokens during implementation; no new public token or facade name is established
by this plan.

### Interaction and Ownership Rules

- Hover paint is separate from selected/current/checked state. Moving across dates
  does not select them; moving across actions does not run them. Existing DayPicker,
  Radix and command-list state remains authoritative, with no fabricated ARIA
  selection added to links or action rows by a decorative highlight.
- Keyboard focus gets immediate visible feedback. The magnetic surface may follow
  that target, but activation/typeahead/arrow movement never waits for animation.
  Define pointer-versus-focus precedence without stealing focus or hiding its cue.
- Disabled, hidden, inert and unmounted targets cannot acquire the hover surface.
  Preserve selected/range/today indicators and clear destructive labeling beneath
  transient hover paint; headings and separators are not targets.
- Each independently interactive group owns one highlight identity. Separate menus,
  submenu portals, calendar instances and repeated toolbars must never share layout
  identity or cause a highlight to fly between unrelated surfaces.
- Retarget from the current pose. Keep bounds correct through scrolling, resize,
  calendar view/month changes, sidebar collapse and virtualized option reuse. Retire
  stale targets on close/unmount; do not add perpetual per-item animation loops.
- Reduced motion keeps the highlight and state clarity but settles position/size
  immediately, without spring travel or overshoot. Coarse-pointer interaction uses
  explicit pressed/focused/selected feedback rather than sticky synthetic hover.
- Integrate through existing primitives by default. Feature authors should not
  build a separate highlight for every menu or date picker. Preserve custom-content
  extension points and avoid duplicate legacy fills or two transform owners.

### Qualification and Delivery

- [ ] Harden/reuse the shared highlight boundary while preserving sidebar/navbar feel.
- [x] Add default calendar day/month/year moving highlights without changing date selection; custom presentation overrides retain their owner.
- [ ] Add context-menu and menu-like popover/option-list coverage; qualify dropdown
  submenu ownership independently from the parent menu.
- [ ] Verify rapid forward/reverse movement, row/grid boundaries, first/last entry,
  variable row sizes, disabled/separator gaps and retained selection/focus paint.
- [ ] Verify keyboard, touch, RTL, reduced-motion changes, scroll/resize/virtualization,
  nested modal portals and exact-instance teardown in styled browser fixtures.
- [ ] Qualify light/dark/density overrides, public exports/source-copy packaging and
  documentation so built-in groups receive the behavior without feature-side setup.

Only the requirement and source-backed coverage ledger are added in this planning
pass. Missing family coverage above remains implementation work; it is not marked
complete because an unrelated entrance animation already exists.

## Compact Dashboards, Rich Pickers and Shared Overflow

Confirmed by the user on 2026-10-10 using two application screenshots and an
explicit selection of **Arc UI ScrollArea**, not shadcn ScrollArea. These are
requirements for the next theme/component pass, not evidence that defaults have
already changed. The screenshots establish composition preferences, not measured
CSS values or a verified defect in a particular version. Record layout findings
only; do not copy patient names, account details or the screenshots into fixtures.

### Application Density

Keep the successful AppShell/sidebar: magnetic navigation, animated icons,
collapse/icon-only motion and its existing organization. Tighten the content
lane around it rather than making the sidebar larger or replacing it with Arc's
demo sidebar.

- Default dashboard controls should be visually compact and aligned: search,
  selects, buttons and toolbar actions share intentional height and baseline
  roles. Start qualification with Arc's compact-demo 32/36px control families,
  not the spacious 44/50px foundation. These are trial density values, not new
  public defaults yet. Preserve comfortable touch targets, visible focus, zoom
  readability and an available roomier form/touch presentation.
- Bring section headings, supporting text, filters and results closer together.
  Use named content-gap roles instead of accumulating unrelated margins. Do not
  achieve density by shrinking readable text, clipping labels or compressing
  every component into one radius/height.
- Metric cards fit their title, value, optional delta/sparkline and necessary
  padding; do not add a large minimum height solely to fill a dashboard row.
  Align sibling cards intentionally, with loading/error states that do not jump.
  Sparse metrics should not become large mostly empty rectangles.
- Use quiet surface hierarchy, fine dividers, rich rows and restrained meaningful
  color to organize content. Avoid both repeated oversized nested cards and a
  flat screen of indistinguishable plain controls. Preserve legitimate whitespace
  in workspace/detail panes, empty states and editors that need it.

### Default Select Direction and Menu Anatomy

[Arc Morph Select](https://uiarc.dev/components/morph-select) is the approved
default **visual/motion direction** for Zero selects: the trigger becomes the
options surface, the active highlight glides between rows, and the selected label
returns into the trigger. It is no longer only an optional expressive experiment.
Its standalone controller is not a drop-in replacement for Zero's form or overlay
ownership; use the [source-backed adaptation ledger](./arc-design-language-audit.md#approved-picker-and-scrollarea-adaptation).

Build reusable row presentation beneath existing semantic owners:

| Part | Shared presentation contract |
| --- | --- |
| Leading content | Optional icon, avatar, source/integration tile or semantic-color mark; rows without a mark remain correctly aligned. |
| Main content | Clear title and optional subject/description; controlled wrapping/truncation, full accessible name and flexible width. |
| Trailing content | Aligned metadata, tabular count/value, badge, shortcut, selection check/radio or branch chevron; loading/error feedback has reserved sensible placement. |
| Groups | Nonselectable headers and dividers, with intentional spacing and no magnetic target on the divider/header. |
| State | Distinct active/hover, selected/checked, disabled, pending, invalid and destructive treatments. Color supplements labels/icons rather than replacing them. |

Reuse [DenseList](../frontend/components/dense-list.md) layout/token responsibilities
where appropriate, not its native-list role as a substitute for a listbox/menu.
Allow rich trailing slots without putting arbitrary nested buttons or switches
inside simple options. Rows with independent controls use an appropriate settings
list or deliberately specified composite interaction model.

Select, searchable/multiple Combobox, Command action lists, context/dropdown menus
and [Cascader](../frontend/components/cascader.md) share this anatomy, magnetic
surface and density vocabulary, not one universal selection controller. Generic
Popover remains a floating container: menu-like content consumes the shared menu
composition; forms/prose do not gain menu roles or arrow-key behavior accidentally.

Preserve controlled/uncontrolled values, field refs/blur/autofocus, labels and
invalid/required state, native form submission/reset, disabled behavior, typeahead,
focus return and keyboard reveal. Preserve current searchable/multiple behavior;
Arc's auto-search above eight choices is a configuration candidate for local
lists, not permission to invent client filtering for authoritative remote results.
The exact facade additions and migration path must be designed and tested before
documenting callable APIs.

Cascader integration means hierarchical picking uses the same trigger/material,
rows and overflow language. Retain its existing typed tree/path controller, leaf
versus branch behavior, single/multiple limits, breadcrumbs, pinned footer,
authenticated app loaders, AbortSignal handling, scope retirement and retry/error
states. Do not implement a second tree controller inside every flat Select.

### Motion by Task

Consistency means the same motion vocabulary for the same job, not one timer on
all UI. Keep immediate semantic changes independent from visual settling.

- Active-row/date/navigation handoff follows the
  [required magnetic contract](#required-magnetic-highlight-contract), including
  stationary hit targets and continuity through rapid reversals.
- Select trigger-to-list morphology and selected-label transfer form the picker
  recipe. Plain menu/popover entrance and Cascader branch changes use related
  surface/content recipes; they do not all fly their entire contents from a button.
- Measured width/height, paint/opacity and content handoff each have one owner.
  Portalling, collision flips or rapid close/reopen must not stretch text, reset
  to stale bounds or stack competing transforms on the same element.
- Existing modal origin/Rise defaults, tooltip Grow, destructive hold timing and
  chart trace/rank motion remain deliberate contracts. Reduced motion preserves
  readable content and state while removing travel, blur and overshoot.

### Required Arc UI ScrollArea Treatment

Use the same shared ScrollArea primitive or viewport decorator whenever a bounded
modal/dialog body, picker list, context/dropdown/submenu, menu-like popover,
Cascader panel or similar content actually overflows. Feature authors should not
recreate the effect or remember to wrap each built-in menu manually. Keep the
existing [ScrollArea exports](../../src/components/ui/scroll-area.tsx) compatible
while designing the viewport integration.

The exact default reference is Arc's
[ScrollArea source](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/scroll-area/scroll-area.tsx)
and [skin](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/components/scroll-area/scroll-area.module.css),
with [shared timing tokens](https://github.com/kuratlielia/arc-library/blob/86330cc9270c4acc55b7204c9583fcbaa378192c/registry/foundation.css#L73):

| Detail | Required reference default |
| --- | --- |
| Edge fade | 28px maximum transparent-to-opaque content mask. Each fade length is the smaller of 28px and hidden content beyond that edge; no fade where no content is hidden. |
| Overflow | More than .5px enables the relevant axis; short content has neither edge fades nor tracks. Native scrolling remains authoritative; platform bars are visually hidden. |
| Overlay thumb | 11px hit track; 5px visible pill, growing to 7px on fine-pointer hover/drag; minimum thumb 28px, proportional to viewport/content size. Foreground mixes 30% resting and 46% on fine-pointer hover/drag. |
| Visibility | Auto: shows while scrolling/dragging or on fine-pointer hover; 900ms scroll linger. Fade in 160ms, fade out 480ms with cubic-bezier(.22,1,.36,1). |
| Interaction | Native keyboard/touch scrolling; draggable thumb; track click pages 90% of the viewport. Reduced motion removes transitions and smooth track-click scrolling. |

Do not substitute a stronger shadow/colored veil or fixed fade on every edge.
Do not mask the whole overlay: headers, search/breadcrumbs, modal actions, pinned
footers, overlay scrollbar tracks and separately portalled submenus stay outside
the scrolling-content mask.

Integration must preserve **one actual scrolling viewport per region**. Adapt
Radix Select.Viewport, cmdk CommandList, virtualized time/year grids and managed
modal panel refs instead of nesting a second competing scroller. Expose and forward
the actual viewport for keyboard reveal, virtualizers, scroll restoration, edge
dividers and measurement. Do not add an extra tabbable region or overwrite the
existing listbox/menu/grid role merely because Arc's standalone viewport is
focusable. Independent modal nav/body regions may each have a scroll owner.

Popup height follows the available collision/safe-area bounds. Clamp RTL and
overscroll distances and thumb geometry; remeasure dynamic descendants; protect
focused content at masked edges. Keep the mask behind a clear focus treatment,
with a readable forced-colors fallback, and retire observers, timers and pointer
capture on exact-instance teardown. Preserve explicit existing scrollbar choices
through a documented compatibility mapping. Settings for fade suppression,
visibility, orientation and viewport refs are planned contract requirements,
not newly available Zero props.

The DataTable needs separate qualification before adopting this decoration:
horizontal scrollbar visuals stay **off by default**, legitimate horizontal
scrolling remains available, and row/reorder animations must not create transient
overflow. Its bottom percentage is pagination progress from live row count/page
size/current page, not scroll position. Do not replace it with a ScrollArea thumb.

### Dependency-Ordered Delivery and Acceptance

- [ ] Establish compact content-density roles on representative dashboard/form
  compositions, preserving the sidebar and touch/zoom readability.
- [ ] Implement shared row presentation, magnetic ownership and Arc ScrollArea
  decoration with viewport/ref preservation and explicit token mapping.
- [x] Adapt Select to the Morph Select visual recipe under Zero's form/overlay
  authority; qualify owned portals before migrating application fields.
- [ ] Apply shared rows/highlights/overflow to Combobox/Command, context menus,
  dropdown root/submenus, menu-like popovers and Cascader. Fix long submenu bounds
  and portal ownership; preserve server filtering and hierarchical loading.
- [ ] Apply the same effect to managed modal body/nav regions, retaining pinned
  header/footer, per-tab scroll positions and scroll-dependent dividers.
- [ ] Verify real long-content edge behavior, exact fade/track appearance, keyboard
  reveal, focus rings, native forms, RTL, touch, zoom, reduced motion, virtualized
  rows, dynamic content and rapid open/close/reverse/resize.
- [ ] Verify nested modal/menu portals, child-first dismissal, scoped theme
  inheritance, lower-owner inert behavior and separate submenu highlight identity.
- [ ] Qualify SSR/hydration, public exports, packed consumers and `zero add`
  dependency/style copying; update migration diagnostics and polished examples
  before promoting new defaults. Diagnose only reliably detectable patterns.

This pass records approved requirements and source-backed gaps. It does not
resize application screens, ship Morph Select or change ScrollArea behavior yet.

## Component Build Evidence

As the [visualization work](./vector-visualization-plan.md) progresses, maintain
an anatomy-to-token map, light/dark examples and a list of remaining token gaps.
Include empty, waiting, active, successful, failed, cancelled and reconnect states;
the finished-results screenshot alone cannot establish the whole visual contract.

Include compact chat/agent presentation, full application panels and explicit
landing-page/story presentation. The same functional anatomy should remain
recognizable across densities without shrinking text below a useful size.

Evaluate query text, dimension labels, vector previews, result rows and separators
as carefully as the map. Those ordinary information patterns are particularly
valuable references for the future default theme.

### Implemented Token Ledger

The first implementation is in
[the organism stylesheet](../../src/components/vector-visualization/vector-visualization.css)
and [geometry/motion defaults](../../src/components/vector-visualization/visualization-geometry.ts).
It introduces component aliases, not a replacement global palette.

| Implemented anatomy | Effective Zero role or local default | Later theme decision |
| --- | --- | --- |
| Plane and model faces | `--surface-raised`, `--surface`, `--surface-inset` | Keep depth selective; qualify contrast across future palette presets. |
| Content, descriptions and labels | `--foreground`, `--muted-foreground`, `--subtle-foreground` | Refine shared hierarchy without flattening technical readouts. |
| Thin separators, grid and relationships | `--border`, `--border-strong`, transparent color mixes | Decide whether a shared fine-border role is warranted. |
| Cluster and source identity | `--chart-1` through `--chart-5`, deterministic series assignment, text labels | Define categorical pairs and behavior beyond five clusters. |
| Technical and ordinary type | Existing platform mono/sans stacks; local 13px panel, 14px copy and 11.5px labels | Select the future global type/density scale; no external reference font was installed. |
| Ranked result rows | DenseList composition, 32px local row height, 18px source tile, tabular scores | Carry compact information alignment into ordinary lists. |
| Rank and score motion | 700ms / 70ms rank delay; 600ms / 60ms score delay | Preserve the hand-tuned contract while theme values change. |
| Ingestion motion | 550ms peel, 420ms model entrance, 650ms acknowledged arrival | Presentation follows actual receipts; no duration can acknowledge a write. |
| Focus, failures and waiting | Existing focus ring/destructive roles, explicit state text and unknown-outcome message | Keep non-color explanations and useful keyboard focus. |
| Dot, cluster and query inspection | Existing Zero Tooltip, semantic focus paint, `--zero-viz-query-hit-size`, `--zero-viz-cluster-inspect-opacity`, `--zero-viz-cluster-focus-stroke` | Preserve useful geometric hit targets and keyboard inspection while changing the theme. |

Light, dark and 375px-width fixtures were inspected during implementation. The
responsive pass fixed caption/score-chip collisions and tested that no horizontal
scrollbar is introduced. Automated qualification also covers inspector-only
layout, token overrides, keyboard inspection, stable result nodes, scroll-safe
FLIP and instant reduced motion. Fixture screenshots are local verification
artifacts, not shipped public corpus data.
Paused scenes settle newly arriving content visibly instead of freezing an
entrance before it appears. Inspection content is customizable with pure React
renderers; colors, focus, spacing and tooltip geometry remain theme-controlled.

The visual treatment is now an implemented foundation for the wider pass. Exact
global replacements, palette presets and migration guidance remain unselected.

### Sankey Chart Token Direction

The chart build introduces `--zero-chart-*` family roles and `--zero-sankey-*`
local aliases, without changing the existing `--chart-1` through `--chart-5`.
The legacy series order is blue, purple, green, amber and red; the reference
requires blue, purple, amber, teal, red and green. Keep that deliberate six-color
order in the new chart namespace rather than reordering existing applications.

| Reference anatomy | Component-first mapping | Wider theme decision |
| --- | --- | --- |
| Resting ribbons and neutral downstream nodes | Six chart-family series; local neutral node and ribbon-opacity roles | Promote a coherent categorical palette only after cross-chart contrast review. |
| Traced share and source mixing | Source color or neutral ink; local trace-opacity role | Keep readable selection emphasis distinct from decorative resting color. |
| Small drifting particles | Same resolved series as SVG, local radius and bounded density | Define consistent particle/point roles without treating decoration as event receipts. |
| Node names and counts | Shared platform sans; 12.5px label role, 14px medium tabular readout role | Keep intentional readout hierarchy distinct from row values and technical monospace. |
| Stage names | 11.5px secondary labels with collision-aware omission | Establish shared information-header density without illegible shrink-to-fit. |
| Inspector | Shared semantic card/border roles; 10px radius; 9px × 12px padding; 17px total and 12px/1.45 supporting type | Analytical inspector roles are implemented; wider Tooltip/Popover migration remains separate. |
| Flow control | Shared button composition with compact local switch paint | Preserve common control interaction and keyboard semantics while retuning chart density. |
| Geometry and tracing | 12px horizontal/10px upright nodes; common scale; exact reference timings | Keep component geometry independent of global palette migration and real data timing. |

The palette is a family-mapped, theme-overridable chart extension, not a new
platform-wide theme. Surfaces, content roles and font family continue to inherit
the active Zero theme. Qualify light/dark and narrow examples before promoting
new tokens into ordinary application controls.

### Race Bar Chart Token Direction

Race Bar uses the same optional `--zero-chart-*` semantic surface/content/font
roles and its own `--zero-race-bar-*` paint and motion namespace. It must not
redefine `--zero-chart-series-*` or the existing `--chart-1` through `--chart-5`.

| Reference anatomy | Component-first mapping | Wider theme decision |
| --- | --- | --- |
| Four categorical series | Shared blue/orange/green/amber; light `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`; dark `#3987e5`, `#d95926`, `#199e70`, `#c98500` | Family colors now resolve at paint sites; local palette remains overrideable. |
| Bar body and colored cap | Surface-mixed series tint: 38% light/42% dark; selected 72%/80%; crisp 3px end cap; 2px/4px corners | Establish selection tint roles separately from strong series strokes, not a saturated fill everywhere. |
| Wide and narrow labels | 12.5px secondary labels beside bars; inside-bar labels below 400px with truncation and full inspection | Keep compact labels readable; responsive composition changes before type is shrunk. |
| Values and period | 12.5px medium tabular values; 30px semibold rolling period with 38px line box | Promote ordinary-font numeric hierarchy alongside technical monospace readouts. |
| Grid and legend | Fine semantic grid lines, 11px ticks, 11.5px legend with 9px tinted/capped markers | Define chart density without adding heavy frames around every element. |
| Inspector | Shared Zero Tooltip portal engine; scoped 10px radius, 9px × 12px padding, 17px value, 12px supporting text and 120ms fade | Align related analytical inspectors while preserving different geometry from brief hover hints. |
| Playback and timeline | Shared 30px circular Button; 36px timeline hit area, 3px track, 15px thumb and small period marks | Separate comfortable interaction targets from quiet visual geometry. |
| Motion | 1400ms period pacing; 55% smoothstep value blend; critical-damping frequencies 9/22/11/13/14; 420ms entering/300ms retiring period labels | Keep independently tuned clock/rank/opacity motion and velocity continuity; a playback clock does not establish real event timing. |

The component-first implementation and qualification are tracked in the
[chart plan](./charts-system-plan.md#race-bar-extension). Token promotion is
still separate theme work: this reference does not install an external font,
replace existing Tooltip defaults or change ordinary application colors.

### Funnel Chart Token Direction

Funnel extends the same vocabulary rather than introducing another palette or
inspector theme. Its four segments use Race Bar's named categorical order.
Light/dark band tint remains an intentional `.28`/`.34` local geometry treatment;
the active stage clips stronger color through the band. Total view uses blue,
split view uses segment colors and isolated view retains the segment's identity.

The supplied 12px stage labels converge on the shared 12.5px label role; 17px
medium tabular counts retain prominent readout hierarchy and 11.5px retention
and drop-off labels use metadata density. Inspector rows use 12.5px row-value
type inside the shared 12px supporting surface. Segment marker squares are 7px.
Stage columns and control tracks inherit the quiet wash role. Standard Button,
Switch and Tooltip primitives own semantics while local paint preserves the
reference strip, pill and compact flow controls. Dots are illustrative retention
samples, not event receipts.

The [Funnel guide](../frontend/charts/funnel.md) and
[implementation plan](./charts-system-plan.md#funnel-and-realtime-stream-extension)
document the component API, cohort constraints and qualification. Realtime Stream
has no token ledger yet because its requested source file is not available.

### Arc Chart Extension

The twelve free chart organisms are organized separately under
`src/components/charts/arc`; their [guide](../frontend/charts/arc.md)
records the Zero API. The initial source is the official
[Arc registry](https://uiarc.dev/docs/installation), starting with
[Line Chart](https://uiarc.dev/components/line-chart). The catalog in scope is
Line, Bar, Donut, Streamgraph, Brush, Waffle, Slope, Sparkline, Gauge, Activity
Heatmap, Ridgeline and Treemap. Animated Counter and Pro Split Bar are not part
of this import. Recharts and the three custom chart organisms remain intact.

The [complete upstream token inventory](./arc-chart-token-inventory.json) records
each registry URL, file identity/size, declared local variables and referenced
variables, plus every declaration in Arc's foundation. It is source evidence,
not a second installed theme. Broader licensing documentation is deferred;
required source notices remain inline in the converted components/foundation.

#### Foundation Values and Mapping

| Upstream role / values | Zero conversion | Theme input retained |
| --- | --- | --- |
| Neutral OKLCH scale 100, 99, 97.8, 95.8, 91.5, 84, 72, 59, 46, 34, 23, 15 percent | Existing Zero surface/text/border semantics, consumed through optional `--zero-chart-*` and private `--zero-arc-*` fallbacks | Fine neutral depth and quiet secondary type; no global OKLCH palette installed. |
| Light background/surface white, muted 97.8%; foreground 15%, secondary 46%, muted 59%; borders 93.5/96.5/82% | `--card`, `--foreground`, secondary/muted text, border/strong roles | Review fine separators and contrast in the later platform theme pass. |
| Dark background 19%, surface 21.5%, raised 24%, muted 26%; foreground 96%, secondary 77%, muted 64%; borders 29/25/40% | Same inherited Zero roles, not separate component dark themes | Useful dark surface hierarchy; retain current Zero light/dark configuration. |
| Accent neutral 33% light/80% dark, strong 24%/91%, subtle alpha .10/.13; eight neutral/violet/blue/green/amber/orange/coral/rose presets | Neutral chart ink by default, explicit private accent override; semantic status roles inherited | Palette candidates rather than new public theme presets. |
| Four fallback series light `#1f7dcf`, `#7128a5`, `#e58f00`, `#009e84`; dark `#55adff`, `#9c37be`, `#e66e00`, `#00a861`; relative-OKLCH palette rotations | Named family blue/purple/amber/teal, private `--zero-arc-series-1`…`-4` | Stable categorical identity; preserve meaningful neutral overflow instead of recycling indistinguishable hues. |
| Success 49%/.19/150 light, 78%/.18/150 dark; warning 58%/.18/75 vs 83%/.17/80; danger 54%/.21/25 vs 76%/.20/25 | Zero success/warning/destructive roles | Status text and numbers still explain state without color alone. |
| Display Geist; body Inter; −.03em/−.01em tracking; line-height 1.1/1.4; type 12/14/16/18/22/28/36/52/72px | Inherited platform sans; namespaced metric candidates, shared inspector type | Preserve headline/readout hierarchy without installing webfonts or replacing platform stacks. |
| Space 4/8/12/16/20/24/32/40/48/64/80/96px; radii 18/26/34px/pill; control heights 36/44/50px | Namespaced `--zero-arc-space-*`, `-radius-*`, `-control-height-*` | Density/rounding inputs for later cross-component review, not ordinary control redesign. |
| Resting, raised and floating shadows; floating light 20×48px/.105 plus 3×10px/.045, dark 22×55px/.34 | Analytical inspectors inherit the shared chart shadow; intentional calendar hint retains raised variant | One analytical-card elevation rather than tiny per-chart drift. |
| 120/160/180/240/480ms durations; CSS spring 580ms; enter (.16,1,.3,1), standard (.22,1,.36,1), exit (.7,0,.84,0), in-out (.65,0,.35,1); sampled spring curve | Scoped CSS metrics and exact pure `ARC_CHART_MOTION_DEFAULTS` | Presentation timing remains separate from real query/receipt timing. |
| Springs responsive 520/38, gentle 340/34, snappy .26/.12, smooth .4/0, morph .42/.16; stagger .016/.04/.08/.035; blur 2/4/8px | Shared renderer vocabulary with organism-specific physical springs; environment suspension/reduced motion | Retain hand-tuned transitions and interruption continuity; no single duration flattens every chart. |

Arc foundation's lavender/peach gradients, selection switches, global focus rules
and other ordinary control styles are inventoried but not imported. The chart
slice installs no global `:focus-visible !important` rule. Keyboard focus remains
visible under Zero ownership; pointer clicks do not require a persistent outline.
The later [Arc-wide analysis](./arc-design-language-audit.md) explicitly considers
those ordinary controls and effects for the global redesign. Their absence from
the chart import is a runtime boundary, not a decision to exclude Arc's broader
visual direction.

#### Organism Geometry and Interaction Ledger

| Organism | Source anatomy / numeric detail preserved or reconciled |
| --- | --- |
| Line | 220px plot; 2px strokes/1.75px dashed comparisons, 9% area, 48px axis gutter, neutral comparisons at 46%/26%; 241-point morph grid, 840ms reveal; original 14px/10×12 inspector converges on the shared analytical card. |
| Bar | 176px plot, 52px gutter, 58% slot/max 28px bar width and 4px top rounding; light/dark accent tint 62%/76%, dim 24%/34%; mean line/readout and independent digit rolls retained. |
| Donut | 208px diameter/24px thickness; 7px margin, 3px gap, 4px corner; active lift/growth 4/2px, dim .45; four categories then neutral 56/42/32%, Other 26%; 40px legend rows, 10px markers; 460px body-layout boundary; reveal .72s, settle .5s, snappy lift, smooth count. |
| Streamgraph | 161 samples, 10px plot pad/14px hint gap, 26px axis, 32px pill legends/10px swatches; 82% fill with 2px surface seams, .34 inactive; neutral overflow 30/18/24/14%; .9s reveal, smooth .4s morph and snappy crosshair. |
| Brush | 240px main/52px overview, 44px gutter, 1.75px line, 10% main/12% overview area, 14% selection; centered seven-observation smoothing, distinct UTC window/grips, annotations and exact inspected values. |
| Waffle | 3px gaps, 300px grid/232px side column, 420px layout boundary; 22% cell corner/50% round, optional 2.5/3.25px focus frames; .26 dim, 36px legend rows; exact largest remainder, persistent cell identity, capped 320ms stagger and 620ms dip/travel. Source 14px/8×12 inspector now uses shared 10px/9×12 roles. |
| Slope | 20px label separation, 14px padding/28px heading, 440px narrow layout, 2px line/4px dot/2px surface stroke; neutral 36%, .14 inactive ink/.3 labels; 700ms sweep/50ms per-row stagger/300ms label fades, morph .42/.16 and rank movement. |
| Sparkline | 160×52px shape, 5px inset, 2.5px stroke/9% area, 7→10px endpoint; status tone and animated readout remain compact, with exact numeric/index inspection instead of fabricated records. |
| Gauge | 176px width, 100×90 viewbox, radius 42, −135° start/270° sweep, 9px stroke/13% track tint, 36px readout; 768ms reveal and 420ms morph/.16 bounce. Genuine ranges/thresholds; no silent max=min+1 repair. |
| Activity | UTC calendar; 6.5% empty foreground tint then accent 26/50/76/100%; 9–15px cells, 3px gaps, 30px day labels, 28% cell rounding, 1.5px focus ring; 420ms diagonal wave budget, 320ms fill, 360ms reveal/580ms spring; 90ms preview grace/110ms pointer hide/2400ms touch retirement. Intentional inverted calendar hint maps active semantic roles. |
| Ridgeline | 96 Gaussian KDE samples, 28px axis, 6px lift, 420px narrow gutter switch 52→36px, row 30/overlap 2.4; 34% resting/18% lifted fill, 48% IQR, 1.5/2.25px strokes, 55% median; five tint swatches, .7/.08 morph, 1s reveal/25ms per-row stagger. |
| Treemap | 2px gaps/3px inset/22px branch headings, 420px plot, 6px tile/8px branch rounding, compact 6×8/5×7 labels; 9% branch hue, 34% resting or 14→58% five-step measure shade, .5 lineage dim; .62/.06 zoom, .9s reveal and proportional .3s wave. |

All ordinary analytical cards resolve private override → shared inspector role,
using the selected 10px radius, 9×12px padding, 12px/1.45 supporting type,
17px/1.3 prominent value and common shadow. The calendar's inverted hint and
readout-only organisms retain intentional composition differences. Source
geometry/selection tints are not a justification for independent background,
font or border themes.

Line/Bar/Brush axis gutters reconcile the incidental 48/52/44px differences into
`--zero-arc-axis-gutter` → `--zero-chart-axis-gutter` → 52px. Axis-row defaults
similarly converge at 28px (source 26/26/28). Per-organism stroke/inset/tint/spacing
aliases retain explicit overrides; measurement and paint use the same effective
geometry. All platform font overrides use the same `--zero-chart-font-family`
family role, and `data-motion="off"` settles CSS feedback as well as JS geometry.

This extension is a working-source component/theme slice. It does not complete
the global default-theme migration, introduce Pro code, replace Recharts or
implement a new authorized server aggregate service.

## Wider Theme Work After Component Completion

### Shared Chart-Language Convergence

The chart references establish one Zero chart family. Small differences between
the supplied prototypes are inputs to reconcile, not permanent independent
themes. The user explicitly confirmed that chart surfaces, typography, borders,
inspectors, controls and related tokens must become uniform through the shared
Zero design language. Preserve distinctive flow/ranking geometry and useful
motion without retaining arbitrary styling drift.

Sankey, Race Bar and Funnel now inherit shared chart surface, foreground,
secondary, muted, border and font roles and consume the implemented
`src/components/charts/chart-tokens.css` vocabulary. This working-source pass
resolves the incidental prototype differences as follows:

| Current difference | Source evidence | Shared-language decision |
| --- | --- | --- |
| Inspector rounding and spacing | Sankey: 11px/10px × 12px; Race/Funnel: 10px/9px × 12px | Shared 10px radius and 9px × 12px spacing. Existing local Sankey/Race aliases retain deliberate overrides. |
| Inspector supporting type | 12px or 12.5px, line-height 1.4 or 1.45 | Shared 12px/1.45 supporting role; prominent numeric values 17px/1.3. |
| Inspector elevation and width | Large blur differed by 2px; minimum widths 184px/168px/150px | One 28px-blur analytical shadow, strong semantic border and 260px shared maximum. Content-fit minimum widths remain intentional and viewport bounded. |
| Labels and row values | Sankey: 12px names/14px values; Race: 12.5px rows; Funnel: 12px labels/17px counts | Label and row-value 12.5px; medium readout 14px; prominent value 17px; metadata 11.5px. Runtime text measurement follows effective CSS. |
| Categorical colors | Near-but-different blues and ambers | Named blue/orange/green/amber/purple/teal/rose/olive roles. Sankey maps six sources; Race/Funnel map four categories without changing stable identity. |
| Focus, controls and secondary chrome | Plot rounding 8px/10px and different focus defaults | Shared 10px plot radius, 2px foreground focus, 120ms feedback. Explicit accent/local focus overrides and interaction-specific control shapes remain supported. |

Implemented family names include `--zero-chart-inspector-radius`, `-padding`,
`-font-size`, `-line-height`, `-value-size`, `-value-line-height`, `-max-width` and `-shadow`;
`--zero-chart-title-size`, `-label-size`, `-row-value-size`, `-readout-size`,
`-metadata-size`; and `--zero-chart-plot-radius`, `-focus-width`, `-focus-offset`,
`-focus-color` and `-feedback`. Named palette tokens use `--zero-chart-blue` and
the other categorical names. Surfaces and fonts remain inherited semantic roles.

Resolve local override → family role → semantic fallback at the consuming paint
site, not through ancestor-computed `var()` aliases. This keeps scoped theme
changes live in SVG, DOM, canvas and portalled inspection. Sankey's existing
`--zero-chart-series-1` through `-6` and Race/Funnel's local series aliases remain
compatible; no legacy `--chart-1` through `-5` is changed.

The normalization sequence is:

- [x] Compare family defaults and inspectors in isolated light/dark fixtures;
  preserve existing selected, empty, reduced-motion and narrow regression cases.
- [x] Choose shared family values and supported density roles; route component
  aliases through those roles rather than maintaining competing defaults.
- [x] Apply one theme override to charts and verify typography measurement,
  SVG/canvas/DOM paint and portalled inspectors follow it consistently.
- [x] Keep deliberate geometry and motion contracts; do not flatten Sankey trace
  propagation or Race Bar rank springs merely to make timings identical.
- [x] Qualify local compatibility aliases and scope inheritance in working source.
- [ ] Qualify wider application migration before changing global theme defaults.

This is the first implemented chart-family slice of the shared theme pass, not
a completed platform-wide redesign. New charts extend this role map without
accumulating incidental radius, shadow, type or color choices. Wider application
palette selection, normal Tooltip/Popover defaults and migration remain open.

- [ ] Review the completed visualization components and their token ledger.
- [x] Record Arc as the leading wider design reference and capture its public
  foundation, component/block token usage, published scoped themes and selected
  interaction recipes in the [Arc-wide evidence](./arc-design-language-audit.md).
- [ ] Gather further approved references for typography, controls, forms, lists,
  tables, dialogs, navigation, empty states and public pages.
- [ ] Define a coherent scale for type, spacing, density, radii, borders, elevation,
  icons, focus and state treatment in both light and dark themes.
- [ ] Preserve the successful AppShell/sidebar behavior, magnetic interactions,
  animated icons and existing responsive/compact modes while refining appearance.
- [ ] Deliver the [required magnetic-highlight coverage](#required-magnetic-highlight-contract)
  across calendars, context/dropdown/submenus and menu-like popover option groups,
  retaining the public navbar handoff as well as the AppShell sidebar.
- [ ] Deliver [compact dashboard, Morph Select and shared Arc ScrollArea requirements](#compact-dashboards-rich-pickers-and-shared-overflow)
  through existing semantic/overlay owners, including rich menu/Cascader rows.
- [ ] Evaluate configurable palette presets without changing the underlying
  component hierarchy or interaction contracts. Review licensing and compatibility
  before adopting an external palette.
- [ ] Define compatibility for existing token overrides and application themes,
  with migration guidance and diagnostics where reliable detection is possible.
- [ ] Apply the new defaults across representative component families and verify
  that organism-specific aliases follow global changes automatically.
- [ ] Review contrast, keyboard focus, reduced motion, zoom, long content, narrow
  screens, SSR/hydration and packaged stylesheet discovery.
- [ ] Update the design-system guides and examples with verified values and
  actual configuration behavior.

The final theme is complete only when the shared language works across ordinary
application and public-page UI, not merely when the visualization looks polished.

### Arc Led Promotion Sequence

Use the [ordered Arc theme/component work](./arc-design-language-audit.md#ordered-theme-and-component-work)
to guide the next implementation pass. First reconcile semantic-name collisions
(especially strong Arc accent versus Zero's soft accent), readable light/dark
content pairs, display/body/technical type, density/radii, fine borders and
elevations. Then map shared highlight, measured resize, state-text handoff and
selected-control motion onto existing Zero owners before importing new organisms.

The existing Zero magnetic handoff is a required retained/expanded default, as
specified in the [magnetic contract](#required-magnetic-highlight-contract).
Other product feedback and selection effects are strong default candidates. Numeric
rolls and work shimmer remain selective; Arc Morph Select is now the approved
default select direction and Arc ScrollArea the required shared overflow treatment.
Other morphing picker variants remain selective; headline blur/reveals,
mesh/glass, swipe decks and continuous marquees remain explicit presentation
variants. Source layer numbers, focus suppression and synchronous success paint
are not reusable platform policies. Preserve modal origin/Rise and multiplier,
tooltip Grow/arrow, hold-to-delete, chart inspector and sidebar contracts.

Qualify each proposed promotion across representative screens, real overflow,
keyboard/touch/reduced motion, scoped/portal theme propagation, SSR, packaging
and migration. The earlier source-analysis pass changed documentation only;
the new parallel backing foundation below implements roles/recipes, not the
whole-platform component/effects migration.

## Handmade Chart Coverage Extension

The [native chart guide](../frontend/charts/native.md) records the
original quantitative/mixed Cartesian, statistical, polar and observed-time
organisms. Their nineteen named React exports share the existing analytical
language; the generic composer and presets are not nineteen independent graph
algorithms. `ZeroChart` provides a typed dispatcher across these and the existing
custom/Arc families without introducing a renderer library or transport.

The installed Recharts **3.7.0** source was read for axes, stack accumulators,
normalization, intervals, scatter and polar capability expectations. It is not
the source of these charts' appearance, animation, theme or rendering. This is
not an Arc Pro implementation or a promise of full Recharts API equivalence.
The supplied Realtime Stream HTML remains unavailable; the new stream is an
original observed-time component, not an asserted pixel match to that file.

The [machine-readable native inventory](./native-chart-token-inventory.json)
lists every custom-property reference/declaration in the owned skin/renderers,
the dynamic eight-color palette and the local mathematical reference paths.
Unlike the Arc inventory, these values are Zero-authored component evidence,
not an imported upstream theme. Both inventories inform the eventual theme pass.

| Responsibility | Shared role / decision |
| --- | --- |
| Surfaces and text | Paint-site `--zero-chart-surface`, `foreground`, `secondary`, `muted`, `grid`, `border`/`line` roles fall back to the current Zero semantic theme. No root-level global palette/font replacement. |
| Type | Title 14px/500; ordinary label 12.5px; metadata 11.5px; numeric readouts use tabular numerals in the ordinary platform font. Responsive SVG labels compensate for scaling rather than shrinking below the token size. |
| Inspection | Reuse Zero Tooltip portal/collision/overlay ownership. Same analytical 10px radius, 9×12px padding, 12px/1.45 body, 17px/1.3 prominent value, soft shared shadow, 24px aligned-row gap, 120ms feedback; arrow off and no decorative blur. Custom/default/hidden body contracts do not create a new popover. |
| Color | Named blue/purple/amber/teal/orange/green/rose/olive family palette; per-series safe override permitted. Signed waterfall/OHLC use semantic positive/negative roles. Existing family ordering and legacy `--chart-*` remain stable. |
| Pale marks | Strong series-colored caps/edges with restrained fill; shared tint/hot-tint roles under private statistical overrides. Range and distribution visuals do not invent a population for empty data. |
| Motion | Reuse Arc's 420ms visual-duration/.16-bounce vocabulary, represented by physical spring coefficients; first reveal is the existing considered duration ×1.75 (840ms), feedback120ms. No second motion theme. Each component preserves its meaningful geometric behavior. |
| Focus and lifecycle | Existing shared focus-width/offset/color, reduced-motion/static choice, visibility suspension and exact SSR companion; no decorative stream clock or ingestion acknowledgements. |

Local exceptions are actual geometry/interaction choices, not accidental theme
drift. Native Cartesian uses line-width2, area-opacity.14, bar-opacity.38,
active-opacity.72 and reference-band-opacity.08 overrides; these are in the
inventory. Polar separator-width defaults1.5px, radar fills.13/.23, dim.35 and
track.4; polar font-scale is computed coordinate compensation, not a theme knob.
Statistical radius/grid/muted/tint/hot-tint are private aliases under shared
roles. The `--statistical-color`/`--statistical-tint` and Cartesian series paint
properties are computed per-mark values, not additional global palettes.

The bounded 52px numeric gutter is shared by the native Cartesian/statistical/
stream layouts where applicable; labels and actual hit areas follow measured
coordinates. Curves, whiskers, signed accumulators and proportional sector/ribbon
math are family-specific. Exact data companions are independent of normalized,
clipped or animated SVG values and formatter rounding.

Review found and corrected SVG `x/y` animation being treated as transforms
instead of numeric attributes; fills, caps, boxes and volume bars now use actual
SVG coordinates. The stream retains every measured vertex instead of uniform
resampling that could erase an irregular spike. Sunburst drill preserves source
branch color and inherited paint; clustered OHLC timestamps use adjacent actual
midpoints for non-overlapping hit regions. These are renderer/data-integrity
fixes, not visual departures from the agreed language.

The post-review area interval bands reuse the existing Cartesian series paint and
area-opacity role; they introduce no competing band theme. Native/Arc paint
overrides now share one bounded pure color grammar and color-only swatch
properties. These are resource/semantic boundaries, not additional theme tokens.
Automatic bar gutters, finite curve fallbacks, stable observed-stream identities,
and persistent exact accessible readouts correct presentation integrity without
changing the agreed typography, palette, motion or analytical inspector skin.

The wider palette, new default global theme, ordinary Tooltip/Popover migration,
application qualification and named server metric service remain distinct work.

## Parallel Foundation Implementation And Migration Gates

The user authorized replacement backing-token work in **new files**, retaining
the old foundation until gaps and visual adoption are qualified. Implemented
source now lives in `src/design-system/`, with a generated opt-in supplement at
`src/frontend/styles/theme-next.css`. The [activation/API guide](../frontend/design-system/foundation-next.md)
owns actual usage; this ledger owns promotion and remaining gaps.

The initial parallel foundation did not replace existing global/component token
stylesheets. Package wiring adds `./design-system` and `./styles-next.css`, with
an explicit source-copy target and supported managed-build opt-in. Backend
authentication `./tokens` and existing interaction ownership remain unchanged.
The initial pass kept the legacy default; the separately authorized application
default switch is recorded below. Live presentation subscriptions stay within
their existing owners.

### Completed Backing Foundation

- [x] Separate immutable light/dark paint, type/spacing/density, shape/elevation,
  motion, compatibility, declaration validation, composition and diagnostics.
  There are 199 canonical roles and compatibility for all 60 old root semantic
  names. New public type/API imports build for server and browser without React,
  DOM, providers, service bootstraps or font loading.
- [x] Record compact/comfortable/touch roles instead of imposing one density on
  every screen. Preserve fixed modal/tooltip/inspector shapes and a small 14px
  close glyph with independent pointer target geometry.
- [x] Separate strong action fill from Zero's quiet accent, state ink from
  solid/wash foreground and decorative borders from control-identification
  boundaries. Focused ordinary-content contrast and control pairs are tested;
  arbitrary custom overrides and whole applications are not certified.
- [x] Retain sidebar/public-navigation physical springs; define task-specific
  Morph Select open/close/highlight/width/label, Arc ScrollArea geometry/opacity/
  linger and feedback recipes. Preserve modal origin/Rise, multiplier, tooltip
  Grow/arrow, analytical inspection and real hold-confirmation safety policy.
- [x] Keep existing named analytical colors and legacy chart series identities;
  bridge existing code/ANSI, modal/tooltip, table progress and vector paints.
  Explicit mode also resolves existing Sankey/Race/Funnel mode-dependent paint.
- [x] Generate CSS deterministically, scope it to explicit next boundaries and
  prove that merely loading it leaves old roots/siblings unchanged. Verify root
  activation, nested explicit/system modes and passive density/public inheritance.
- [x] Reject unknown/malformed configuration, declaration injection, resource
  references, escaped values, unresolved required dependencies and cycles. The
  validator admits trusted bounded application declarations, not arbitrary CSS.
- [x] Add read-only gap/parity checking with actual compiled Tailwind import
  declarations, exact source locations and no app/config/DB boot or file output.

Working-source verification after continuation/review: **227 focused tests /
16,320 assertions across 30 files** passed. Coverage includes real-browser theme
scopes, owned portals, native shadow/slot/document subscriptions, all three
updated chart families, pure/export/admission checks, copied-source browser/server
builds and the complete documentation example. Focused strict TypeScript,
generated CSS parity, whitespace checking and the 760-page documentation graph
passed. Independent read-only review found and qualified the accessible-slot
correction. This is not a full repository test run, deployed-app visual review or
clean packed-release qualification.

### Review Findings Corrected In This Pass

| Finding | Correction and regression evidence |
| --- | --- |
| Zero-specificity supplemental selectors lose to old `:root`/`.dark`. | Explicit boundary selectors have one-target specificity and load after legacy styles; root activation and later app overrides tested. |
| Root-computed aliases retain ancestor/old paint. | Rebind old semantic/component and every inline Tailwind alias at each new theme boundary. Actual body/public wrapper color/background and nested mode changes tested. |
| A density bridge resets inherited local radius or paint overrides. | Density changes density roles only. Passive public wrappers inherit just the paints that old public rules restate; geometry and explicit customizations remain intact. |
| Untyped override records, escaped injection, malformed `var()` or priority whitespace bypass checks. | Plain-record/known-key admission, balanced quoted/function validation, resource/escape/priority rejection and reference-graph tests. |
| Source scan reports private variables and pruned/imported Tailwind roles as missing. | Recognize underscore/case-sensitive names and case-insensitive functions; compile actual imports in memory without a broad namespace allowance. Generated palette declarations are not counted as migration gaps. |
| Open portals miss new attributes/media, or read an iframe source through the outer window. | Shared ancestry/preference subscription and source-realm computed-style projection; open identity, focus/draft, overrides, owner layer/inert state and cleanup are tested. |
| Cached chart paint/metrics remain on the old mode or theme updates restart flow state. | Sankey/Race/Funnel subscribe to next/public markers and native preferences; font completion refreshes measured layout, with selection and presentation clocks retained. |
| Shadow-root boundaries and slotted inheritance conceal presentation changes. | Observe encountered root child-lists, retain known roots during detachment, and follow accessible assigned-slot ancestry/slotchange. Native tests cover closed-shadow descendants, accessible reassignment and connected document adoption. Closed-shadow light-DOM slot associations remain inaccessible; detached unknown-realm adoption requires resubscription. |
| Package API exists without an app-owned copy/discovery path. | Explicit `theme-foundation` target copies pure source plus supplemental CSS; copied API and real overlay/tooltip/modal/chart consumers build without executing config. No automatic stylesheet or boundary activation. |

### Remaining Adoption Gates — Do Not Delete Legacy Files

| Gate | Current evidence / next action |
| --- | --- |
| Real compact dashboards and controls | Many components still use fixed classes/heights/gaps. Adopt canonical density roles in headings, forms, selects, metric cards and list/menu rows; validate both supplied screenshot compositions. Sidebar layout, icon behavior and magnetic movement remain protected. |
| Morph Select and rich choice rows | Recipes/geometry exist; there is no new default Morph Select organism in this pass. Preserve existing form semantics, keyboard, disabled/selected states, Cascader tree authority and optional leading/trailing content while implementing it. |
| Magnetic family coverage | Preserve existing sidebar/navbar coefficients and expand one retargetable highlight to calendar/context/dropdown/submenu/popover choices. A token alone does not supply missing hover/focus ownership. |
| Exact Arc ScrollArea | Backing values match the selected source treatment. Implement behavior on the real bounded viewport, with only actual overflow, conditional 28px edge regions and overlay scrollbar geometry/opacity; avoid nested scrollers. |
| Unsignaled environment replacement | Attribute/preference/viewport/font and accessible-slot events are covered; browsers hide closed-shadow slot associations for light-DOM sources. Direct CSSOM/stylesheet-text replacement needs explicit refresh/resubscription. Moving an already-detached source into an unknown document/shadow branch is not observable without resubscription; whole-chart document adoption requires remounting document-owned clocks/listeners. |
| Scoped legacy `dark:` utility branches | Old Tailwind dark variants follow any `.dark` ancestor, not the nearest explicit next mode. Token paint is correct, but branch selection needs frontend migration and tests for explicit-light islands. |
| Managed styles and distribution | Next is now the managed application default, with matching compiled-artifact metadata, fail-closed next styles and atomic hashed publication with prior assets retained. AppShell activates the existing frame; explicit legacy rollback is retained. Fresh installed-package and actual compiled-CSS consumers qualify the path. Wider screen-level visual review remains pending. |
| Local paint candidates | Latest read-only source check reports zero unresolved candidates, 878 compatible old references and 91 literal-color candidates across 21 files. These include palettes, scrims, decoration and fallbacks, not 91 confirmed bugs. Inspect ownership/state before converting. |
| Wider qualification | Run actual application light/dark, zoom, font fallback/loading, forced-color, keyboard/screen-reader, long-label/overflow, touch, SSR/hydration and packed-consumer checks. Current browser qualification uses synthetic probes, not deployed apps. |
| Default promotion and removal | The user authorized switching the application default before the next design changes and later visual testing. Public/document roots stay unmarked. Delete no old files; removal still requires a separate reviewed change after migration and visual approval. |

The reusable local checker remains `scripts/check-theme-foundation.ts`.
Implemented [source-only Doctor theme diagnostics](../cli/doctor/source-audit.md#backing-theme-diagnostics)
add bundled parity/alias integrity and bounded admitted-source checks without
executing application config or Tailwind. Changed app-owned copies and unresolved
canonical references require review; old references and literal colors are
counts, not automatic defects. The scoped backing work is complete; wider
frontend adoption and the visual preservation decisions below remain active.

### Follow Up Review and Preservation

The second read-only review on 2026-10-10 checked actual use sites, not just token
coverage. The table records those findings and subsequent authorized consumer
corrections; the original passing suite did not resolve the use-site defects.
Typography structure and adoption follow the [Arc-based plan](./typography-system-plan.md).

The user's clarification protects the deliberately redesigned, slightly dynamic
modal theme: backgrounds, origin/Rise, dim/blur, page receding and stack motion
are intentional. Do not restore the old modal merely because its surrounding
dashboard/sidebar needs a more conservative migration. Fix scoped presentation
while retaining the existing shared backdrop, motion, stack and focus owners.
Slightly dynamic presentation does not require continuous decoration on every
surface or fabricated loading/success state.

| Priority and finding | Source and reproduced effect | Narrow next action |
| --- | --- | --- |
| P2, corrected: shared modal backdrop misses scoped theme | [Modal manager](../../src/modals/modal-manager.tsx) previously left its one backdrop on root paint. The existing renderer now reports the live source backdrop role to the existing host. | Native tests cover live changes, top-owner handoff, child-close restoration, final fade and rapid reopen. No additional backdrop, animation, stack, focus or inert owner is introduced. |
| P2, corrected: standalone tooltip source precedence | The previous standalone primitive merged source then modal owner in both layers. Native regression reproduces trigger `19px/#112233`, owner `13px/white`, and now verifies closer source values win without replacing the live bubble. | Implemented owner → source → explicit visual content style in both layers, matching grouped tooltips. Layer/interaction ownership and motion defaults remain intact. |
| P2, corrected: standalone Select loses scoped source tokens in its body portal | [Select](../../src/components/ui/select.tsx) previously projected only modal-owner presentation. A body portal outside a scoped trigger could therefore inherit the page's typography instead. | A private DOM-free trigger context now projects live source tokens after owner defaults and before explicit content styles. Native browser checks retain selection, form value, typeahead, refs, open identity and protected owner layer/inert state; source-copy and strict native-ref checks qualify the dependency closure. |
| P3, corrected: Sankey particle radius omits explicit-mode bridge | [Sankey skin](../../src/components/charts/sankey/sankey.css) retains light 1.2/dark 1.3 through the [mode aliases](../../src/design-system/theme-compatibility.ts). | Pure and native tests cover both nesting directions, system mode and caller overrides without changing chart geometry or clocks. |
| P3, corrected: density primitive-string admission | Both token constructors now require a primitive string before membership. Arrays, boxed strings, custom `toString`, numbers and booleans are rejected by regressions. | Malformed trusted-config admission is corrected; this was not a security finding. |
| Adoption, first baseline implemented: typography consumers | [Typography](../frontend/design-system/typography.md) now applies body recipes at next boundaries, roles in core controls/cards/forms and Select/Command, specialized alias bridges and optional native Text/Heading. Actual compiled-CSS browser checks verify local role/family changes, responsive input values, legacy fallbacks and caller overrides. | Continue full-screen, Cascader/context/dropdown, real-font and accessibility qualification. Do not equate the first consumer baseline with every property of every specialized profile being adopted. |

The read-only checker reports declaration parity/coverage correctly; its zero
unresolved references do not detect runtime precedence/use-site gaps. The new
Doctor integration likewise does not treat declaration coverage as proof of
computed presentation or run live apps to label every old class a defect.

Review verification: 108 focused existing tests passed with 1,988 assertions,
and the documentation graph checked 761 pages with no problems. In-memory
Chromium probes reproduced the scoped-presentation gaps above. These checks
qualify the review evidence and documentation; passing existing tests does not
resolve the open defects or certify a completed typography migration.

#### Visual Decisions Before Promotion

- **Keep the polished navigation material.** Sidebar magnetic 350/35 and public
  navbar 360/32/.7 movement remain intact. The next `--public-shadow-floating`
  bridge does replace the navbar's existing six-layer glass shadow with generic
  floating elevation. Preserve a navigation-specific material role if retaining
  that successful glass look; do not remove it as incidental styling drift.
- **Keep normal motion; qualify reduced motion separately.** Existing sidebar/
  navbar physical transitions do not automatically consume the new reduced-motion
  recipes. This is an existing gap. Snap decorative travel under the preference
  without changing the normal tuned springs or losing focus/selected feedback.
- **Separate neutral actions from named variants.** Next action fill is
  deliberately achromatic. Accent Tooltip and info Modal therefore lose their
  previous primary hue; next-light light/neutral hints become identical. These
  are visual-policy decisions, not evidence that the variant APIs disappeared.
  Legacy `light` already follows canvas rather than an always-light inverse
  surface. Use explicit variant/status roles where their distinction is wanted,
  and preserve descriptive hierarchy instead of recoloring all primary buttons.
- **Preserve terminal identities separately from syntax decoration.** The next
  ANSI blue/bright-blue/dim-blue mapping follows neutral primary fill and becomes
  gray. Decide a dedicated readable terminal-blue role before promotion;
  neutral syntax functions/links are a separate choice. Do not blindly use a
  chart swatch as small code text without qualifying its actual background.
- **Preserve task-specific geometry and safety.** The 14px X glyph/32px desktop
  target, 44px coarse target, 1500ms real hold, tooltip Grow 400ms/arrow, analytical
  inspector 12/17px hierarchy/120ms feedback and live pagination percentage remain
  separate contracts. Table horizontal bars remain off by default. New type or
  density roles do not authorize flattening these dimensions or timers.

The earlier review was documentation-only. Subsequent authorized implementation
delivers the [typography baseline](../frontend/design-system/typography.md),
standalone tooltip precedence, trusted configuration admission, scoped shared
modal-backdrop paint and Sankey's exact mode radius. Real font assets, broad
screen adoption and promotion remain separate gates. Old theme files and
defaults remain.

Consumer-pass qualification on 2026-10-10: **416 tests / 4,495 assertions across
69 files** passed in the final focused regression run; its three packed-package
tests were filtered out and qualified separately in fresh installed modal,
tooltip and grouped-control consumers. Native type/SSR, real compiled-CSS
browser, live owned portal, source-copy and compiling documentation checks are
included. The read-only foundation checker reports exact generated CSS parity,
384 catalog properties and zero unresolved references; the 762-page
documentation graph and whitespace checks pass. This is not a full repository
suite, deployed-app visual approval or font/accessibility certification.

The initial broader run exposed a Select native-ref inference error, corrected
with an explicit native ref type and a permanent compiler regression. An
existing narrow-action test was synchronized with its real label-disclosure and
scroll completion instead of changing navigation motion. One packed check
completed all product assertions but failed removing its newly allocated
external scratch directory with `EFAULT`; its isolated rerun passed including
cleanup. No product workaround, broad cleanup or legacy-file deletion was used.

### Backing Completion

The 2026-10-10 backing completion pass adds the managed-build selection and
read-only Doctor integration described above. It also rejects explicit null
mode and snapshots admitted getter-backed options once, preventing a single
token result from mixing modes. Reduced-motion configuration is admitted once.

Managed next builds include the supplement after legacy CSS, persist the chosen
foundation in compiled metadata and reject incompatible deployment artifacts.
Atomic publication retains existing hashed URLs for live pages and previous
manifests. It does not activate frontend boundaries, acquire fonts or delete old
theme files. The source-copy target remains explicit and app-owned copies are
never silently repaired.

Qualification: **350 focused tests / 4,005 assertions across 50 files** passed,
with the two existing packed tests filtered out. A separate fresh installed
backing-package consumer passed **1 test / 14 assertions**, covering public
server types, prepared next styles, browser/SSR typography, bundled CSS parity
and the config-free Doctor CLI. Final Doctor admission/import/package-alias
hardening passes **45 tests / 200 assertions across four files**, plus strict
TypeScript with zero diagnostics. Independent review confirms actual target
type/root/exclusion admission, custom copied declarations and canonical-relative
source imports. Complete documentation examples compile, generated CSS has
exact parity and zero unresolved roles, and all **762 documentation pages** pass
the graph check.
This does not claim a full repository run, published release, deployed-app
visual approval or platform-wide typography/font/accessibility certification.

### Application Default Switch

The user subsequently authorized switching now, retaining original tokens and
deferring visual testing until further requested changes are complete. Managed
build omission now selects next. The public `styles.css` entry loads original
CSS plus the scoped supplement; `styles-legacy.css` retains the original entry.

AppShell applies the next/compact marker to its existing outer frame across all
presets, without another wrapper or provider. Its `themeFoundation="legacy"`
option removes that top-level marker. Document/public roots are not activated;
existing saved/system dark-class selection, magnetic coefficients, modal motion
and hold-confirmation timers retain their owners. Legacy rollback also selects
`themeFoundation: 'legacy'` for managed builds or the legacy CSS entry in an
app-owned pipeline. This is not nested legacy isolation inside a next ancestor.

The mobile sidebar's existing Sheet portal projects the live application-boundary
tokens because its DOM leaves that frame. Caller style overrides remain last;
Radix continues to own the portal, focus and dismissal. Desktop layout, sidebar
widths and magnetic springs are unchanged.

Old manifests lacking foundation metadata remain legacy. They need an explicit
legacy selection or a rebuild under the new default. No original token files,
old assets, application databases or runtime data were deleted. This switch
does not supply the still-planned Morph Select/ScrollArea organisms or certify
screen-level visual appearance.

Functional qualification for the switch: **136 tests / 2,665 assertions across
19 files** passed, including compiling documentation, public token exports,
AppShell preset/rollback markup and managed build metadata. Separate mobile
portal checks passed **9 tests / 45 assertions**, including live theme changes,
preserved input state/focus, caller overrides and native ref cleanup. Generated
CSS remains exact with zero unresolved roles; the documentation graph has
**762 reachable pages and zero problems**. These are source/functional checks,
not the deferred visual review, a publication or a deployment.

A fresh installed archive also passed **1 test / 24 assertions**, exercising
public AppShell prop types, default-next and explicit-legacy SSR, AppShell browser
bundling, both stylesheet entrypoints and source-only Doctor parity. Strict
AppShell dependency-closure compilation has **zero diagnostics across 422 source
files**. The package check started no application services, executed no app
configuration, loaded no `.env` and created no database files.

### Anchored Controls And Card Follow-Up

The next implementation pass now supplies the approved Select/picker/menu
presentation on existing interaction owners. It does not apply one morph to
every component or replace intentional modal, Tooltip or chart behavior.

| Surface | Implemented ownership and visual contract |
| --- | --- |
| Select | Native Radix forms/value/typeahead/focus/placement; clipped trigger-to-list morphology, title-only rich ItemText, one magnetic row layer and one existing decorated viewport. Inert, stripped close paint preserves long-list scroll position and retires on reopen, teardown or inactive owner. |
| Ordinary Popover / Date / Time / Combobox / Cascader | Restrained .97/5px trigger-facing grow at 580ms, 160ms fade and .98/half-offset 140ms exit. Collision-resolved side is authoritative; explicit Motion overrides opt out. Calendar view/value rolls retain their own recipe. |
| Dropdown roots/submenus | Existing 350/35 magnetic material retained independently; owned portal/theme/inert layering protected; one bounded inner native scroll region with rails inside the dismissal branch and outside the content mask. |
| CommandList / Time list | Shared paint-only magnetic material follows cmdk/native active-row state; filtering, virtualization, form values and aria-activedescendant remain authoritative. Input/footer are not masked. |
| Calendar | Magnetic day/month/year paint without date selection, table children or new keyboard state; selected/range/today/outside markers retained. Native virtual year viewport gets shared fades/rails; caption remains fixed. |
| ScrollArea / authored PopoverViewport | Arc hidden-edge/overlay-thumb treatment on the actual native viewport. PopoverViewport is opt-in for generic forms/readouts; already-scrolling pickers are not auto-wrapped. Rails normalize pointer geometry during scaled opening. |

Shared overflow now implements .5px admission, at-most-28px content fades,
11px rail targets, 5→7px thumb paint, 28px minimum length, 30→46% foreground,
90% track paging, 900ms linger and 160/480ms show/hide. Native scrolling,
selection and focused-edge readability do not wait for animation. Dynamic later
children/header offsets/fonts/images invalidate measurements without a perpetual
observer loop. Separate viewport/rail hover intent fixes the discovered hover
flicker. Reduced motion snaps magnetic geometry and removes rail transitions;
forced colors remove masks.

The user also approved a composable Card façade based on the
[Arc Card reference](https://uiarc.dev/components/card). Native Card parts remain
usable for arbitrary compositions, with additive media, action, byline, meta,
status and section pieces. ContentCard is a compact
browsable article with separately focusable title/action, optional live status
and quick-look details through **Zero's existing modal manager**, not another
Radix dialog/body-lock/stack implementation. The managed surface morph uses the
existing From Button/Rise fallback and standardized header/X. It intentionally
does not claim Arc's separate multi-element dialog layout owner. Quick-look
details are deliberately supplied, not a duplicate preview form/action/media
tree. User dismissal runs the manager's dirty guard, live presentation keeps
the existing generation/draft/child graph, and identity/unmount retire only the
exact owned ID. Controlled dismissal is fenced until a new opening cycle.

Canonical Card roles record family padding 16/20/24px via shared space roles,
12px gap, shared panel radius and 112px minimum media region; feedback records
2px mouse-only lift, 1.04 zoom, 960/480ms in/out and status 240/160ms with 40ms
stagger/4px blur. This is task-specific feedback, not a second theme. The backing
catalog now has **405 roles** and the supplement is still generated exactly;
all original theme files remain available. The existing public ExpandableCards
gallery is not silently migrated by this additive façade.

Remaining coverage is explicit: custom calendar renderers, pointer-origin context
menus, whole-application density/font/zoom/touch visual review and public-navigation
qualification are separate gates. Source copy carries component-owned CSS assets;
copied app edits are skipped, not overwritten. No publication, deployment,
application configuration, database or external font installation is part of this pass.

Component qualification on 2026-10-10: **76 interaction tests / 557 assertions**
passed across the Select, calendar/Time, anchored surfaces, magnetic menus,
scroll viewports and modal contracts. The final Card browser/SSR/presentation,
typography and modal-system review passed **53 tests / 349 assertions**; a
separate final Card/source-copy run passed **17 tests / 174 assertions**. These
overlapping suites are reported separately, not summed. Complete frontend and
Doctor/design-system documentation examples compile against public source
facades. Generated CSS retains **405 roles**, exact parity and zero unresolved
canonical references; **762 pages** pass documentation navigation checks.

The subsequent [Doctor upgrade audit](../cli/doctor/source-audit.md#upgrade-auditing)
implements the first opt-in catalog pass for named public exports, admitted
literal assets and concrete scrolling assumptions. It does not infer copied
source age or replace customized files. Further provenance/catalog work follows
the [Doctor delivery sequence](../cli/doctor/roadmap.md#upgrade-audit-delivery-sequence).
Its installed-package qualification and final test evidence are recorded there.

### Pantheon Live Validation

Pantheon is the selected representative application for the future live
migration and validation. Inventory its actual installed package, app-owned
copies and consumers before changing them; shared imports can inherit updated
presentation, while charts and custom modal compositions need deliberate
contract mapping. This selection does not start application changes, deployment
or retirement of originals.

Migrate coherent consumer families: application theme/density and shared
controls, managed overlays/tooltips, then charts and specialized compositions.
Preserve Pantheon's polished sidebar, existing providers, real query/subscription
owners, permission checks and accepted-write behavior. Validate actual screens
in light/dark and narrow layouts, keyboard/touch and reduced motion, real
overflow, mixed overlay stacks, errors/pending saves and scope transitions.
Use the [application assembly guide](../guides/application-ui-development.md),
[chart contracts](../frontend/charts/index.md), [modal migration](../frontend/modals/migration.md)
and [Doctor source audit](../cli/doctor/source-audit.md); a static scan alone is
not visual/runtime approval. Keep original implementations and theme material
until replacement qualification and explicit retirement approval.

### Original Theme Retirement

The application default is next, but original theme removal is not authorized
or qualified by that switch. The canonical
[retirement checklist](../frontend/design-system/foundation-next.md#retire-the-original-theme-safely)
requires neutral Tailwind/base/component-style extraction, explicit retained
legacy/public token owners, complete next consumers, rollback and artifact
compatibility, updated distribution/Doctor evidence and representative visual
approval before exact files are removed. `globals.css` currently supplies both
legacy values and infrastructure required by the new components.

- [ ] Separate neutral stylesheet infrastructure without changing rendered output.
- [ ] Establish explicit legacy/public and specialized token ownership.
- [ ] Qualify next/default independently of every file proposed for retirement.
- [ ] Reconcile exports, build selection, source-copy assets, generator settings,
  diagnostics and migration documentation.
- [ ] Complete representative application/public visual and accessibility/device checks.
- [ ] Approve the exact retirement targets, version policy and rollback separately.

Follow the [frontend source organization plan](./frontend-component-organization-plan.md)
for family-owned structure and compatibility maps. Source moves and original
theme retirement are separate migrations; neither automatically removes the
other's public paths, copied files or deployed assets.

## Related Work

### Latest Interaction Reference Queue

The [Arc interaction follow-up](./arc-interaction-follow-up-plan.md) records the
new scroll, drawer, numeric, input and floating-action-tray requirements. The
floating tray and a bounded managed-modal scroll slice are now implemented;
the remaining consumers retain their staged plans. None of these additions
retires original theme material.
Keep their candidate roles in the same catalog rather than create one palette
or motion scale per imported reference.

| Reference area | Token/recipe notes to carry into implementation |
| --- | --- |
| [Ordinary scrolling](./arc-scroll-surface-plan.md) | Preserve the existing hidden-distance edge cap, overlay rail geometry/color and scoped visibility roles. Fill coverage/interaction gaps without globally changing intensity or nesting a viewport. |
| [Drawer/BottomSheet](./drawer-bottom-sheet-system-plan.md) | Reuse modal surface/type/focus/backdrop roles; define only genuinely new edge, detent and gesture geometry. One coordinated stack/theme projection remains required. Drawer motion is not modal Origin by default. |
| [NumberField/digit display](./number-field-rolling-number-plan.md) | Reuse control/type/warning roles and tabular numeric paint. Field stepping/scrub feedback, digit-slot travel and measured width are distinct recipes; the current table timing stays its own compatibility recipe. |
| [Tag/Phone/Mention/InlineEdit](./arc-input-modernization-plan.md) | Reuse pill/menu/selected/focus/validation material, native font hierarchy, flag/avatar geometry and magnetic active-option paint. Record new aliases only for measured gaps; no hardcoded component-private Arc palette. |
| [Floating Button Group](./floating-button-group-plan.md) | Map quiet tray/edge, moving highlight, press wash, persistent mode tint, concentric radii and reserved-label motion separately. The [complete token disposition](./floating-button-group-token-inventory.json) preserves original evidence; promote only missing scoped roles. Reuse control typography, elevation and Zero Tooltip defaults; floating material is not a portal manager. |

The successful Sidebar/Navbar treatment and approved modal/Tooltip/chart
recipes remain preservation baselines. These plans do not make whole-screen
adoption, actual font loading, representative-app visual approval or
source-copy provenance complete.

### Floating Action Tray Adoption — 2026-10-11

The [implemented manual](../frontend/components/controls/floating-button-group.md)
and [bounded delivery plan](./floating-button-group-plan.md) now describe one new
consumer. `theme-floating-button-group.ts` contributes 40 geometry/material roles
and `theme-motion.ts` contributes 17 task-specific motion roles: 57 canonical
properties and 57 component aliases, taking the catalog from 405 to 462.
Palette-aware hover, press and persistent mode fills remain distinct. Scoped
18/13px standard and 15/11px compact tray/item radii stay valid independently of
the retained 6px ordinary-control radius. Density/coarse-pointer hit minima take
precedence over visual calibration.

`floatingButtonGroupMove`, `floatingButtonGroupPress`,
`floatingButtonGroupFeedback` and `floatingButtonGroupLabel` are named recipes;
the move calibration is 420ms/.16, press/first-entry 260ms/.12, with separate
160/240ms highlight visibility and 240/160ms label handoff tracks. CSS and JS
consume the same aliases; live reduced motion snaps travel, blur and scale
without erasing state. All four Tooltip sides use Zero's existing Grow/400ms,
arrow and overlay owner—not Arc's private side-tooltip.

The pinned [reference token supplement](./floating-button-group-token-inventory.json)
still records all 35 CSS references, 26 declarations and eight motion references.
Its implementation record is separate from the dated source/calibration inventory.
No Sidebar/Navbar spring, modal defaults, chart inspector, joined ButtonGroup,
root font loader, original theme file or service ownership was replaced.

### Additive Modal Scroll Adoption — 2026-10-11

The [scroll adoption plan](./arc-scroll-surface-plan.md) separates the new
managed-body/panel/navigation adapter from wider surface and public-option work.
This slice introduces **no new token roles or parallel palette**: it reuses the
existing 28px hidden-distance fade cap, 11px rail hit area, 5→7px painted thumb,
28px minimum thumb, foreground-mix material, 900ms activity linger and separate
160/480ms visibility tracks. The canonical catalog remains 462 roles.

The new Next-only stylesheet corrects reduced-motion selector precedence without
editing the original skin. Smooth paging is a native-scroll action, not a modal
entrance recipe; reduced motion makes it immediate. Snap-safe thumb dragging and
bounded horizontal wheel conversion retain native viewport, focus and authored
style ownership. Body chrome remains outside the mask. The default modal
`scrollTreatment:"arc"` and retained `"native"` comparison use the same manager,
approved animations, actions and stack—not two dialog systems.

The original shell, shared scroll implementation, public ScrollArea, globals,
theme-next and named modal/calendar/table/tooltip token files remain present.
The new source, browser, copied-consumer and installed-archive qualification
does not authorize their deletion. Removal needs the user's explicit approval
after replacement testing and representative-application comparison.

### JSON Document Reference Mapping

The supplied `JSON Editor.html` and expanded `withnewsstufftomlyamlenvJSON Editor.html`
inform the additive `JsonDocumentEditor`/`DocumentEditor`, not a
new global palette or silent replacement of the retained `json-edit-react`
adapter. The [editor manual](../frontend/components/json-editor.md#json-document-editor)
owns usage, local admission and accepted-write behavior.

| Reference property | Zero disposition |
| --- | --- |
| Card/text/secondary/muted, line and wash | Existing surface, foreground, secondary text, border and muted roles. |
| String green, numeric blue, boolean amber, danger and accepted feedback | Existing code-string/constant and semantic success/warning/danger ink; no per-editor hex palette. |
| Geist/Geist Mono | Inherit Zero body/technical font roles. No automatic font download or replacement of application typography. |
| 18px card, 30px row, 16px indent; 12px narrow indent | Scoped editor geometry; optional 26px compact rows. These exceptions do not change every input or card radius. |
| Magnetic row and moving tab chip | Existing picker highlight/width durations and spring easing. |
| Branch height/row travel, changed dots, mode/save reveal and short hover paint | Standard/fast/instant Zero motion roles; live reduced motion settles geometry and CSS tracks. |
| Bounded Tree/Code overflow | One existing native viewport with the shared Arc attachment, or explicit parent/native composition; header/footer remain outside the mask. |
| Format-selection pill / narrow select | Existing picker travel/easing and shared Morph Select; no competing overlay manager. |
| Comments, native type hints, YAML anchors and indentation guides | Existing muted text/code-function ink/border roles. Inline comments have display priority, with full comment text in the shared Tooltip. |
| Source squiggles and tab-indentation error wash | Existing semantic danger ink and scoped source geometry; no new global palette roles. |

This slice adds no canonical theme roles and preserves the original theme/token
files. The prototype's fake save, discarded invalid inline text and unguarded
late callbacks are not production behavior. The editor's optional writer must
accept its exact snapshot before showing Saved, with dirty newer edits and
document identity retained separately. YAML/TOML/`.env` use the same organism and
materials, with source-aware history and exact accepted-save metadata. File
preservation is a codec responsibility: incompatible conversions, shared YAML
anchors and ambiguous TOML structural edits remain explicit, not lossy fallbacks.
Native TOML dates/large integers retain their type in source; literal `.env`
support never loads or expands environment variables.
Exact-number JSON/YAML likewise stays source-authoritative in Code; numeric precision
protection is an admission/copy/save contract, not another color or animation role.

### Related Plans

The subsequent ordinary-surface slice reuses these same roles in DatePicker's
constrained-height days/months viewport and independent ContextMenu root/submenu
bodies. Menu borders/shadows and picker footer/chrome remain outside content
masks. Original Calendar selection, magnetic day/month/year paint, anchored
picker motion and the ContextMenu 120ms entrance remain distinct and intact.
This adds no new palette, duration or font scale. Explicit custom menu viewport
composition and native comparisons are documented in the
[bounded scroll ledger](./arc-scroll-surface-plan.md); preserving source files
and passing isolated checks still do not authorize original retirement.

- [Visualization implementation](./vector-visualization-plan.md) owns both
  organisms and their Zero/service/adapter integration.
- [Design system roadmap](../frontend/design-system/roadmap.md) owns the wider
  theme and qualification sequence.
- [Component conventions](../frontend/design-system/component-conventions.md)
  and [themes](../frontend/design-system/themes.md) describe current foundations.
- [Typography system plan](./typography-system-plan.md) follows Arc's standard
  scale and owns text recipes, preservation anchors and consumer qualification.
- [Declarative configuration evolution](./declarative-configuration-plan.md)
  records the separate configuration direction; this plan does not introduce
  runtime theme configuration APIs by itself.

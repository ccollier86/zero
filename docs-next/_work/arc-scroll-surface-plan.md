---
id: zero.arc-scroll-surface-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: scroll-surface-adoption
maturity: planned
applies_to: ["2.6.0 working source; bounded modal and DatePicker/ContextMenu adoption qualified; comprehensive adoption remains planned"]
modes: [browser, SSR, light, dark, application, public-pages, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Arc Scroll Treatment Across Surfaces

[Working evidence](./index.md) · [Interaction follow-up](./arc-interaction-follow-up-plan.md) · [Current ScrollArea](../frontend/components/primitives/scroll-area.md)

The requested standard is Arc UI ScrollArea, not shadcn ScrollArea. Ordinary
bounded content that scrolls vertically, horizontally or in both directions
must communicate hidden content with that same subtle edge treatment and
overlay scrollbar. This includes a partially visible item at the edge of a
modal, dialog, menu, picker or other ordinary surface. It does not require
snapping every item fully into view or changing the surface's data controller.

The shared visual mechanism and several consumers already exist. The current
bounded implementation pass adds a separately owned next interaction adapter
and managed-modal viewport adoption. The next bounded slice adds DatePicker
days/months and ContextMenu root/submenu bodies; comprehensive adoption, the expanded
public options and direct-DOM geometry optimization remain separate work.
Tables and other specialized scroll owners need their own explicit integration
decisions, not an automatic wrapper. Keep original implementations, compatibility
paths and theme files available until the replacement is fully tested and the
user explicitly approves retirement. Passing checks alone is not that approval.

## Reference And Current Visual Baseline

Arc uses one native viewport with independent hidden-distance edge fades and
overlay rails. Its default orientation is vertical; both-axis adoption here is
a Zero surface policy, not Arc's default. Reference dimensions are a 28px fade
cap, 28px minimum thumb, 11px rail hit area, 5→7px painted thumb and 30→46%
foreground mix. Auto-hide delay is 900ms. Track paging moves 90% of the viewport;
thumb dragging suspends snap; horizontal wheel conversion passes through at
an edge. Geometry updates avoid a React render per scroll. See the
[official contract](https://uiarc.dev/components/scroll-area/markdown) and
[registry implementation](https://uiarc.dev/r/scroll-area.json).

Zero already consumes these visual dimensions through the shared theme and
local aliases. Its current show/hide fallbacks are 160/480ms. Arc's component
uses semantic timing tokens, so these Zero timings must not be called verified
Arc numeric timings without checking the corresponding foundation definitions.
The user requests the exact reference intensity and occupied edge area; keep
the existing visual values during integration unless a measured discrepancy
establishes a correction.

## Native Viewport Coverage

| Owner | Current viewport and treatment | Adoption boundary |
| --- | --- | --- |
| [Original shared metrics](../../src/components/_internal/scroll-viewport/scroll-viewport-metrics.ts), [observation](../../src/components/_internal/scroll-viewport/use-scroll-viewport.ts), [decoration](../../src/components/_internal/scroll-viewport/scroll-viewport-decoration.tsx) and [skin](../../src/components/_internal/scroll-viewport/scroll-viewport.css) | Existing native viewport on either axis; content-only masks and sibling overlay rails. Layout/theme/image/font/focus observation protects the nearest-edge active row or focus margin. | Retain this owner and its compatibility re-exports. Immediate track paging, unsuspended snap during drag and rail-only wheel handling are the original behavior; next interactions belong in new files. Metrics still update React state. |
| [Public ScrollArea](../../src/components/ui/scroll-area.tsx) | Radix Root and exact Viewport, with hidden registration rails and shared painted rails. Public additions are `orientation`, `fadeEdges` and `viewportRef`; default orientation is vertical. | Root ref and Radix props remain compatible. Do not claim the next internal adapter or Arc's complete public prop API is already exposed here. |
| [SelectContent](../../src/components/controls/select/select.tsx) | Exact Radix Viewport is decorated in both popper and item-aligned branches. Scroll buttons and trigger-derived lid remain outside that viewport. | Caller-owned items/groups are admitted inside the same viewport. Low-level replacement primitives or a second custom overflow owner need explicit composition and separate qualification. |
| [DropdownMenuContent and SubContent](../../src/components/animate-ui/components/radix/dropdown-menu.tsx) | Each has its own dedicated native menu viewport and decoration. Root menu highlights stay inside its viewport; a submenu keeps a separate scroll owner. | Preserve Radix focus, menu/checkbox/radio/group semantics and side placement. Do not decorate the entire portal or wrap a nested submenu in the parent's scroller. |
| [CommandList](../../src/components/ui/command.tsx) | Exact cmdk List is decorated; CommandDialog inherits this when composed with CommandList. Input and fixed dialog frame remain separate. | Filtering and active-descendant visibility stay with cmdk. Raw cmdk/custom result lists do not acquire decoration automatically. |
| [PopoverViewport](../../src/components/surfaces/popover/popover.tsx) | Explicit native body viewport supports vertical, horizontal or both axes; decoration is its sibling. | Arbitrary `overflow-auto` on PopoverContent or custom children is not covered. Preserve fixed header/footer outside PopoverViewport rather than automatically wrapping unknown content. |
| [Calendar year grid](../../src/components/controls/date-time/calendar-month-presentation.tsx) | Default year view decorates its exact grid viewport in both virtualized and nonvirtualized branches. Default day/month grids are not themselves scroll owners. | Custom DayPicker Month/MonthGrid renderers can replace this owner; they must opt into an explicit recipe. Do not introduce another scroller around the year virtualizer. |
| [DatePicker facade](../../src/components/controls/date-time/date-picker-scroll.tsx) over the original [outer viewport](../../src/components/controls/date-time/date-picker.tsx) | Next attachment decorates the exact days/months viewport at constrained height; the year branch disables it and keeps the existing grid/virtualizer owner. `scrollTreatment="native"` uses the unchanged original picker. | No extra host/scroller; footer, values, drafts and original anchored motion stay owned by the picker. Custom DayPicker Root forwards native `rootRef`; opaque custom Roots remain caller-owned. DateRangePicker is not adopted by this slice. |
| [TimePicker listbox](../../src/components/controls/date-time/time-picker.tsx) | Exact virtualized native listbox is decorated, with active-descendant protection; its footer remains fixed. | Keep option selection, virtualizer measurement and focus owner intact. The existing adapter remains unchanged in this bounded pass. |
| [ContextMenu content adapter](../../src/components/context-menu/context-menu-scroll-content.tsx) and [explicit viewport](../../src/components/context-menu/context-menu-viewport.tsx) | Standard Arc root/submenu content has an independent inner native viewport, content-only fades and sibling rails; the original [native surface](../../src/components/context-menu/context-menu-content.tsx) remains available through `scrollTreatment="native"`. | Default `asChild` is not automatically wrapped; compose the explicit viewport directly inside its semantic host. Native ref/lifecycle, nonportal/forceMount, submenu semantics, 120ms entrance and existing highlights remain intact. Arc managed-owner registration is separate from scroll geometry. |
| [Managed ModalShell](../../src/modals/modal-shell.tsx), original [shell skin](../../src/modals/modal-shell.css) and new [ModalScrollShell](../../src/modals/modal-scroll-shell.tsx) | Next wrapper decorates actual body, retained tab panels, horizontal header tabs and responsive grouped navigation, keeping the original native branch. `scrollbar` and `navScrollbar` retain `auto`/`thin`/`hidden`. | Qualification is bounded to these exact owners; this does not decorate arbitrary inner custom scrollers. Fixed chrome, per-panel positions, form/focus ownership and divider state stay with the original shell. |
| [SheetContent](../../src/components/animate-ui/components/radix/sheet.tsx) | Arbitrary children with separate Header/Footer parts; all four side variants have no standard body viewport or decoration. | Design an explicit body composition before adding treatment. Do not wrap unknown children or silently replace Sidebar's mobile sheet. This remains part of the separate managed-drawer plan. |
| [DetailPanel](../../src/components/ui/detail-panel.tsx) | Nonempty body already uses public ScrollArea. The empty-state branch directly uses native `overflow-auto`. | The empty branch remains an ordinary adoption gap; preserve fixed nonempty header/footer. |
| [ListDetailLayout](../../src/components/ui/list-detail-layout.tsx) | List pane and animated detail pane directly use native `overflow-auto`; neither is decorated. | Qualify mobile list/detail focus handoff, resizable panels and exact animated viewport replacement before adoption. Do not duplicate list/detail trees. |

### Remaining Feature Surfaces

The wider native-scroll inventory includes the following ordinary owners. These
are an adoption queue, not changes included in the modal pass:

- [RecordNavigationBar](../../src/components/ui/record-navigation-bar.tsx) action
  row, [CascaderNavigation](../../src/components/cascader/cascader-navigation.tsx)
  breadcrumbs and [storage inspector](../../src/components/storage/storage-studio-inspector-primitives.tsx)
  tabs use horizontal native scrolling.
- Storage [drive inspector](../../src/components/storage/storage-studio-drive-inspector.tsx),
  [file inspector](../../src/components/storage/storage-studio-file-inspector.tsx),
  [studio list](../../src/components/storage/storage-studio-list.tsx),
  [permissions list](../../src/components/storage/storage-permission-list.tsx)
  and [file-browser pane](../../src/components/storage/storage-file-browser.tsx)
  own native bounded body/list viewports.
- DataStudio [column-header PopoverContent](../../src/components/data-studio/data-studio-column-header.tsx),
  [cell-editor body](../../src/components/data-studio/data-studio-cell-editor.tsx),
  [schema-column list](../../src/components/data-studio/data-studio-schema-editor.tsx)
  and [table-dialog impact list](../../src/components/data-studio/data-studio-table-dialog.tsx)
  remain distinct from the specialized grid viewport.
- [AppShell](../../src/components/app-shell/app-shell.tsx) optional workspace
  aside and [SidebarContent](../../src/components/animate-ui/components/radix/sidebar.tsx)
  own native scroll regions. Preserve their approved magnetic, hide/expand and
  icon-only behavior; do not route this into a navigation redesign.
- [ExpandableCard](../../src/components/expandable-card/expandable-card.tsx)
  has a legacy long-prose viewport with its own bottom-only mask;
  [OTPInput](../../src/components/auth/otp-input.tsx) has a narrow horizontal
  wrapper. Neither is automatically replaced by a new global style.

Existing public ScrollArea compositions also cover
[NotificationList](../../src/components/ui/notification-list.tsx),
[PhoneInput country choices](../../src/components/phone-input/phone-input-country.tsx),
[Kanban columns](../../src/components/kanban/kanban-board.tsx) and
[DataStudio inspector tabs](../../src/components/data-studio/data-studio-inspector.tsx).
Their semantic selection/data owners do not move merely because the treatment
shares tokens.

## Next Adapter Boundary

The new internal
[ScrollViewportDecorationNext](../../src/components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx)
uses the original metrics, observer and skin but delegates rail interactions to
the new
[viewport interaction controller](../../src/components/_internal/scroll-viewport/scroll-viewport-interactions.ts).
It admits one existing native viewport; it creates no overflow container or new
focus region. Its default orientation is both axes, unlike the retained public
ScrollArea's vertical default. This private option is not a new root or React
export for application code.

The controller implements smooth 90%-viewport track paging, immediate paging
under reduced motion, and snap-safe thumb dragging. It restores the exact
previous inline snap/scroll-behavior values and priorities on release, lost
capture, cancellation, blur, hidden-document retirement and teardown. Rail
dragging retains a fractional thumb grip and reads current native metrics and
painted rail bounds on every move, including viewport/content resizing and
positive per-axis scaling during capture. Invalid or disappeared geometry
retires the capture instead of applying a stale ratio. Rail
wheel handling owns only an actual consumed move. Viewport-level vertical-to-
horizontal wheel conversion is opt-in through internal `wheelMode:"horizontal"`;
native is the default. Ctrl/Shift gestures, existing horizontal gestures,
editable controls and nested scroll owners retain their behavior; an edge that
cannot move passes input through.

The adapter's bounded modal behavior is qualified below. DatePicker and ContextMenu
are the next explicitly adopted consumers; other existing consumers continue
to use the original adapter. Reusing the existing
observer also means React metrics updates remain; this is not the separately
planned direct-DOM performance rewrite.

[ModalScrollShell](../../src/modals/modal-scroll-shell.tsx) reuses the original
shell and composes its existing inner ref. It discovers only that shell's own
body/tab-navigation elements and portals sibling decoration into their actual
positioned parents. The new [modal treatment skin](../../src/modals/modal-scroll-treatment.css)
is scoped to an Arc marker installed after browser mount; server rendering
retains the original anatomy without decorative reads or an extra wrapper.
The modal manager selects this additive adapter, not a replacement animation,
form, action or modal-stack kernel. The original shell and stylesheet remain
separate, available native owners.

The new private [ScrollViewportAttachment](../../src/components/_internal/scroll-viewport/scroll-viewport-attachment.tsx)
accepts an exact native viewport and portals decoration only into its actual
parent. A reference-counted positioning lease applies only to a static parent,
then restores the previous inline value and priority if it still owns that
setting. Bounded reparent observation moves the sibling decoration without
guessing a global owner. It creates no DOM host, tab stop or scroll region.

DatePicker composes this through DayPicker's stable Root extension, forwarding
the original and caller refs rather than replacing the date engine. ContextMenu
supplies a standard inner div or an explicitly authored viewport part. Its new
floating-owner bridge inherits a managed modal's container, theme and protected
layer; only genuinely open branches register in Zero's dismissal registry. Closed
forceMount branches release that registration, and inactive owners disable input.
Explicit native retention can still retain Radix's modal/hideOthers/dismissal
effects until the caller unmounts it; hidden content is not automatically
converted to a nonmodal branch by this adapter.
For owned `asChild`, only reserved owner/layer/inactive props are projected onto
the one known child; host type/key/ref/handlers/children stay unchanged. Custom
components must forward native props/refs and must not override those reserved
props internally. The original/native branch remains unmodified.

The family owners and their retained compatibility paths are located in the
[source-organization reference](../frontend/components/source-organization.md).
Use the canonical internal mechanism, not another copy under each component.

## Integration Contract

1. Attach to the **actual viewport**. Do not nest ScrollArea around another
   overflow container, install a document-wide decorator or move scroll ownership
   into an animation wrapper. An ordinary custom body can opt into the same
   internal adapter through an explicitly documented composition contract.
2. Compute each physical edge from its actual hidden distance. Fitting content
   has no fade or rail; removing overflow clears both immediately. Preserve the
   current subpixel threshold and focus protections. Both-axis masks intersect
   without darkening the corner twice or fading the rails.
3. Constrain decoration to the body bounds. Header/footer, close button, fixed
   tab/navigation chrome and external borders/shadows remain outside the mask.
   Apply navigation treatment to its own viewport, not to the entire shell.
   In-content option highlights stay within their owner's clipping/mask; the
   active-row focus protection keeps their text legible rather than floating
   an independent highlight outside the scroll region.
4. Retain native keyboard/touch/momentum, focus scrolling and RTL behavior.
   Styling must not add a second focus region, move the active option, fake
   selection or fetch additional records. Partially visible ordinary items get
   the affordance; snapping remains an explicit behavior choice.
5. Add smooth 90%-viewport track paging, with immediate scrolling under reduced
   motion. During thumb drag, save the owner's snap setting, suppress it, then
   restore exactly on release, cancellation, replacement and unmount.
6. Where horizontal conversion is explicitly enabled, handle dominant vertical
   wheel input only while that viewport can consume it. Preserve Ctrl-wheel,
   horizontal gestures and edge pass-through. Do not capture the entire page's
   wheel events or steal nested controls' gestures.
7. Measure the direct-DOM geometry optimization against current dynamic
   observation. Preserve source-document ownership, transformed bounds, delayed
   font/image updates, active-descendant visibility and teardown restoration.
   A performance rewrite needs independent regressions, not just visual parity.

## Options And Compatibility Decisions

Candidate additions—not current Zero props—cover fade cap, bar visibility,
hide delay, bounded height, viewport label/class/style/ref, edge-change callback,
snap and horizontal wheel conversion. Final types belong in the owning public
manual after implementation, with complete native prop/ref forwarding and SSR
examples. Ordinary default use must remain concise.

ContextMenu's implemented bounded options are documented in its
[manual](../frontend/components/overlays/context-menu.md#scroll-treatment-and-custom-content):
Arc/native choice, orientation, fades, four rail visibility modes and standard
viewport ref/class/style. The explicit part additionally forwards native div
props and handlers. DatePicker adds only the Arc/native choice to its existing
contract. This does not expose all candidate options or change public ScrollArea.

Do not silently alias Arc `scrollbars="auto"` to current Radix `type="auto"`:
the current Zero mapping displays a shared rail whenever the axis overflows,
whereas the intended Arc automatic treatment follows hover/scroll activity.
Keep legacy behavior available and publish the explicit new default/migration
decision. Distinguish scrollbar visibility from edge fades; hiding a thumb must
not automatically remove hidden-content information.

Managed modal `scrollbar` and `navScrollbar` already accept `auto`, `thin` and
`hidden`. The bounded adoption freezes this mapping:

| Managed option | Next Arc treatment | Retained native treatment |
| --- | --- | --- |
| `scrollTreatment:"arc"` | New default; exact body/panel/navigation viewport receives edge fades and sibling overlay rails. | Does not mutate or remove the original shell. |
| `scrollTreatment:"native"` | No next decoration or Arc mask. | Original native shell anatomy/styles and scrollbar policy. |
| `scrollbar:"auto"` / `navScrollbar:"auto"` | Rails follow hover and scroll activity, only on an overflowing axis. | Existing browser-native auto policy. |
| `scrollbar:"thin"` / `navScrollbar:"thin"` | Thin overlay rails remain visible while that axis overflows. | Existing thin browser-native skin. |
| `scrollbar:"hidden"` / `navScrollbar:"hidden"` | No rails; hidden-distance fades and native scrolling remain. | Existing hidden browser-native bars. |

Body panels admit both axes. The header tab strip is its own horizontal owner;
grouped navigation is vertical on desktop and horizontal at phone widths.
Header/footer, close button and fixed frame remain outside body masks. Native
compatibility remains available; the original modal shell and CSS must stay
byte-identical through this pass. Preserve per-tab positions and existing
scroll-divider semantics. The mapping belongs in the modal manuals only with
the implemented descriptor and wrapper; it is not a change to public
ScrollArea's Radix `type` mapping.

DataTable/plain Table, DataStudio and audit tables, virtual grids, bottom-following
chat streams, code editors/previews, chart canvases and the Kanban drag board
retain their specialized scrolling, anchoring, progress and hit-testing owners.
Vector chunk previews retain their visualization owner. A future adapter may
decorate an admitted viewport, but must first qualify sticky columns,
virtualization, table horizontal-bar defaults, drag gestures and live-data
behavior. Never replace table pagination progress with a scroll thumb.

## Delivery And Qualification

- [x] Freeze the observed consumer matrix naming actual viewport and specialized
  exclusion, including controlled/custom branches and retained modal panels.
- [x] Freeze the managed-modal legacy/new visibility mapping and original-file
  preservation boundary.
- [ ] Complete public viewport-level options without changing public ScrollArea
  props, axis defaults or ref ownership incidentally.
- [x] Qualify the new adapter's paging, snap-safe drag and wheel pass-through
  independently, including geometry changes within one captured gesture.
- [x] Decorate managed modal body/panels/header tabs/nav through a new wrapper
  without new scrollers, changed focus ownership or fixed-chrome masks.
- [ ] Add explicit Sheet/drawer body composition through its separately managed
  family; existing Sheet and mobile Sidebar remain available.
- [ ] Expand ordinary menu/picker/custom-surface coverage under existing owners.
  DatePicker days/months and ContextMenu root/submenu adoption are implemented
  in new files and qualified separately below; the wider
  feature inventory remains open.
- [ ] Measure performance before adopting direct-DOM geometry updates.
- [x] Verify the bounded modal/next-adapter slice's pure metrics, native browser
  behavior, SSR/types, source-copy closure, installed archive, static Doctor
  export applicability and actual documentation examples. New semantic behavior
  must not be folded into the organization
  pass's frozen unchanged-body fingerprints.
- [ ] Qualify each remaining surface and public option separately, then obtain
  representative-application visual/accessibility and original-retirement approval.

The browser matrix includes fitting and fractional overflow; start/middle/end;
partly visible rows; both axes and corners; RTL; translated/scaled surfaces;
content, font and image changes; retained tab positions; focus/active descendant;
wheel at each edge; thumb cancellation and viewport replacement; nested specialized
scrollers; busy forms; touch momentum; live reduced motion and forced colors.
Observation/listeners/styles must be removed or restored on every teardown path.

### Bounded Modal Qualification

These checks qualify the new implementation without asserting that the wider
surface inventory is complete:

| Responsibility | Check |
| --- | --- |
| Ninety-percent paging, per-axis scale, drag offsets and bounded wheel plans | [Pure interaction tests](../../src/components/_internal/scroll-viewport/scroll-viewport-interactions.test.ts). |
| Original shell/adapter/skin/public ScrollArea/global stylesheet/theme bytes and descriptor admission | [Preservation tests](../../src/modals/modal-scroll-preservation.test.ts); frozen bytes are the originals present at the start of this adoption pass, including existing user work. |
| SSR anatomy and retained panel semantics | [SSR treatment tests](../../src/modals/modal-scroll-treatment.test.tsx). |
| Exact viewports, both axes, visibility policies, responsive navigation, native branch, drag/wheel, reduced motion and cleanup | [Native-browser treatment tests](../../src/modals/modal-scroll-treatment.browser.test.ts). |
| Real nested modal/picker portals, inert/Escape ownership, form acknowledgment, focus, sensitive exit paint and retained motion | Existing [manager regressions](../../src/modals/modal-manager.browser.test.ts) and [presentation regressions](../../src/modals/modal-presentation.browser.test.ts), with actual emitted component CSS in the harness. |
| Original/new copied dependency closure, static Doctor exports and non-overwriting CLI copies | [Source-copy qualification](../../src/add/modal-scroll-copy.test.ts). |
| Fresh installed root/React/modals types, SSR parity, both CSS skins, installed CLI copy and original retention | [Installed archive qualification](../../src/modals/modal-scroll.package.test.ts). |
| Actual public Arc/native manual example and retained facade/type identities | [Modal example compiler](./checks/modal-examples.test.ts) and [curated export qualification](../../src/frontend/frontend-exports.test.ts). |

Final bounded runs on **2026-10-11**:

- Pure interaction/metrics, original-preservation and existing modal-system
  contracts: **56 tests / 315 assertions**, no failures.
- Native Chromium and SSR across the new treatment plus retained presentation
  and real manager suites: **28 tests / 286 assertions**, no failures or skips.
  This includes thirteen new Chromium cases, two SSR cases, five presentation
  cases and eight manager cases. Desktop, phone and both-axis diagnostics were
  inspected; partial content fades without masking fixed chrome or rails.
- Actual source-copy/Doctor/CLI qualification: **3 tests / 79 assertions**,
  no failures. The existing `modals` target plans 57 production files. It
  includes required original shell/core and next adapter files, not the unused
  old decoration module or tests/backend assets. Repeat copies preserve
  customized original shell/CSS/hook/shared skin without `--force`.
- Fresh installed archive: **1 test / 100 assertions**, no failures.
  All **39 bounded production hashes** match working source, including the
  **nine frozen originals**. Strict public/consumer types, four public type
  identities through root/React/modals, six old-versus-next SSR comparisons,
  browser builds containing both skins and the actual installed CLI copy pass.
  Private adapters remain unexported. Application configuration, install scripts
  and supplied writers never execute; `.env`/`.env.local` are not loaded and no
  database files are created.
- Actual modal examples and curated export/type identities: **3 tests /
  26 assertions**, no failures. The canonical token check retains **462 roles /
  60 legacy aliases**, with zero unresolved references or parity problems.
- Documentation graph: **784 unique/reachable pages**, no problems; catalog
  home placement: **1,092 records / 182 homes**, no problems.

The unpublished dirty-snapshot archive SHA-256 is
`fe78c5fa8a665ec31c7fa756153a18138a9d85882f4787e3868f387ecc275575`.
The external diagnostic is
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/scroll-adoption/package-consumer-evidence.json`;
its per-source hashes were rechecked against the final working source.
This archive is historical evidence for the modal slice. Subsequent additive
facade/registry changes legitimately change those files' current fingerprints;
the ordinary-surface archive has its own final-source diagnostic below.
These are bounded implementation checks, not a claim that all workspace work
or all ordinary scroll surfaces are complete.

Independent review found two corrected defects: reduced-motion rail transitions
lost to a higher-specificity visible rule, and drag mapping retained stale
pointerdown geometry. Both corrections live only in new files; original CSS
and original adapter behavior remain unchanged. The original compatibility fixture
continues to exercise native hidden/thin recipes deliberately; the new fixture
qualifies the default Arc overlay mapping separately. No clean release,
whole-workspace approval or original-retirement permission follows from these
bounded runs.

Tokens belong in the existing role catalog and
[theme evolution ledger](./design-token-theme-evolution-plan.md), not a competing
surface stylesheet palette. Keep the original theme and polished Sidebar/Navbar
magnetic behavior intact until their separate approved migration gates pass.

No original implementation or theme file is scheduled for deletion in this
pass. Any later retirement needs passing replacement qualification,
representative-application comparison and the user's explicit approval of that
removal.

### Bounded DatePicker And ContextMenu Qualification

This is a separate semantic adoption, not a rebaseline of the organization
pass's unchanged native engines. Production files stay in their existing
families; the shared attachment is private. The following qualification is
completed against actual public facades, emitted CSS and copied/installed
consumers:

| Responsibility | Check |
| --- | --- |
| Static-parent positioning leases, shared use, reparenting and exact restoration | [Attachment tests](../../src/components/_internal/scroll-viewport/scroll-viewport-attachment.test.tsx) and the browser fixture below. |
| Original picker/Calendar/context bytes, SSR parity and canonical public facade identity | [DatePicker scroll tests](../../src/components/controls/date-time/date-picker-scroll.test.tsx) plus retained date/time suites. |
| Original menu content/surface/styles, native semantics, custom composition and protected owner props | [Context SSR tests](../../src/components/context-menu/context-menu-scroll.test.tsx), [preservation](../../src/components/context-menu/context-menu-scroll-preservation.test.ts) and [native types](../../src/components/context-menu/context-menu-scroll-types.test.ts). |
| Actual days/months/year handoff, partial content/both axes/RTL, refs, custom roots/hosts, closed presence and managed modal dismissal ownership | [Ordinary-surface browser matrix](../../src/components/_internal/scroll-viewport/ordinary-scroll-adoption.browser.test.ts), alongside retained date/time and ContextMenu presentation suites. |
| Direct ContextMenu/DatePicker and transitive DataTable dependency plans, actual CLI and customized-original retention | [Copy qualification](../../src/add/ordinary-scroll-copy.test.ts) and retained [date/time copy contracts](../../src/add/date-time-organization-copy.test.ts). |
| Fresh installed public imports/native types, SSR parity, both skins and actual installed CLI copy | [Archive qualification](../../src/components/_internal/scroll-viewport/ordinary-scroll.package.test.ts). |
| Public additive export/type identity, actual manual examples and catalog homes | [Curated exports](../../src/frontend/frontend-exports.test.ts), [UI examples](./checks/frontend-ui-examples.test.ts) and the [working-source catalog](./audits/catalogs/frontend-components.md#ordinary-scroll-adoption-working-source--2026-10-11). |
| Cold full-framework pack/install admission without changing inventory or exclusions | [Resource catalog](../../src/testing/test-suite-resources.ts), [catalog regressions](../../src/testing/test-suite-resources.test.ts) and [synthetic runner regressions](../../src/testing/test-suite-runner.test.ts). |

Final bounded results on **2026-10-11**, against the stable-provider source:

- Pure/native/SSR preservation, exact facade identities and new manual routing:
  **40 tests / 351 assertions**, no failures across eight files.
- All **19 new ordinary-surface Chromium cases** plus the **11 retained
  date/time cases**: **30 tests / 274 assertions**, no failures or page errors.
  This includes live native→Arc→native→Arc switching with the uncontrolled
  `02/` draft, open month view, exact input/viewport nodes and 47px offset
  retained. The separate retained ButtonGroup/ContextMenu suite's **16 cases**
  also passed with actual emitted adapter CSS and unchanged assertion bodies.
  New partial-menu/constrained-month screenshots and retained light/dark/mobile
  diagnostics were inspected; frame borders and fixed footer remain unmasked.
- New direct/transitive/static-Doctor/actual-CLI copy qualification:
  **3 tests / 116 assertions**. Retained date/time copy qualification, including
  its actual copied-browser consumer: **9 tests / 262 assertions**, rerun after
  the live-toggle correction. Customized original menu code survives even when
  it exists before the first copy; subsequent copies remain non-overwriting.
- Fresh installed archive: **1 test / 112 assertions**, no failures. All
  **44 bounded production hashes** match the final source, including **16 frozen
  original files**. Root/React/focused value and six public type identities,
  strict consumer/production types, seven native SSR comparisons, installed CLI
  copies and both CSS skins pass. Private adapters remain private. Configuration,
  install scripts and environment files do not execute; no database files appear.
- Native ContextMenu types, curated export identity/ordered contract and actual
  public UI Markdown examples: **4 tests / 102 assertions**, no failures. A
  separate strict program over the new browser fixture/test and DatePicker SSR
  regression has **zero diagnostics**. Manual/catalog routing plus retained
  Card/Select manual extraction checks: **6 tests / 215 assertions**.
- Installed-consumer admission bookkeeping and synthetic runner:
  **18 tests / 147 assertions**. The original ten entries/order remain unchanged;
  six reviewed full-framework pack/install cases are added. There are no new
  exclusions, scheduler logic, retries, timeouts or package-script changes.
- Canonical theme validation retains **462 roles / 60 legacy aliases**, zero
  unresolved references/parity problems. Documentation graph: **784 reachable
  pages**, no problems. Catalog homes: **1,095 records / 182 homes**, no problems.

The final unpublished dirty-snapshot archive SHA-256 is
`0966e6994a49c095c9f98fe8dfe874ae19340b9e7fc97fd280a8579bdc5efe8e`.
Its diagnostic is
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/ordinary-scroll-adoption/package-consumer-evidence.json`.
All recorded production hashes were rechecked against current source after the
final runs. The pre-live-toggle archive is not final qualification evidence.
These checks neither establish representative-application approval nor authorize
original retirement, publication or completion of the wider scroll inventory.

Review corrected four new-wrapper issues before final qualification:

- Standard menu separators retain their original negative margin. An unpadded
  new body produced four pixels of false horizontal overflow; default padding
  now belongs to the inner viewport through mergeable utilities. Caller frame
  and body padding overrides remain distinct and work without an unlayered CSS
  rule overriding them.
- ContextMenu originally lacked a managed-floating-owner bridge. New Arc
  content inherits the owner container/theme/layer and admits only genuinely
  open branches. The original/native path is intentionally unchanged.
- Radix Slot gives child props precedence. Narrow projection of reserved owner
  marker/layer/inactive guards prevents a direct `asChild` host from undoing
  managed stacking while preserving its type/key/ref/handlers/content. Unknown
  custom-component internals are not rewritten.
- DatePicker's initial Arc/native branches returned different React depths,
  remounting its original engine on a live presentation switch. A stable private
  provider/native-engine position now changes only the injected calendar Root.
  The live browser case retains the uncontrolled incomplete draft, open month
  view and exact viewport offset without selecting a date.

Installed Radix source review also confirmed that explicit closed `forceMount`
retains native modal accessibility/scroll-lock/dismissal effects. This is a
retained contract, not silently fixed by changing native lifecycle. Its browser
case verifies inactive new rails and released Zero registration, then explicitly
retires caller retention before checking parent accessibility and Escape.

## Related Plans

- [Drawer and BottomSheet](./drawer-bottom-sheet-system-plan.md) uses this treatment
  in an explicit managed body while keeping detent gestures separate.
- [Input modernization](./arc-input-modernization-plan.md) applies it to bounded
  country, tag-suggestion and mention menus under their existing selection owners.
- [Organization plan](./frontend-component-organization-plan.md) owns structural
  moves and compatibility qualification, not this semantic expansion.

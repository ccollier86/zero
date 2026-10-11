---
id: zero.frontend.components.source-organization
type: architecture
audience: [agent, developer, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: source-organization
maturity: supported
applies_to: ["2.6.0 working source; incremental organization with retained compatibility paths"]
modes: [browser, SSR, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# UI Source and Documentation Organization

[Component index](./index.md) · [UI reference](../ui-reference.md) · [Frontend index](../index.md)

Find an implementation by its family and responsibility, but consume it through
the supported package facade or a deliberate app-owned source copy. Physical
folders, public import paths and copy destinations are separate contracts.
An implementation move must not create another context, provider, modal manager,
subscription or animation owner.

## Implemented Source Owners

The incremental migration has these canonical owners. Other existing families
retain their current homes until their own dependency and consumer checks pass.

```text
src/components/
  controls/
    select/                 selection facade, specific geometry, motion and paint
    date-time/              Calendar, date/range/time controls and presentation helpers
    floating-button-group/  command tray, pure model/geometry and local paint/label tracks
  surfaces/
    card/                   native parts, ContentCard and status/hover presentation
    popover/                styled composition and its Radix presence adapter
  _internal/
    overlay-scope/          mounted branch identity, layers and theme projection
    anchored-surface/       shared anchored presentation and presence timings
    scroll-viewport/        actual native viewport metrics, rails and edge fades
    magnetic-highlight/    MenuActiveHighlight material for its existing consumers
  charts/                   existing chart-family hierarchy, not relocated by this pass
```

| Owner | Find its implementation | Read the consumer contract |
| --- | --- | --- |
| Card / ContentCard | [Card family](../../../src/components/surfaces/card/index.ts) | [Card parts and managed quick look](./surfaces/card.md). |
| Select | [Select family](../../../src/components/controls/select/index.ts) | [Select](./controls/select.md). |
| FloatingButtonGroup | [Action-tray family](../../../src/components/controls/floating-button-group/index.ts) | [Floating Button Group](./controls/floating-button-group.md). New focused route `components/floating-button-group`; no renamed old ButtonGroup facade. |
| Calendar and date/time | [Date/time family](../../../src/components/controls/date-time/index.ts) | [Dates and time](./primitives/dates-and-time.md). No separate DateTimePicker component is implied by combined test filenames. |
| Additive DatePicker scroll | [DatePicker facade](../../../src/components/controls/date-time/date-picker-scroll.tsx) over the retained [picker engine](../../../src/components/controls/date-time/date-picker.tsx) | [DatePicker](./primitives/dates-and-time.md#datepicker); existing UI/root/React entries select the new facade, while `scrollTreatment="native"` preserves the original engine. Days/months and years keep distinct viewport owners. |
| Context menus | [Content adapter](../../../src/components/context-menu/context-menu-scroll-content.tsx), [explicit viewport](../../../src/components/context-menu/context-menu-viewport.tsx) and [floating-owner bridge](../../../src/components/context-menu/context-menu-floating-surface.ts) | [Context Menu](./overlays/context-menu.md); standard inner viewport, explicit custom composition and unchanged native branch. Original content/surface/style files remain separate. |
| Popover | [Popover composition](../../../src/components/surfaces/popover/popover.tsx) and [primitive](../../../src/components/surfaces/popover/popover-primitive.tsx) | [Popover](./overlays/popover.md). The primitive is not a new application import. |
| Shared overlay identity | [Overlay scope](../../../src/components/_internal/overlay-scope/overlay-scope.tsx) | [Modal lifecycle](../modals/lifecycle.md) and the chosen floating component's manual. Radix/Floating UI retain their own focus/positioning duties. |
| Shared anchored paint | [Anchored surface](../../../src/components/_internal/anchored-surface/anchored-surface-motion.ts) | [Anchored Popover motion](./overlays/popover.md#anchored-motion); Select, Tooltip and modal recipes remain distinct. |
| Native scroll decoration | [Viewport decoration](../../../src/components/_internal/scroll-viewport/scroll-viewport-decoration.tsx) | [ScrollArea](./primitives/scroll-area.md); decorate the existing scroller, not another wrapper viewport. |
| Additive managed-modal scroll | [Modal scroll shell](../../../src/modals/modal-scroll-shell.tsx) and [next viewport adapter](../../../src/components/_internal/scroll-viewport/scroll-viewport-decoration-next.tsx) | [Modal layouts](../modals/layouts.md#placement-sizing-and-scrollbars); default Arc treatment on the original body/panel/navigation viewports, with explicit native compatibility. These are private helpers, not new package facades. |
| Explicit native-owner attachment | [Viewport attachment](../../../src/components/_internal/scroll-viewport/scroll-viewport-attachment.tsx) | [Scroll adoption boundary](../../_work/arc-scroll-surface-plan.md#next-adapter-boundary); decorates one admitted viewport's actual parent, with an exact shared positioning lease and no new scroller. Private, not an application facade. |
| MenuActiveHighlight | [Magnetic material](../../../src/components/_internal/magnetic-highlight/menu-active-highlight.tsx) | [Command](./primitives/command.md), [dates/time](./primitives/dates-and-time.md) and their existing interaction owners. |

Keep model, geometry, presentation, styles and tests with the family that owns
them. Group larger families along real seams rather than creating identical empty
subfolders. Cross-component browser tests belong with the shared mechanism they
qualify; generated bundles and temporary consumers belong in external scratch,
not beside production source.

The bounded scroll adoption uses new files beside the original implementation.
Its controller, Next-only reduced-motion skin and modal treatment skin are
separate responsibilities, all in the copied/imported dependency closure. The
original modal shell, shell CSS, shared metrics/hook/adapter/CSS, public
ScrollArea and both theme stylesheets stay retained. Do not merge away or delete
them on the strength of passing tests: removal needs the user's explicit approval
after replacement qualification and representative-application comparison.
The next ordinary-surface slice retains the DatePicker engine, Calendar and its
view context, plus ContextMenu content/surface/styles byte-for-byte. The public
DatePicker shim now forwards the new facade; the original is still its native
implementation, not a second picker copied into the wrapper. ContextMenu's
new reusable viewport is exposed through the small `controls/menu-scroll`
curated export module; its floating registration helper remains private.

## Public Facades and Compatibility Files

Application imports remain stable: root/React exports and focused paths such as
`@zero/framework/components/ui/select`, `/ui/calendar`, `/ui/date-picker`,
`/ui/date-range-picker`, `/ui/time-picker`, `/ui/card`, `/ui/content-card` and
`@zero/framework/components/popover` still reach their canonical implementations.
Do not infer a new package export from the folder names above.

Old UI/helper, Animate UI Popover and overlay helper/CSS paths are thin forwards,
not copied implementations. Both Calendar contexts and overlay registration state
therefore remain the same objects across old and new entries. Retaining a path
does not justify creating a second context to make an isolated file compile.
Existing wildcard-visible helper filenames remain compatible; canonical family
facades do not advertise every private helper as a new reusable primitive.

Frontend export maintenance lives under
`src/frontend/exports/{runtime,hooks,controls,layout,data,features,public-content}`.
The root entry forwards curated modules; these contain re-exports only, not
runtime setup, stores or providers. Preserve public symbol/type identity and
export order when editing that maintenance structure. New source groups must be
checked against ignore rules: the runtime `data/` ignore has a narrowly scoped
exception for the frontend's TypeScript data-export modules.

Do not consolidate mechanisms merely because their effects look similar:
Dropdown/Sidebar Highlight, MenuActiveHighlight, Select's geometry and Navbar's
magnetic material have different contracts. ContextMenu also keeps its own
pointer-anchored presence behavior. The larger Dropdown, Tooltip and Highlight
engines retain their existing paths in this pass.

## Source Copy Ownership

[zero add](../../cli/tooling/source-copy.md) keeps supported request IDs and old
app-owned destinations. Fresh copies include the required canonical closure;
existing files remain untouched unless the caller explicitly uses `--force`.
Copying never authorizes an application configuration edit or a provider/data
resource installation.

The [compatibility dependency manifest](../../../src/add/component-compatibility.ts)
records exact former file dependencies. The copy queue applies it whenever it
encounters a compatibility file, including through another component's imports.
This is important when, for example, StatCard imports Card or DataTable imports
Select: a customized old facade can still need its old helper destination even
though the current implementation has moved.

The manifest adds bounded files, not a whole-folder sweep. A new move must record
former dependency edges before replacing old files, test direct and transitive
requests, and prove customized-copy preservation. Inspect the proposed plan with
`--dry-run`; a directory being canonical does not make it an addable request ID.
Do not blindly force-recopy a consumer to repair a missing dependency.

## Documentation Hierarchy

The [UI reference](../ui-reference.md) owns shared token, typography and
action-to-animation routing. System overviews explain facade/data/lifecycle
ownership and index their detailed manuals. For example,
[Charts](../charts/index.md) owns its five canonical family manuals alongside
the shared Charts API, while [Modals](../modals/index.md) owns its content, motion,
forms, confirmation and lifecycle references.

Focused [control](./controls/index.md) and [surface](./surfaces/index.md) manual
indexes now contain real Select and Card/ContentCard references. Mixed primitive
pages keep Combobox/Checkbox/Radio/Switch and Badge/Avatar/Separator/Skeleton
contracts, plus concise former Select/Card section links. The family manuals
have new IDs because only sections were extracted; the mixed pages retain their
original IDs and remaining sibling content. Do not treat this as moving an
entire page's identity to a subset of its API.

Application and public assembly workflows stay in their
[respective](../../guides/application-ui-development.md)
[guides](../../guides/public-ui-development.md); do not duplicate a default-motion
table in each workflow. Reusable public parts need a reference section or page.
Parent-only helpers stay documented with the parent and its source owner.

When moving a manual, retain its stable ID at the canonical location. Old routes
can keep small compatibility pages with distinct IDs and links for their old
section anchors. Internal navigation and example harnesses should use the new
canonical path; do not leave full duplicate manuals that can diverge.

## Continue a Family Migration

1. Read the family's implementation and existing consumer manual. Inventory
   imports, helper/CSS closure, contexts, private aliases and copy-plan destinations.
2. Record old → canonical → public facade → copy destination mapping in the
   [organization roadmap](../../_work/frontend-component-organization-plan.md).
3. Move one coherent responsibility with its tests/fixtures. Retain identity
   forwards and exact historical copy edges; do not change behavior in the move.
4. Reconcile CSS fan-in and documented source links. Keep pure tokens in the
   design-system owner and transport/subscriptions in SDK/hooks, not rendering.
5. Qualify native types/refs, SSR, browser focus/overflow/controlled state, copied
   CSS/helpers, installed imports, public symbol identity and private mappings.
6. Check canonical documentation IDs, old routes/anchors, examples and navigation.

The original theme, shared stylesheet infrastructure and rollback stay retained.
Follow [theme retirement gates](../design-system/foundation-next.md#retire-the-original-theme-safely)
before approved deletion. Source organization and static Doctor evidence are not
whole-application visual or accessibility approval.

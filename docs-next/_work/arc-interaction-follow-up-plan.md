---
id: zero.arc-interaction-follow-up-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: arc-interaction-follow-up
maturity: planned
applies_to: ["2.6.0 working source; FloatingButtonGroup and bounded modal/DatePicker/ContextMenu scroll adoption qualified; remaining families staged"]
modes: [browser, SSR, application, public-pages, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Arc Interaction Follow-Up: Requirements And Ownership

[Working evidence](./index.md) · [UI reference](../frontend/ui-reference.md) · [Source organization](../frontend/components/source-organization.md)

This is the routing plan for the latest requested UI additions. The current
phase records requirements precisely and continues source/documentation
organization. The additive [FloatingButtonGroup manual](../frontend/components/controls/floating-button-group.md)
now describes implemented working source. Managed modal scroll adoption and a
separate next interaction adapter are implemented; their bounded qualification
is recorded in the scroll plan. The remaining families and wider scroll coverage
stay staged.
The next DatePicker days/months and ContextMenu root/submenu slice is now
implemented in separate wrappers with explicit native compatibility and has
completed its bounded qualification. Custom menus expose one documented viewport
part rather than automatically wrapping unknown content.
Each family plan
separates current source facts, reference behavior, proposed contracts,
compatibility decisions and qualification gates. Proposed API names are not
instructions to import unavailable exports.

## Requirement Register

| Requested capability | Owning plan and required result |
| --- | --- |
| Scrollable ordinary surfaces | [Arc scroll adoption](./arc-scroll-surface-plan.md): actual hidden-content fades/overlay rails on either axis, including partially visible items; preserve one native viewport and specialized table/editor ownership. Modal body/panel/navigation, paging/drag/wheel and DatePicker/ContextMenu bodies have bounded checks with native compatibility. Wider coverage and expanded public ScrollArea options remain staged. |
| BottomSheet and full drawer system | [Managed drawers](./drawer-bottom-sheet-system-plan.md): standard anatomy, detents/gestures, custom sizes/edges, typed content/actions/results and coordinated modal/drawer/picker stacking. Existing Sheet and bottom-placed modal are not that subsystem. |
| Numeric field in tables/helper API | [Numeric controls](./number-field-rolling-number-plan.md): Arc-style stepping/hold/scrub/limits, compact table configuration and real schema/accepted-write integration without losing nullable/invalid draft behavior. |
| Changing digits anywhere | [Reusable number display](./number-field-rolling-number-plan.md#digit-position-contract): only changed places move—`407→408`, `409→410`, `499→500`—with locale/sign/fraction/width, interruption and accessible-text contracts. Keep the implemented table recipe; do not replace real values with a fictional animated count. |
| Phone input | [PhoneInput](./arc-input-modernization-plan.md#phoneinput-morph-the-picker-keep-the-engine): reference-style country/flag/code presentation, complete existing country metadata, independent optional country/flag UI and US/+1 when country is omitted. Preserve inferred international values, native forms and numbering-plan validation. |
| Tag input | [TagInput](./arc-input-modernization-plan.md#taginput-preserve-admission-improve-interaction): Arc-style pills, wrapping and keyboard picking/removal/duplicate feedback, with explicit compatibility for current controlled admission rules. |
| Mentions tied to users/presence | [MentionInput](./arc-input-modernization-plan.md#mentioninput-new-facade-existing-authority): people/channel tokens, caret suggestions and optional authorized roster/presence adapters. A mention box does not acquire administrative directory rights or start another heartbeat. |
| Inline editing | [InlineEditText](./arc-input-modernization-plan.md#inlineedittext-presentation-on-accepted-writes): stationary text-to-input geometry and saved/error feedback on the existing revision-aware, scope-fenced state machine. Preserve distinct blur/explicit failure policies. |
| Floating action tray | [Floating Button Group](./floating-button-group-plan.md): full muted/floating material, two densities, row/column layout, icon/text actions, separators, pressed/disabled state, shortcut hints, reserved changing labels and one magnetic highlight. Keep joined ButtonGroup/Toggle intact and reuse Zero Tooltip and actual overlay placement owners. |

The repeated InlineEdit link is one requirement. The phone reference is Arc's
PhoneInput family; its limited example country table is not the production
metadata source. The detailed plans preserve the requested settings and record
remaining decisions without presenting them as current props.

## Shared Design And Service Boundaries

Consume Zero's canonical theme/typography catalog and scoped overrides. Record
new roles and reference evidence in the
[theme ledger](./design-token-theme-evolution-plan.md), then connect the owning
manual. Do not install another palette, font scale, icon registry or animation
manager per component.

Preserve Sidebar/Navbar magnetism and extend coherent active-row paint through
actual menu selection owners. Keep modal From Button/Rise fallback, reverse
exit, dim/blur/recession/stack settings, real hold confirmation, Tooltip
Grow/arrow and compact chart inspection. Drawer gestures, caret panels and digit
changes follow distinct action relationships; every surface does not receive
the same entrance. ContextMenu keeps its original compact entrance and highlight
recipe in the scroll-only adoption; a separate magnetic redesign is not implied.

Reuse existing primitives and expose supported reusable parts through family
facades. Parent-only helpers stay documented with their organism. Custom
composition remains possible while retaining accessible names, standard chrome
and the owning lifecycle.

Reactive DB, Fabric/triggers/functions, Guardian and Torrent retain their real
authority and operation owners. Components observe admitted projections or call
supplied writers. They do not fabricate progress, grant permissions, infer
accepted saves or send notifications from local selection. A field or visual
display alone does not require a new server service.

## Dependency-Ordered Delivery

1. Preserve the qualified organization baseline and import/copy identities.
   Finish canonical manual routing and inventory gaps independently of semantic
   feature work. Original theme material stays retained.
2. Freeze scroll compatibility/coverage and qualify the shared viewport
   adapter's interaction gaps before spreading it across more bodies.
3. Define drawer facade/lifecycle extraction and pure detents, then compose its
   shell/body. Qualify mixed stacks before migrating Sidebar/Sheet consumers.
4. Define numeric parse/step and digit-place models, extract one display engine
   with the table recipe, then add field and table-helper composition.
5. Address TagInput and PhoneInput separately, freezing native contracts and
   new behavior defaults. Reuse existing composition/metadata owners.
6. Define MentionInput text/token/caret and authorized-candidate adapters.
   Review any genuine directory gap separately. Apply InlineEdit presentation
   to its existing save model; multiline/semantic-host additions have their own
   contract.
7. Add the floating action tray independently of joined/selection groups. Freeze
   action identity/roving focus and token mappings before its motion/label layer;
   qualify four-side Tooltip and anchored composition through existing owners.
8. For each implemented slice, update full manuals, examples, catalogs, copy
   manifests and applicable Doctor rules using actual version/capability evidence.

This is a dependency plan, not a requirement to ship one breaking release.
The selected future live project is [Pantheon](./design-token-theme-evolution-plan.md#pantheon-live-validation).
Its application migration is a separate validation gate after the relevant
library work, not a claim that the planned drawers or remaining controls exist.
No documentation checkbox establishes feature implementation or removal approval:

- [x] Inspect current owners and official reference contracts.
- [x] Record the requirement register and detailed family plans.
- [ ] Freeze each new public type/default and legacy compatibility recipe.
- [ ] Implement and qualify each bounded feature slice with actual consumers.
- [ ] Reconcile full symbol/type/helper inventory and capability-aware upgrades.
- [ ] Obtain representative-app visual/accessibility approval and perform any
  explicitly authorized publication or theme retirement.

Keep every original implementation and theme until replacement qualification
and the user's explicit retirement approval are both complete. The modal slice
retains the original shell, CSS, scroll adapter and public ScrollArea; its
`scrollTreatment:"native"` option makes the old recipe directly comparable.
Passing a synthetic consumer test alone does not authorize deleting an original.

## Documentation Structure

The [UI reference](../frontend/ui-reference.md) remains the main routing document
for tokens, typography and action-to-motion policy. Application/public assembly
guides link to it instead of duplicating defaults. System overviews index their
manuals: Charts demonstrates this tier; Modals owns lifecycle/forms/motion.
The future drawer overview follows the same structure without duplicating
authority contracts.

Keep focused PhoneInput/ScrollArea references canonical. Card/ContentCard and
Select now have [surface](../frontend/components/surfaces/card.md) and
[control](../frontend/components/controls/select.md) manuals, with retained mixed-
page IDs, sibling contracts and old section routes. New NumberField, RollingNumber,
MentionInput, BottomSheet and FloatingButtonGroup manuals become implemented references only after
actual APIs exist. This work section holds plans, not placeholder API pages.

The [organization roadmap](./frontend-component-organization-plan.md) tracks
bounded physical/manual moves. Stable IDs, compatibility routes, parent/index
links, actual example compiler inputs and catalog homes move together. Historical
export evidence remains historical; an additive working supplement does not
prove complete current-source coverage.

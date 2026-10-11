---
id: zero.floating-button-group-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: floating-button-group
maturity: supported
applies_to: ["2.6.0 working source; additive FloatingButtonGroup implemented, unreleased"]
modes: [browser, SSR, application, public-pages, package-imports, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-11"
  evidence_level: source-observed
---

# Floating Button Group Adoption Plan

[Working evidence](./index.md) · [Full manual](../frontend/components/controls/floating-button-group.md) · [Interaction requirements](./arc-interaction-follow-up-plan.md) · [Theme ledger](./design-token-theme-evolution-plan.md)

FloatingButtonGroup is implemented as an additive, token-driven action tray in
working source. It retains the reference capabilities while using Zero's native
Button, Tooltip and active overlay scope. Joined ButtonGroup and Toggle selection
keep their existing contracts. The [full manual](../frontend/components/controls/floating-button-group.md)
owns exact props, defaults and runnable compositions; this roadmap retains the
reference calibration, adaptation decisions and remaining qualification gates.
Working-source availability is not a published package upgrade, application
visual approval or permission to remove the original theme.

## Reference And Coverage

The [official manual](https://uiarc.dev/components/floating-button-group/markdown)
defines an action tray with separators, icons, disabled and mode actions,
shortcut hints and reserved alternate labels. It offers muted/floating material,
small/medium sizing, row/column orientation and four tooltip sides. Roving focus
uses orientation arrows with wrapping and Home/End; Enter/Space activates.
Shortcuts are descriptive, not bindings. Icon-only density should reduce narrow
layouts before actions move to an overflow menu. It is not a selected-view or
formatting controller.

The [registry](https://uiarc.dev/r/floating-button-group.json) uses one measured
highlight with independent geometry, opacity and press tracks. It appears at
the target, follows between actions, stays across gaps, and retires on tray
departure. Labels exchange in a measured slot. Button boxes remain stationary.
Native pointer departure avoids React portal bubbling. ResizeObserver tracks
tray/items; reduced motion removes travel. The private side-tooltip recipe is
separate from its top/bottom Tooltip.

The existing [broad inventory](./arc-design-token-inventory.json) already captures
this family's 35 CSS references, 26 declarations and eight JS motion references.
The [dated supplement](./floating-button-group-token-inventory.json) records
current registry identities and a disposition for every reference. CSS matches
the pinned repository; the TSX differs only in two installation import paths.
Keep the dated inventory intact rather than relabel its original observation.

## Current Zero Owners

| Owner | Current contract | Adoption boundary |
| --- | --- | --- |
| [ButtonGroup](../frontend/components/primitives/button-group.md) | Native joined/separated composition; caller-owned children, actions, field refs and form behavior. | Keep this facade and defaults. It is not the floating tray or an action-roving controller. |
| ButtonGroupToggle in the same manual | Radix single/multiple selection, roving focus and controlled values. | Keep selection here. A persistent mode action can expose pressed state without turning the new tray into a toggle group. |
| [Button](../frontend/components/primitives/inputs.md) | Shared native control, animated icons and family sizing/feedback; native button boxes already remain stationary. | Reuse compatible rendering. Do not add optional whole-button motion to this tray recipe or silently clone arbitrary children. |
| [Tooltip](../frontend/components/overlays/tooltip.md) | Grow/400ms, arrow, rich content, side/collision options and group continuity. | Use the existing system on all four sides. Do not install Arc's separate side-tooltip provider, z-index or 110ms exit. |
| [Magnetic policy](./design-token-theme-evolution-plan.md#required-magnetic-highlight-contract) | Existing Sidebar/Navbar springs and active-menu mechanisms have explicit owners. | Reuse eligible measurement/paint mechanisms after qualification, not a menu selection controller or a replacement navigation spring. |
| [Theme foundation](../frontend/design-system/foundation-next.md) | Scoped semantic paint, type, density and motion catalog. | Map the tray recipe into this catalog. Do not ship another Arc root stylesheet/font loader. |

Floating material describes elevation, not positioning. The tray should work
inline without a portal or new global overlay/dismissal/keyboard owner. Scoped
owner-document cleanup listeners are allowed where the lifecycle needs them.
A selection/canvas
toolbar may separately compose an existing anchored owner. Its portal, layering,
collision, dismissal and active-scope retirement remain that owner's job.

## Working Public Contract

The implemented facade preserves every reference option and adds native tray/
action refs, explicit or inherited `dir`, and existing overlay-scope retirement.
The focused entry, root and React entry export one value and seven public types;
private geometry/label/paint helpers remain with the family.

| Contract area | Required capability and responsibility |
| --- | --- |
| `items`, `label` | Ordered actions/separators and a specific accessible toolbar name. Stable unique action IDs; reject or diagnose collisions rather than sharing refs/highlights. |
| Action `id`, `label`, `icon` | Stable identity, changing accessible name and optional app-supplied icon. No new icon registry. Labels are not command or permission identifiers. |
| `iconOnly` at group/item levels | Group default with per-item override. Keep text if no icon exists; never produce an unnamed/empty action. |
| `disabled`, `pressed` | Inactive commands use aria-disabled, skip roving focus and cannot activate/acquire press paint. Existing pointer tooltips remain discoverable where present. Caller-owned mode state maps to aria-pressed; hover never toggles it. |
| `onSelect`, `onAction` | Synchronous item command then group intent callback. A synchronous item exception prevents the group callback; promises are not awaited or caught. Neither callback implies accepted persistence, deduplication or analytics delivery. |
| `shortcut` | Optional visible/accessibility hint; actual shortcut registration belongs to an existing scoped command owner. |
| `reserveLabels` | Reserve width for actual alternate labels while hiding ghost/outgoing text from assistive technology. Retain exact current label for the accessible name. |
| Separator `type`, optional `id` | Decorative cluster boundary, perpendicular to the tray. Not a focus, hover or action target. |
| `variant` | Muted and raised floating material; no implicit overlay positioning or selection semantics. |
| `size` | Both reference densities with scoped customization; compact dashboard typography stays intentional. Reference geometry is calibration, not a new universal Button scale. |
| `orientation`, direction | Rows and columns; explicit inherited/overridden RTL policy. Do not inherit a hardcoded left-to-right navigation rule. |
| `tooltipSide` | Four sides, row/column defaults, actual collision resolution through Zero Tooltip. One native trigger and one accessible description per action. |
| `className`, `style`, refs | Scoped customization and native tray/item focus/ref access where admitted. Ref/handler composition must not lose the owning control. |

Keep headless geometry and decorative presentation separable from command data.
Expose reusable parts only if real consumers need them; internal label phases,
measurement caches and highlight tracks remain documented with the parent.
Do not enlarge this into an async action service or selection state machine.

## Token And Motion Promotion

The supplement maps all shared CSS references to existing Zero roles and marks
local geometry/material aliases and obsolete side-tooltip references separately.
Its historical reference calibration is separate from the implementation record.
The canonical catalog now adds 57 scoped tray roles, with the complete catalog
at 462 roles. The [pure theme owner](../../src/design-system/theme-floating-button-group.ts)
provides shape/material aliases and named motion recipes; the implementation
keeps these constraints:

- Reuse primary/secondary/muted text, raised surface, border, floating elevation,
  selection fill and body/control typography. Preserve the distinction between
  transient highlight, pressed feedback and a persistent mode tint.
- Add only missing scoped tray/press/shape roles to the canonical validated
  catalog, render light/dark variants and project them to owned portals. Do not
  copy Arc's root-only dark selector; nested themes and public/application
  boundaries must resolve locally.
- Preserve concentric tray/item corners, independent spacing and stationary
  native controls/icons/hit targets. Text exchanges inside a reserved slot;
  icons stay mounted outside departing label phases. Geometry defaults and
  density aliases must not make the approved compact dashboard larger. Zero's
  current compact control radius
  is 6px at a 16px root, versus the reference's 18px. Applying Arc's small-size
  offsets directly would produce a negative inner radius. Define valid scoped
  tray/item density recipes and check their bounds; do not globally round every
  control or blindly subtract upstream offsets from a different foundation.
  Reference 30/36px visual heights use the larger active minimum target:
  compact 32px, comfortable 36px and touch/coarse-pointer 44px. Scoped 15/18px
  tray corners and 11/13px inner corners avoid changing the 6px global control
  radius or silently shrinking touch controls.
- Use a named tray movement recipe calibrated to the reference Morph spring.
  Reuse the measured shared 420ms width calibration only if its lifecycle fits;
  it is not a hard completion deadline. Define press/first-entry and label
  handoff tracks independently. Never retune Sidebar/Navbar for this addition.
- Use Zero Tooltip's Grow/arrow policy, hover intent and warm-group handling.
  Do not transfer the reference's private side-tooltip color/spacing/motion into
  all tooltips. Its private `--side-tip-exit` keyframe sentinel is not a new
  shared token. Keep tooltip and tray transforms on different elements.
- Reduced motion settles geometry immediately and keeps visible focus/state.
  Forced colors needs an actual keyboard indicator; a faint neutral wash alone
  is not sufficient. Keep native focus visibility even when highlight paint
  cannot be measured or animations are disabled.

## Interaction And Lifecycle Invariants

The adaptation closes the following reference gaps through bounded model,
browser and presentation checks. These invariants remain qualification targets
for future consumer changes, not claims that the existing joined ButtonGroup
is broken or that every application/device has been visually approved.

1. Resolve pointer-versus-keyboard precedence deterministically. Pointer travel
   may hand material to an enabled action; keyboard navigation takes it back
   immediately. Crossing a separator retains continuity without activating it.
   Dynamic disable/removal must retire stale focus/hover IDs, including a
   focused action that becomes disabled and the last enabled action disappearing.
2. Define empty/all-disabled toolbar behavior and focus recovery. Roving focus
   uses a native focusable root when every action is unavailable or removed.
   It cannot strand an active user when commands change. Orientation/RTL, Home/End,
   wrapping, focus return and multiple instances must be independently tested.
3. End touch/pen/mouse press paint on release, cancellation, lost capture,
   document departure and unmount. Do not rely on a later pointerleave to clear
   touch hover. Disabled actions remain readable if the tooltip policy allows
   it, but cannot run commands, acquire press paint or retain moving material.
4. Measure against the actual tray and ownerDocument/defaultView. Uniform
   scaling, fractional DPR, scrolling, borders, zoom and reflow need coverage.
   The upstream width-ratio correction is not proof of nonuniform-scale or
   rotated-transform support. The adapter admits positive independent axis
   scaling/translation and fails closed for rotation, skew, reflection and
   perspective. Target and composed ancestors are guarded, including individual
   rotate/scale properties, assigned slots and shadow hosts. Native focus and
   commands remain usable when decorative geometry retires.
5. Retarget current visual pose on rapid reversals and label/size changes.
   Rebind observation when a same-ID DOM node is replaced, including tooltip,
   icon-only and density composition changes. Observe relevant font/reflow
   events without a perpetual measurement loop. Stop animations/listeners on
   retirement and do not accept stale completion callbacks.
6. Keep a natural, nonwrapping tray. Caller-selected compact/icon density,
   vertical layout or an overflow menu must preserve all commands. If the caller
   deliberately scrolls an action rail, decorate that actual viewport with the
   [ScrollArea recipe](./arc-scroll-surface-plan.md); do not clip actions or add
   a second scroller just to reproduce the demo.
7. Preserve SSR/hydration without layout reads during server rendering,
   ResizeObserver availability assumptions or ambient window/document imports.
   A decorative highlight failure must leave usable native actions and focus.

## Service And Composition Boundaries

Actions call supplied app/domain command owners. Pending, accepted-write,
confirmation and safe error state come from those owners. In particular,
Share→Copied appears only after clipboard success; Present→Stop reflects actual
mode state; Delete uses the approved confirmation/hold path where required.
A shortcut hint, disabled button or local label is not authorization.

Reactive DB subscriptions, Fabric functions/triggers, chart controllers and
user/presence hooks may supply command availability and state through admitted
projections. The tray starts no subscription, heartbeat, transport, telemetry
or server service on its own. Tenant/record command sets and callbacks retire
with their existing scope owner; never let a retained visual invoke an old
scope's command.

Useful compositions include chart play/pause/trace tools, an editor rail and
compact selected-record actions. Preserve chart inspection and DataTable query/
new-record behavior; adopting a tray does not replace those controllers.

## Source And Documentation Organization

The focused `src/components/controls/floating-button-group/` family owns the
facade, pure action model/geometry, label/highlight presentation, skin and tests. Keep
current `src/components/button-group/` exports untouched. A future shared
measurement helper belongs under `_internal` only after a second qualified
consumer demonstrates reuse; do not merge unrelated highlight state machines.

The [full manual](../frontend/components/controls/floating-button-group.md) is
linked from the real controls/component indexes, ButtonGroup and main UI
reference. It documents every public value/type, exact defaults, accessibility,
customization and command boundaries, with three complete row/column,
changing-label and Popover-owned anchored examples.

The focused package route `@zero/framework/components/floating-button-group`
maps directly to the canonical family entry; root and React export the same
facade/types. `zero add components/floating-button-group` targets that family
and follows its CSS/helpers, Button, Tooltip and overlay-scope closure. Existing
custom copies remain protected unless explicit force is requested. The existing
source-only Doctor export inspector recognizes the additive route; no blanket
joined-ButtonGroup/toolbar migration rule is introduced.

## Implementation Qualification

Bounded checks live with the responsibility they qualify:

The final isolated family run passed **27 tests and 276 assertions**, with no
failures or skips: 13 browser tests, two SSR tests and 12 pure model/geometry
tests. It includes stationary mounted icons, rapid reserved-label changes,
target/composed-ancestor transform admission and transform-only invalidation.
Isolated screenshots were inspected. The eight pure theme tests passed;
existing ButtonGroup qualification remained unchanged.

All three source-copy tests passed, including the actual isolated consumer
browser build, preserved customized copies and source-only Doctor resolution.
The copied CSS/Tooltip/helper closure and the fresh installed-package archive
are separately qualified; neither replaces representative-application approval.

| Contract | Source qualification |
| --- | --- |
| Identity, disabled ordering, focus recovery and RTL navigation | [Pure model tests](../../src/components/controls/floating-button-group/floating-button-group-model.test.ts). |
| Borders, scroll offsets, independent scale, DPR and unsupported transforms | [Pure geometry tests](../../src/components/controls/floating-button-group/floating-button-group-geometry.test.ts). |
| Native SSR semantics and empty/all-disabled recovery | [SSR tests](../../src/components/controls/floating-button-group/floating-button-group.ssr.test.tsx). |
| Hydration, motion, focus changes, stable icon/label slots, pointer/touch, nested themes, transforms and overlay retirement | [Browser tests](../../src/components/controls/floating-button-group/floating-button-group.browser.test.ts). |
| Complete role aliases, valid density geometry, palette/reduced motion and unchanged existing recipes | [Pure theme tests](../../src/design-system/theme-floating-button-group.test.ts). |
| Canonical copy closure, preserved customization, browser consumer build and static Doctor resolution | [Source-copy tests](../../src/add/floating-button-group-copy.test.ts). |
| Installed focused/root/React identity, public types, SSR and browser/archive closure | [Package qualification](../../src/components/controls/floating-button-group/floating-button-group.package.test.ts); the bounded fresh archive run passed, as recorded below. |
| Reference coverage, working API/manual routes and role inventory | [Documentation contract check](./checks/floating-button-group-plan.test.ts). |

Fresh installed-archive qualification passed one test and 78 assertions. The
archive SHA-256 is
`81cc3c2608100cf273fed91b01183cc8ff57fdd4a80c27dc1db9dc5b46786c19`;
39 bounded production hashes match current family, theme, public-export,
stylesheet, source-copy and protected-owner source. It verified focused/root/
React value and seven-type identities, strict consumer types, SSR, scoped
roles/CSS, original ButtonGroup/theme retention and existing Doctor inspection.
The isolated browser assets total 3,143,898 bytes; the application-configuration
tripwire was not executed, environment files were not loaded and no database
files were created. Evidence remains a dirty
working-source archive, not a clean release or whole-workspace certification.
The external record is
`/Volumes/code-bank/artifacts/zero-platform/diagnostics/floating-button-group/package-consumer-evidence.json`.

The final distribution/manual pass passed six tests and 132 assertions across
three files: three source-copy tests, two curated public-contract tests and one
actual UI-example compiler test. The compiler passed 87 assertions and included
all three new manual fences. The frozen earlier public-export digest remains
preserved alongside the eight additive value/type symbols.

The documentation graph has 784 unique reachable pages with no problems; catalog
placement has 1,092 records across 182 homes with no problems. The token audit
checked exact generated parity for 462 canonical roles and 60 legacy aliases,
947 source files and 49 compiled dependencies, with no unresolved references or
problems. Existing 908 legacy-reference and 99 literal-color candidates remain
bounded review evidence, not new component failures or theme-retirement proof.

The reference supplement preserves pinned upstream hashes, capabilities and
token dispositions, with a separate working implementation record rather than
rewriting that historical observation. Component screenshots/isolated browser
fixtures and clean checks are not representative-application visual acceptance.

## Delivery And Acceptance

- [x] Inspect the official manual, full registry TSX/CSS and shared motion source.
- [x] Confirm existing token coverage, retain its original observation and record
  current source identities, complete reference options and token dispositions.
- [x] Identify current Zero owners and adaptation gaps; index the documentation.
- [x] Freeze facade/defaults, action identity, aria-disabled/focus recovery policy
  and the 57 scoped roles, preserving original ButtonGroup and animation defaults.
- [x] Implement pure model/geometry, stationary controls/icons, reserved text slot
  and interruptible highlight with bounded transform admission.
- [x] Compose existing Tooltip and overlay scope without a duplicate global
  positioner, portal or descriptive system.
- [x] Record completed runtime qualification for SSR, keyboard/RTL, pointer/touch,
  forced colors, reduced motion, dynamic actions/labels, transforms, delayed fonts,
  nested themes and mixed stacks against the final current source.
- [x] Record completed isolated source-copy qualification and Doctor export
  resolution against the final current source; retain customized copies.
- [x] Add complete manual, public-type/default references and three complete
  examples; route component indexes and the main UI reference to that owner.
- [x] Qualify installed focused/root/React imports, seven-type/archive identities,
  strict consumer types and CSS with protected owners retained.
- [x] Compile the actual manual examples against final source, qualify the
  additive public facade and validate documentation/catalog/token graph parity.
- [ ] Review compact application and public-page consumers visually before any
  separately authorized release or original-theme retirement.

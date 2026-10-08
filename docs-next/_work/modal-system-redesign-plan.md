---
id: zero.modal-system-redesign-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: modals
status: draft
visibility: internal
system: modals
feature: modal-system-redesign
maturity: planned
applies_to: ["Proposed redesign; current 2.6.0 source inspected, not an implemented API"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Modal System Redesign And Integration Roadmap

[Working evidence](./index.md) · [Modals roadmap](../frontend/modals/roadmap.md) · [Product roadmap](../../docs/platform-roadmap.md#user-interface-and-application-building)

Recorded from the approved modal design discussion. This is the authoritative
implementation plan for that discussion, **not a shipped API reference** or a
claim that the changes below are complete. The source baseline above is committed;
the working tree also contains unrelated configuration-planning documentation.
Those drafts are not part of this implementation and must be preserved.

The planning pass inspected source, public facades, existing consumers, tests and
documentation. It did not run a consuming application, reproduce a browser defect,
change runtime code, access live data or publish a release. Future verification
gates below describe required work, not results already obtained.

## Outcome And Scope

Evolve Zero's existing modal manager into the standard way to build application
dialogs. The manager owns the frame, header, close control, sizing, positioning,
scroll boundaries, accessible labeling, actions, focus, layers and motion. Feature
code supplies content and domain actions through a small public Zero facade.

The user's supplied HTML/JavaScript **Modal System** reference defines the desired
anatomy and layouts. The subsequently supplied **Modal Motion Lab**, with the
user's explicit defaults and Rise fallback clarification, owns the motion
specification below and supersedes the first reference's entrance/exit/stack
defaults. Port those behaviors into Zero's existing
primitives and services; do not copy its hardcoded palette, fonts, standalone DOM
manager, hand-written focus trap or fake operations. Keep the current Zero theme
for now. A later theme redesign must restyle these components through tokens.

Include both approved service integrations: **reactive-record/draft awareness**
and **durable Torrent/workflow progress**. Neither should be compulsory for a
plain dialog, nor should the modal manager become a database or workflow engine.

Also include the reusable dense list demonstrated by the reference, hold-to-delete,
custom sizing/placement, scrollbar appearance, migration assistance, documentation
and public-package qualification. Changes to Pantheon or other consuming apps
require their own scoped implementation and verification; planning here does not
authorize live application changes or deployment.

## Source-Backed Starting Point

These findings determine the order of work. They are source observations, not
browser reproductions or claims that every similar consumer is defective.

| Area | Current implementation | Consequence for this plan |
| --- | --- | --- |
| Manager API | `modals.open({ content })` returns a string ID; `confirm` returns a boolean promise. Title is optional. | Introduce a structured API deliberately; never silently change the legacy return type. |
| Frame | Renderer lays arbitrary content inside a padded, scrolling container; close control is absolutely positioned. Title can be screen-reader-only. | Reserve a real header/control lane and make only the body scroll. |
| Close admission | Exact-instance close guards have abort signals, coalescing and stale-result checks. Store tracks exiting IDs. | Extend these contracts; do not replace them with a less safe demo implementation. |
| Layers | Each managed dialog has its own overlay/content at local `z-50`; manager adds a window Escape listener. | Coordinate dismissal and portal ownership before adding more nested helpers. |
| Other dialogs | Standalone Dialog, AlertDialog, ConfirmProvider and several organisms bypass the manager. | A new facade alone cannot standardize the whole library. Share the shell and migrate owned consumers. |
| Forms | `useForm`, `useFormSave` and FormSaveController already expose acknowledged submissions, draft preservation, Save/Discard/Stay and scope retirement. | Add an adapter to these controllers rather than another form engine. |
| Reactive conflicts | Forms carry `expectedRevision` to custom writers and recognize conflicts, but lack a live record/baseline reconciliation API. Generic collection writes do not automatically enforce that revision. | Add atomic canonical-value/revision adoption and require real backend compare-and-set support wherever conflict-safe editing is promised. |
| Torrent | Public workflow hooks already start/observe/control durable runs and expose separate root/fanout/delivery progress. | Compose those hooks; close is not cancellation and admission is not completion. |
| Lists | IntegrationSettingsList is domain-specific; SettingsMatrix is a boolean matrix; AnimatedList is timed presentation. | Add a small semantic dense-list composite, not a second integration service or a DataTable. |
| Doctor | Existing source audit is regex/line-based, with scoped roots/exclusions and configurable severities. | Add focused import/JSX analysis and installed-capability checks before claiming reliable migration detection. |

Primary source entry points:

- [Modal types](../../src/modals/modal.types.ts), [facade](../../src/modals/modal-events.ts),
  [store](../../src/modals/modal-store.ts), [close admission](../../src/modals/modal-close-admission.ts)
  and [renderer](../../src/modals/modal-manager.tsx).
- [Existing Radix dialog primitive](../../src/components/animate-ui/primitives/radix/dialog.tsx),
  [standalone wrapper](../../src/components/animate-ui/components/radix/dialog.tsx),
  [confirmation hook](../../src/hooks/use-confirm.tsx), and
  [unsaved-changes dialog](../../src/components/form-save/unsaved-changes-dialog.tsx).
- [Form hook](../../src/hooks/use-form.ts), [save hook](../../src/hooks/use-form-save.ts),
  [save controller](../../src/hooks/form-save-controller.ts),
  [submission types](../../src/hooks/form-save-types.ts),
  [collection facade](../../src/frontend/client/collection.ts), and
  [scope retirement](../../src/frontend/client/app-provider.tsx).
- [Workflow run hook](../../src/frontend/client/workflow-run-hooks.ts),
  [workflow observation/actions](../../src/frontend/client/workflow-hooks.ts),
  [workflow topology](../../src/frontend/client/workflow-topology-hooks.ts), and
  [managed platform services](../../src/frontend/server/app-platform-services.ts).
- [Doctor audit](../../src/doctor/usage-audit.ts), [discovery](../../src/doctor/usage-audit-scanner.ts),
  [rules](../../src/doctor/usage-audit-rules.ts), [options](../../src/doctor/usage-audit-types.ts),
  [frontend exports](../../src/frontend/index.ts), [package manifest](../../package.json), and
  [source-copy registry](../../src/add/registry.ts).

## Agreed Presentation And Interaction Contract

### Anatomy And Layouts

- A required visible title labels every standard modal. Optional tone-aware icon,
  short inline meta and description have designated slots. Header actions are
  bounded; they cannot displace the close control or cover content.
- The X glyph should be **slightly smaller than the current one**, not larger.
  Keep an adequate pointer/touch target independently of glyph size. A roughly
  14px glyph versus the current 16px is a starting proposal, not an approved exact
  token value. Use keyboard-only `focus-visible` treatment rather than a persistent
  mouse-click outline; never remove visible keyboard focus.
- Header and footer remain anchored. The body owns vertical scrolling. Long titles,
  descriptions, errors, fields and code must not push controls outside the viewport.
  Header/footer edge dividers may respond to the active scroller.
- Standard layouts: content/form, horizontal tabs, grouped vertical side navigation,
  long content, nested picker, decision dialog and full-screen editor. Tabbed layouts
  default to a stable fixed height; retain each panel's draft and scroll position.
- Footer helper text and safe action errors share a predictable start region.
  Secondary/cancel actions precede the primary action at the end. On narrow screens,
  notes and actions wrap deliberately and actions can fill the available width.
- Reference sizes are sm 420px, md 560px, lg 760px, xl 1000px and full viewport;
  reference fixed height 640px, gutter 32px, body padding 20px and nav width 212px.
  Express these as component tokens mapped to Zero's theme. Explicitly decide the
  compatibility mapping for today's `xs` and differently sized legacy presets.
- Support viewport-bounded custom width/height/max dimensions and center/left/right/
  bottom placement through the same lifecycle. On phones use a bottom sheet or
  full-screen policy, not an independent unmanaged drawer. Define safe-area and
  virtual-keyboard behavior using modern viewport sizing and resize handling.
- Separate scrollability from scrollbar appearance: auto/thin/hidden appearance,
  with independent body/nav settings where useful. Hidden bars still permit wheel,
  touch, keyboard and focus scrolling. Do not translate this to `overflow: hidden`.
- Provide an explicit managed-custom escape hatch. It still owns accessible naming,
  layer registration, lifecycle, scope retirement and results; customization must
  not silently bypass those guarantees. Ordinary consumers never assemble the frame.

### Dense List Composite

Use one reusable semantic list for members, settings, notification preferences,
integrations, shortcuts and picker choices. Support optional icon/avatar/leading
content, title, optional description, and a trailing slot for existing Zero controls.
No icon means no empty media column. Support groups, separators, compact/default
density and deliberate narrow-screen stacking or wrapping.

Use appropriate list/group semantics, with `min-width: 0` and bounded trailing
content. A row containing Select, Switch or Button must not itself be a button or
link containing those interactive children. A fully actionable picker row can have
a separate, correctly labeled single-action variant. The list owns layout, not
persistence, permissions, independent scrolling or integration action authority.

Reuse existing Avatar/presence presentation, Button, Badge, Select, Combobox,
Separator, Kbd and form primitives. Existing animated tab/switch primitives can
underpin public Zero variants; private `#zero` aliases are not an app-facing API.
IntegrationSettingsList may delegate row presentation while retaining its controller.
SettingsMatrix and existing domain lists remain appropriate for their own purposes.

### Motion And Theme Contract

All visual values use Zero's active semantic tokens: surfaces, text, borders, tone,
focus, spacing, typography, radii, shadows, dimensions and layers. Do not introduce
a second local color system. Preserve app/public theme-lane inheritance in portals.
Introduce modal CSS motion tokens and a matching typed runtime source of values,
using existing theme/motion infrastructure rather than unrelated magic numbers.
Table-specific durations remain unchanged; modal values may share common defaults
without making the modal depend on DataTable CSS being mounted.

#### Approved Motion Defaults And Available Options

These are proposed new-system defaults, not options already supported by the
current facade. A small validated preset/settings object is sufficient; ordinary
feature code should not write its own keyframes or animation lifecycle.

| Setting | Approved default | Available choices / meaning |
| --- | --- | --- |
| Entrance | From button (`origin` in the lab) | Rise, Grow, From button, Spring, Focus, Drop |
| Origin fallback | **Rise** | Applies whenever opening is not from a usable trigger; explicitly replaces the lab's Grow fallback |
| Exit | Reverse entrance (`mirror` in the lab) | The preset's tuned paired exit, or Quick fade; not a mathematical reversal of entry keyframes |
| Backdrop | Dim + blur | Dim, or dim + the reference's fixed 6px blur, using Zero's backdrop color token |
| Page recedes | Enabled | Enabled/disabled; safe registered app surface required |
| Duration multiplier | **1.5** | Finite 0.5–2.5; preview slider steps 0.25; 1 is the reference's base pace |

The lab calls this setting **Speed**, but computes `round(baseMs × multiplier)`:
larger means slower. Prefer an unambiguous public setting such as
`durationMultiplier`; documentation and preview must explain that 1.5 is longer,
not 1.5 times faster. The approved 975ms is `650 × 1.5`, not a replacement base
duration to be multiplied a second time. Public property/enum names remain subject
to Phase 0 contract freeze; the labels above preserve the requested behavior.

Scale all modal presentation durations/delays together: entrance, opacity, inner
content, exit, backdrop, recession/restore, stack and tab/nav transitions. The
existing layout reference's tab/nav base duration remains 350ms (525ms at the new
default), and optional required-step nudge remains 260ms base (390ms at default).
**Do not scale** 120ms control feedback, request/retry timers, validation/debounce,
workflow execution, or the real 1500ms hold-to-confirm safety interval. Durations
and easing overrides must remain finite, bounded and validated at admission.

#### Exact Preset Library

Preserve the tuned keyframes, separate opacity durations and curves at multiplier
1; derive the selected pace rather than substituting a generic spring preset.
All ordinary entrance fades use OUT, defined below. Exit fades/keyframes use their
specified curve. Transform distances and effect amounts are motion tokens, not
permission to transplant the lab's palette, font or control spacing.

| Preset | Entrance | Base enter / fade | Paired exit |
| --- | --- | --- | --- |
| Rise | `translateY(18px) scale(.98)` → none; SPRING | 600 / 260ms | Opacity 1→0, `translateY(10px) scale(.98)`; 260ms, IN |
| Grow | `scale(.86)` → none; OUT | 500 / 240ms | Opacity 1→0, `scale(.92)`; 240ms, IN |
| From button | Trigger-relative FLIP translation and independent X/Y scale → final dialog; SPRING | 650ms transform; 220ms content fade with details below | Return to usable trigger; 380ms, OUT; shorter concurrent inner-content fade |
| Spring | `scale(.72)` → none; BOUNCY | 700 / 200ms | Opacity 1→0, `scale(.9)`; 220ms, IN |
| Focus | `scale(1.06)` + `blur(12px)` → none + `blur(0px)`; SOFT | 560 / 300ms | Opacity 1→0, `scale(1.03)` + `blur(8px)`; 260ms, IN |
| Drop | `translateY(-36px)` → none; SPRING | 600 / 240ms | Opacity 1→0, `translateY(-16px)`; 240ms, IN |

Quick fade is an independent exit choice: opacity 1→0 and scale 1→.98 over
**180ms base**, OUT (270ms at default). Despite its label, it is not a pure fade.
It bypasses the fly-back exit without changing the selected entrance preset.

Curves must match the supplied reference:

- OUT: `cubic-bezier(.2,0,0,1)`.
- IN: `cubic-bezier(.4,0,1,1)`.
- SOFT: `cubic-bezier(.16,1,.3,1)`.
- SPRING and BOUNCY use the exact sampled `linear()` functions below when supported;
  their respective fallbacks are `cubic-bezier(.22,1.2,.36,1)` and
  `cubic-bezier(.34,1.56,.64,1)`. Do not substitute library physics approximations.

Exact curve values, reference data rather than a current public API:

```text
SPRING = linear(0, .0258, .09, .1763, .2732, .3724, .4683, .5573, .6376, .7082, .7689, .8202, .8628, .8976, .9256, .9476, .9648, .9778, .9875, .9945, .9994, 1.0026, 1.0047, 1.0058, 1.0062, 1.0062, 1.0059, 1.0055, 1.0049, 1.0043, 1.0036, 1.0031, 1.0025, 1.002, 1.0016, 1.0013, 1)
BOUNCY = linear(0, .133, .41, .697, .918, 1.05, 1.1, 1.091, 1.05, 1.006, .978, .968, .973, .986, .999, 1.006, 1.007, 1.004, 1.001, 1)
```

The identical SPRING curve and capability fallback already exist in
[calendar motion resolution](../../src/components/ui/calendar-motion.ts).
Reuse/promote an appropriately owned shared curve/resolver contract where useful;
do not make modal imports depend on a calendar component or its CSS, and do not
change existing calendar/table timings while doing this.

#### From-Button Geometry And Default Timing Breakdown

From button is a connection to the actual initiating control, not always the last
focused element. Accept an explicit trigger/ref/event-derived element through the
public contract; programmatic opens with no usable trigger use **Rise**. Require
connected, visible, finite, nonzero trigger and dialog bounds in the correct
document/ownership scope. An offscreen/hidden/disconnected trigger is not a safe
fly-in target. The default fallback is not Grow.

Use trigger and final-dialog center deltas plus independent width/height scale
ratios in a consistent viewport coordinate space. Separate position/centering,
stack transforms and shell motion so FLIP does not overwrite layout transforms.
Resolve radii through actual trigger/dialog theme tokens, not hardcoded lab 10/14px
values. Measurement must account for a receding app or moving parent layer.

| Default behavior | Base timing | At approved 1.5 multiplier |
| --- | --- | --- |
| From-button shell transform entrance | 650ms | **975ms** |
| Shell entrance opacity, OUT | 140ms | 210ms |
| Inner content entrance delay | 160ms | 240ms |
| Inner content entrance fade, OUT | 220ms | 330ms |
| From-button paired exit, OUT | 380ms | 570ms |
| Inner content exit fade, OUT | 120ms | 180ms |
| Rise fallback entrance / fade / exit | 600 / 260 / 260ms | **900 / 390 / 390ms** |
| Backdrop entrance / exit, linear | 320 / 260ms | 480 / 390ms |
| Page recedes / restores | 600 / 420ms | 900 / 630ms |
| Stack step-back, OUT | 450ms | 675ms |

During a from-button paired exit, start the inner-content fade and shell return
concurrently; the inner fade finishes first. Do not add an extra sequential delay.
The shell reaches the newly measured trigger transform at keyframe offset .85
with opacity .9, then completes the fade at the same target. Preserve this pacing.
Track both requested and resolved preset: a Rise fallback entrance gets Rise's
paired exit even if a trigger later appears. If an actual origin entrance loses
its trigger before closing, use Rise's exit, not stale geometry or Grow.

#### Shared Backdrop, Recession And Lifecycle Rules

- Backdrop opacity uses linear easing and the timings above; dim+blur keeps a
  tokenized 6px blur while fading. Unsupported `backdrop-filter` degrades to dim
  without breaking access or dismissal. Focus blur is an explicit preset option,
  not a mandatory effect on every modal; its filter fallback keeps transform/fade.
- Page recession uses scale **.965**, the reference origin **50% 30vh**, SPRING on
  entry and OUT on restore. Reference recession radius is 16px; express it through
  Zero's semantic/component radius token rather than copying a separate visual
  theme. Preserve existing surface styles and scroll position exactly on cleanup.
- Register a dedicated recede surface in normal host/AppProvider composition,
  outside modal/floating portal hosts. Do not blindly transform `body` or the whole
  app/portal root: that changes fixed/sticky containing blocks and can trap overlays.
  A custom/plain host without a safe surface keeps functional dialogs and dim/blur;
  missing recession support is a documented graceful no-op, not a failed open.
- Recession is applied once to the page, not compounded for nested dialogs. Stack
  layers retain -12px translation and .04 scale reduction per depth, with the
  updated **450ms base** transition. Bound depth to sensible geometry.
- One host coordinates shared effects and leases. Per-dialog motion overrides do
  not independently own app transforms/backdrops: resolve backdrop through the
  active modal; keep recession while any admitted owner requests it, and restore
  only after the last relevant owner releases. Closing a child restores the parent's
  backdrop policy without flicker or clearing its scroll lock/inert protection.
- Freeze each admitted modal's resolved motion profile by default, with documented
  provider/theme/call precedence. Configuration changes affect subsequent instances;
  explicit updates can retarget an instance from current visual state, not replay
  its entrance. Live reduced-motion preference always overrides that snapshot.
- On rapid close/reopen/update, read the current transform/opacity/filter before
  cancelling all owned shell/inner/backdrop/page animations. Do not start exits at
  an assumed fully entered state. A closed modal's completion cannot remove newer
  layers, restore stale focus, restore a newly receding app or clear a new page lock.
- Coordinate complete visual cleanup, not just the shell animation. Default page
  restore is 630ms, longer than the 570ms origin exit; define effect reservations
  and interaction-unlock order without delaying action/result acceptance needlessly.
  Retirement/unmount/reduced motion must clean up even if animation callbacks never
  arrive. Avoid permanent `will-change` on the entire app surface.
- Entrance duration is visual presentation, not an artificial request/interaction
  delay. Mount the accessible content and begin admitted domain actions promptly;
  do not wait 975ms before the modal can validate, receive focus or start work.
- Reduced motion settles presentation essentially instantly (about 1ms), suppressing
  origin travel, overshoot, blur/recession motion and prolonged fades. Observe it
  live; do **not** port the lab's reduced entrance that still fades for 150ms.
  Static dimming and necessary focus/inert/layer behavior remain intact.
- Side/bottom/full/mobile presentation must retain its viewport and scroll contract.
  Phase 0 must specify how the six presets compose with explicit sheet/placement
  motion, so no competing transforms or silently different default desktop profile
  remain. Earlier layout-reference sheet timings are 350/260ms base; if used, apply
  the same multiplier. The latest lab does not replace the earlier mobile layout
  with its centered preview. Keep legacy 3D flip only behind deliberate compatibility.

Blur/filter and radius effects here are intentional modal options. They do not
relax the DataTable's separately specified transform/opacity-only row movement.
Preserve the existing accessibility/action protections, including safe Cancel
focus on destructive decisions; do not copy the lab's delete-button autofocus,
global key listeners, fake writes, clipboard fallback or manual focus trap.

## Ownership And API Decisions

Separate responsibilities instead of putting every behavior into one renderer:

| Responsibility | Owner |
| --- | --- |
| IDs, parent/child graph, close admission, result settlement, exit reservation | Existing modal store/facade evolved into the manager kernel |
| Header/body/footer/tabs/nav, responsive geometry, tone, motion | Shared tokenized shell and layout components |
| Focus trap, accessible dialog semantics, floating-control mechanics | Existing Radix/Zero primitives coordinated through overlay ownership |
| Validation, dirty state, acknowledged baseline, Save/Discard/Stay | Existing form/save controllers via an adapter |
| Revision checks and authorized writes | Supplied domain service/backend, never presentation code |
| Workflow persistence, execution, retries and cancellation | Existing Torrent service; UI observes/actions through public hooks |
| Safe messages, logs and notifications | Existing Zero error/observability/toast conventions |
| App migration diagnosis | Doctor's existing findings/report pipeline with focused analysis additions |

Phase 0 must freeze public contracts before downstream work. Recommended direction:

- Keep legacy `modals.open(...): string` during a documented compatibility window.
  Add a clearly named structured entry point returning an exact-ID typed handle and
  result promise, or make a deliberate versioned breaking change. Do not overload
  the same call into subtly different runtime return types. New method/type names
  are intentionally not published as runnable APIs in this plan.
  A legacy caller supplying its own heading/frame must not silently receive a
  second header. Retained legacy rendering is a migration boundary, not proof
  that its arbitrary content satisfies the new standardized layout contract.
- Model mutually exclusive layouts with discriminated types: ordinary body versus
  tab/nav sections, with shared shell options. Make required title and legal option
  combinations visible to TypeScript and runtime admission.
- Distinguish accepted, dismissed and scope-retired outcomes for the new result
  contract. Define whether the result settles at logical completion or after exit
  cleanup; preserve legacy boolean confirmations. Settle every waiter exactly once.
- Separate decision-only confirmation from an action-backed confirmation that
  awaits acknowledged work. Alert, prompt, form, picker, required-step and progress
  helpers should compose the same descriptor/shell rather than each build a modal.
- Define close reasons and sources, action IDs, pending policy, parent identity,
  initial/return focus, programmatic close/update, cancellation and disposal.
  `close`, user dismissal and authoritative retirement are not interchangeable.
- App defaults belong to the manager/provider and theme; calls can override safe
  presentation choices. There is no current modal-defaults/layer-policy AppConfig
  contract. Do not invent one as an existing feature. Keep future declarative
  configuration evolution separate and avoid arbitrary deep merges of callbacks.
- Preserve controlled component use where an organism owns state. Provide an
  adapter to the same kernel/shell; do not force all domain state into a global store
  or mount a competing manager for standalone confirmations.

## Dependency-Ordered Execution Plan

Work through these phases in order. Each begins with a fresh source check and ends
with a concrete verification gate. Update this plan when a prerequisite changes;
do not mark a phase complete merely because its files or API types exist.
Independent presentation/tooling work can be parallelized after shared contracts
are frozen, but lifecycle-dependent integrations cannot skip the earlier gates.

### Phase 0 — Inventory, Compatibility And Contract Freeze

1. Inventory manager calls, standalone Dialog/AlertDialog, ConfirmProvider,
   UnsavedChangesDialog and source-copied app patterns. Classify normal frame,
   nested flow, complex controlled editor and managed-custom cases. Audit multiple
   hosts, provider ownership and SSR behavior before choosing host admission.
2. Capture current ID, close, update, confirm and scope-retirement guarantees in
   regression tests. Retain existing exact-instance stale-handler protection.
3. Decide structured facade/result semantics, legacy support/deprecation, `xs`,
   size/motion changes, controlled adapters, default placement and custom limits.
   Prototype public types against representative content/form/tab/confirm callers.
   Include motion defaults/overrides and trigger binding: From button with Rise
   fallback, paired/quick-fade exit, dim/blur, recession and duration multiplier.
   Freeze validation, provider/theme/call precedence, snapshot/update policy and
   sheet/side-placement composition rather than leaving these to individual callers.
4. Define the overlay ownership interface before shell/portal work: active modal,
   parent, floating branches, target container, theme context and exit reservation.
5. Record API decisions, unsupported option combinations and migration categories
   here before authoring the public guide or implementing consumers.
   Record existing documentation drift separately: guarded `closeAll` is not always
   immediate, and today's custom overflow applies to the whole dialog, not only
   the body. Correct current-contract descriptions without presenting the future
   shell as already shipped.

**Gate:** contract fixtures compile through intended public imports; compatibility
tests specify unchanged legacy behavior and deliberate changes. Existing callers
have a migration classification. No application is silently promised compatibility.

### Phase 1 — Lifecycle, Stacking, Focus And Owned Portals

1. Evolve modal types/store/events/close admission to support typed results,
   parent-child ownership and close reasons. Coalesce repeated close requests;
   replacement, unmount and retirement cancel obsolete decisions and settle waiters.
   Awaited actions must close their exact owned ID, never whichever dialog happens
   to be last when the operation finishes.
2. Register managed and controlled dialogs in one coordinated overlay policy.
   Retain Radix accessibility; reconcile its dismissable-layer/focus behavior with
   manager ordering instead of adding a second document-level focus trap.
3. Route Escape through the topmost eligible interaction. A date-picker/month view,
   select/menu or unsaved-decision child can consume Escape without also closing its
   parent. Remove/replace the independent window Escape handling where it conflicts.
4. Keep lower modals mounted but inert to interaction, with reference step-back
   motion. Implement one coordinated backdrop just under the active modal without
   breaking focus traps, outside detection or scroll locking. A pointer drag that
   began inside must not become an outside-click dismissal.
   Establish a safe recede-surface registration and shared-effect leases alongside
   portal ownership. AppProvider currently mounts the manager around guarded
   children but does not expose a recession surface contract; add this seam
   deliberately without transforming the modal/portal hosts or breaking AppShell
   fixed/sticky geometry. Parent/child overrides cannot independently reset the page.
5. Reserve layers through exit cleanup. New opens during old exits cannot inherit
   stale focus restoration, reuse occupied layers or prematurely unlock the page.
   Closing a parent settles/cleans its owned children in a defined order.
6. Coordinate Popover, DatePicker, Select/Combobox, DropdownMenu and Tooltip portal
   containers/branches. Own their focus and dismissal context without clipping them
   inside the body's overflow region. Respect theme lanes and custom containers;
   document unsupported shadow-root/iframe ownership rather than guessing.
   The convenient PopoverContent wrapper currently creates its own portal without
   a container seam. Add the necessary shared public/internal hook points and verify
   that required Radix dismissal/focus handlers reach the primitive. Preserve
   collision boundaries/padding and defer measurement until the real scroll-owner
   portal mounts; do not initialize a virtualizer against a missing container.
7. Preserve AppProvider's synchronous scope discard. Authoritative auth/org/scope
   retirement overrides required/busy/dirty advisory guards, suppresses stale
   callbacks and prevents late cross-scope success UI. UI closure does not assert
   that an already submitted server operation was rolled back.
8. Keep a plain manager usable without Guardian, router, Fabric or Torrent. Guard
   browser-only global calls and make SSR/import behavior and duplicate-host
   admission explicit; never leak mutable dialog state between server requests.

**Gate:** focused lifecycle tests cover close/update races, nested results, host
unmount, retirement, duplicate close, parent close and reopen-during-exit. Styled
browser fixtures prove top-only Escape, pointer boundaries, focus return, shared
backdrop, scroll lock and floating children above the correct dialog.

### Phase 2 — Tokenized Shell, Layouts And Dense List

1. Implement shared header/icon/title/meta/description/actions, body, footer/error
   slots, smaller X glyph and keyboard-focus styling. Neither arbitrary feature
   content nor omitted slots can cover the close-control lane.
2. Implement all standard size/placement/custom-dimension rules, body-only scroll,
   auto/fixed/full height, safe areas, mobile sheets and scrollbar appearances.
   Clamp custom sizing to usable viewport bounds; nested flex/grid chains need
   `min-height: 0` and `min-width: 0`, not arbitrary per-consumer padding fixes.
3. Compose horizontal and grouped vertical tabs with existing navigation primitives,
   explicit public presentation variants and tokens. Provide tab labels/icons/counts,
   keyboard arrows/Home/End, appropriate orientation on phones, bounded overflow,
   visible active indicator and retained per-panel draft/scroll state.
4. Add the dense-list composite, its public facade, responsive variants and tests.
   Reuse existing widgets and avatar/presence decoration without coupling the list
   to profile provisioning or notification/integration persistence.
5. Implement the [Motion Lab contract](#motion-and-theme-contract) as component
   tokens and typed runtime values: six presets, paired or quick-fade exit,
   dim/blur, optional recession and validated duration multiplier. Use the approved
   From-button/Rise fallback, 1.5 default multiplier and exact sampled curves.
   Add capability fallbacks, shared effect cleanup and live reduced-motion handling;
   capture the current visual state before interrupting. No global palette, font
   or DataTable/calendar timing changes are part of this phase.

**Gate:** reference cases fit at 320px and desktop, light/dark and relevant theme
lanes, long text/code/errors and virtual-keyboard viewport changes. Header/footer
stay put, body/nav scroll correctly, hidden bars still scroll, panel state persists,
and a list row's nested controls remain independently accessible. Pure tests
verify every preset/duration/delay, exact curve values, multiplier bounds and CSS/
runtime token parity. Styled fixtures cover default 975ms origin and 900ms Rise
fallback, programmatic opens, lost/hidden triggers, rapid mid-entrance close,
mixed-preset stacks, resize/scroll and long page-restore cleanup. Qualify mobile
blur/recession cost and unsupported `linear()`/`backdrop-filter` behavior; preserve
styles, scroll, focus and locks through newer opens and live reduced-motion changes.

### Phase 3 — Forms, Actions, Confirmation And Save Guards

1. Bind structured form dialogs to `useForm`/`useFormSave` state, not a global DOM
   `input` listener. Dirty state means comparison to an acknowledged baseline;
   returning a field to its original value must clear the dirty condition.
2. Submit through the existing controller/native form contract. Preserve schema
   validation and focus the first invalid field. Enter must respect multiline,
   IME composition and combobox/date-picker selection; never invoke
   a primary action merely because a document key listener sees Enter.
   Footer submit buttons target their exact owned form. Do not nest native `form`
   elements, and contain child-dialog submissions so React portal event bubbling
   cannot trigger the parent form's writer.
3. Close an action-backed form only on an accepted submission with no newer dirty
   draft, while still mounted in the originating scope. Failed/invalid/conflicted/
   blocked/retired outcomes are not success. Legacy `handleSubmit(): void` is not
   an acknowledgment. Do not stack a second mutation wrapper around an existing
   controller in a way that changes its settlement or invokes work twice.
4. Connect manager `beforeClose(signal)` to Save/Discard/Stay and router guards.
   FormSaveController's current `requestLeave` does not accept that signal. Add a
   narrowly owned cancellation bridge/controller extension so aborted modal-close
   admission cannot leave a pending continuation or decision dialog stranded. A
   `Promise.race` that leaves the original form decision active is not sufficient.
   Cancel the exact leave attempt, settle it false and hide its prompt; separately
   admitted in-flight save acceptance can still update a current mounted form's
   baseline, but cannot run the cancelled leave continuation.
   Keep native tab unload browser-managed; it cannot run an asynchronous custom modal.
5. Admit actions synchronously before calling them, not after React paints pending
   state. Prevent double submission and coordinate footer/X/body/tab controls with
   an explicit pending policy. A permitted edit-during-save policy must preserve
   newer edits; it must not close the dialog on the older accepted snapshot.
6. Present validation/conflict/permission/transport errors via existing safe error
   conventions. Do not display arbitrary exception text. Use stable diagnostics,
   operation metadata and Zero observability without logging form values, credentials
   or record bodies. An optional success toast follows acceptance; toast/callback
   failure cannot relabel an accepted write as failed or invite a duplicate retry.
7. Build confirm/alert/prompt/picker/required-step helpers on the same shell. Keep
   decision-only boolean confirm for compatibility and clearly separate it from
   an action-backed destructive confirmation. Preserve HoldButton's default 1500ms,
   keyboard/pointer cancellation and safe Cancel initial focus. Optional typed-name
   confirmation is a useful additional high-risk preset, not required for all deletes.
8. Adapt ConfirmProvider/useConfirm and UnsavedChangesDialog to the coordinated
   shell/lifecycle. Preserve current replacement/unmount=false behavior, exact-request
   settlement and stale-focus safety; do not quietly turn a single-request helper
   into a queue or leave it outside scope retirement. Share presentation first,
   then introduce any exact-ID provider-owned manager adapter; directly aliasing
   `useConfirm` to stack-based `modals.confirm` would change its semantics.

**Gate:** validation, dirty→clean, accepted save, accepted save with newer edits,
save failure/conflict, repeated clicks, pending close, guard cancellation, router
leave, scope change, unmount and post-acceptance callback failure are tested.
Nested Save/Discard/Stay and held-delete work without stealing focus or bypassing
the acknowledged writer; a child form submit invokes only its child writer once.
Confirmed side effects occur exactly once per admitted
UI action; domain idempotency remains the server's responsibility.

### Phase 4 — Reactive Record And Draft Awareness

1. Define a small adapter carrying domain record identity, authorized scope,
   authoritative revision/read state and accepted values. Consume existing reactive
   hooks/controllers; the manager must not guess SQL, tables or subscriptions.
   Today's `useForm` does not subscribe to record changes/late lazy hydration, and
   `reset()` cannot install replacement values/revision. Introduce an explicit
   atomic load/reconciliation seam for canonical values, revision and dirty baseline;
   chaining `setValue` and `reset` would retain or manufacture the wrong baseline.
2. Track the draft's accepted baseline separately from incoming live data. A newer
   authoritative revision while dirty produces a changed-elsewhere state without
   overwriting the draft. Identify local pending mutation echoes so they are not
   mistaken for external authoritative acceptance or a competing update.
3. When pristine, apply admitted latest values through an explicit baseline-update
   path. When dirty, provide review/latest comparison and deliberate reload/discard
   choices. Reload must guard draft loss. Saving stale edits keeps the expected
   baseline revision and receives a real conflict rather than silent last-write-wins.
4. Reuse form submission revision/conflict handling and domain CAS writers. Generic
   `collection.updateAsync` acknowledges persistence but does not by itself supply
   this CAS contract. For a domain lacking revisions, document awareness-only mode
   or add the supported backend prerequisite before claiming conflict-safe saves.
   Existing revision-bearing domain routes include Data Studio `replaceRow` and
   profile `auth.profile.update`; use their authority and canonical receipts.
   Review the collection-backed submit path's current lack of signal forwarding
   before exposing cancellation as supported there. Transport abort remains
   advisory and does not prove the remote operation failed.
5. Handle deleted/inaccessible records, permission changes, reconnect/snapshot
   replacement and scope retirement. Missing local data alone is not proof of
   deletion. Avoid duplicate subscriptions and broad all-tenant record access.
6. Do not implement automatic multi-field merge/rebase. Compare/review is optional
   presentation; only the domain can define a safe merge. An explicit later merge
   must remain conditional on an authoritative revision and permitted fields.

**Gate:** two-client fixtures prove clean refresh, preserved dirty draft, real stale
revision conflict, accepted local echo, reload safety, deletion/inaccessibility,
reconnect and org-switch fencing. Test both supported normal Reactive DB and
Fabric contexts using their existing admission paths; do not add modal-owned DBs.

### Phase 5 — Torrent And Long-Running Progress

1. Compose public `useWorkflowRun`, `useWorkflow` and workflow actions over an
   explicitly supplied owned run identity. Reuse Torrent persistence, authorization,
   subscriptions and progress. Ordinary saves must not start a workflow by default.
2. Distinguish not started/admitting/accepted run ID from durable run states: running,
   pending, paused, completed, failed and cancelled. Waiting/awaiting input, retrying
   and parallel activity are derived from steps/interactions, not new persisted run
   statuses. A successful start request is not completed work. A rejected interaction
   response is not success.
3. Preserve existing separate root-node, fanout-item and interaction-delivery
   progress. Do not inflate the stable root denominator with dynamic children or
   invent a smooth 0–100% percentage from unrelated events. Use indeterminate progress
   until real progress is available and show an honest terminal outcome. A zero-root
   run is indeterminate, and failed/cancelled status wins even if counts show 100%.
4. Close the current readiness gap in a shared observation adapter/hook: loading,
   authoritative missing/inaccessible, reconnecting/offline and known status must
   not all look like `instance === null`. Connected transport alone does not prove
   the run snapshot is hydrated. Add only the minimum backend/read projection needed
   if the existing sync readiness contract cannot provide an authoritative answer.
   Workflow read policy intentionally conflates forbidden and nonexistent runs as
   unavailable. Preserve that privacy boundary: do not promise separate forbidden/
   deleted diagnoses from the same 404 or missing local row.
5. Separate UI dismissal from server cancel. Allow a durable run to continue in
   background and reopen its progress with the admitted run ID. Show Cancel/Pause/
   Resume/respond only when the supplied capability/state permits the actual action;
   await its server acknowledgment and then observe durable state. Cancellation
   is not a guarantee that external effects were undone.
   Retain the run ID in a scoped controller/route for reopening; an unmounted
   hook's local selection is not durable UI ownership. An externally controlled
   `instanceId` remains authoritative over the hook's local selection.
6. Do not auto-repeat ambiguous starts/actions after a lost response. Current start
   facade is not a generic idempotency/admission-reconciliation contract. Retain an
   operation/run receipt for reconciliation where available; if robust retry is
   required, add domain/Torrent idempotent admission before enabling it in the UI.
7. Run action-pending is different from a run being long-lived. Do not lock the
   entire UI for a background workflow. Scope changes retire old UI and stale
   callbacks without implicitly cancelling the old durable run.

**Gate:** real service-backed fixtures cover accepted start versus completion,
waiting/rejected input, root/fanout progress, pause/resume/cancel acknowledgment,
terminal failure, reconnect, ambiguous admission, dismiss/reopen and scope change.
No duplicate workflow runner, fake demo timers or unsupported cancellation claim.

### Phase 6 — Existing Consumers, Public Distribution And Doctor

1. Migrate manager confirms and shared form guards, then Zero-owned content dialogs:
   Data Studio row/table/confirmation editors, avatar crop, profile contact/security,
   user/admin/invitation flows, storage name/provision/action flows, CRUD and table
   confirmations. Keep their existing domain controllers, validators and writers.
   Audit CommandDialog and other special overlays separately; sharing layer ownership
   does not mean forcing a command palette into an ordinary form layout.
2. Publish only deliberate facade/types/components through the frontend/hooks/modal
   barrels and supported package exports. Assess Tabs/Switch/list facade needs. Where
   source copying is supported, update the add registry and copied dependencies.
   Wildcard export reachability is not the same as a curated supported public API.
3. Add focused import/JSX analysis alongside Doctor's current audit. Resolve aliases,
   namespace imports and statically known app-owned wrappers/reexports; opaque wrappers
   and dynamic spreads remain unknown. Select/package a parser explicitly: TypeScript
   is currently a dev dependency and Bun import scanning alone does not analyze JSX
   layout. Do not presume an installed app has the framework's compiler dependencies.
4. Inspect the target application's installed Zero version/exports/capabilities,
   using a read-only responsibility rather than importing the updater orchestrator.
   Recommend only APIs present in that release. Inspect files, not executable app
   config, environment, plugins or application modules, for migration analysis.
   Provide an explicit source-only entry point/CLI path for that analysis, with its
   own project/source-root inputs. Ordinary Doctor's trusted configuration-loading
   path does evaluate application/resource imports; do not relabel it non-executing
   or weaken its existing configuration checks to obtain a static migration scan.
5. Preserve canonical project-root checks, symlink aliases, exclusions and code/path
   exemptions. Account for explicitly configured external/custom source roots rather
   than assuming every frontend file starts with `app/` or `components/`.
6. Report required/recommended/manual-review migration categories with file/line and
   confidence/limitations through existing findings/report conventions. High-confidence
   illegal public imports or static incompatible props can be errors; recognizable
   copied frames/direct custom modal infrastructure can be warnings; suggested list
   reuse is informational. Unknown structure is not a failure or proof of compliance.
   Current findings have no dedicated confidence/line fields. Introduce any added
   metadata compatibly, choosing typed additive report fields or deliberate text
   annotations, and test human/JSON consumers. Account for existing strict
   mode, where warnings also fail; roll out heuristic recommendations deliberately
   rather than unexpectedly blocking previously valid applications.
   Include statically provable invalid motion settings/trigger bindings and old
   `from`/custom-animation migration hints only for installed APIs with a known
   contract. Static analysis cannot prove a trigger is usable at animation time.
7. Detect legacy/copy/private-import patterns and provable accessible/interactive
   structure problems, with version-aware migration hints. A static audit cannot
   prove responsive geometry, portal/focus behavior or accepted save semantics.
   Never advertise a heuristic no-findings result as visual qualification.
8. If codemods are later provided, restrict them to proven mechanical transformations,
   preview diffs and preserve custom callbacks/save logic. Do not auto-rewrite complex
   forms or destructive operations. Retain an explicit managed-custom exception path.

**Gate:** fixtures cover older/current installed packages, missing exports, wildcard
paths, comments/strings, multiline/alias syntax, parse failure, dynamic props, wrapper
uncertainty, custom roots, symlinks and exceptions. No config execution or data access
is needed by static migration analysis. Representative migrated dialogs compile and
run through the public packed package, not only checkout-local aliases.

### Phase 7 — Documentation, Examples And Agent Guidance

1. Professionally rewrite the modal documentation family in `docs-next`, not a
   small property-list append to the old guides. Provide a concise introduction,
   clear terminology, readable anatomy/layout illustrations where useful, task-led
   recipes and detailed reference pages for the new configuration and lifecycle.
   Cover layering/portals, action/results, hold confirmation, forms, reactive records
   and workflow progress. Keep Guardian authority and Torrent execution semantics
   in their existing homes; link rather than duplicate those contracts. Follow the
   new track's documentation standards, evidence, indexes/backlinks and authoring
   checks; professionally polished prose must still describe actual shipped behavior.
2. Give every new public list/tab/switch/helper its component or hook documentation
   home, public types, defaults, limits, accessible behavior and complete examples.
   Do not publish a proposed method as supported before the corresponding gate passes.
3. Add a migration guide covering legacy string IDs, preset/motion changes, copied
   frames, ConfirmProvider, controlled dialogs, required title and custom escape
   hatches. Include Doctor's detectable versus manual-review cases and exemptions.
4. Provide reference-equivalent runnable examples: validated invite form, members/
   notifications/integrations tabs using the dense list, grouped preferences nav,
   long content, nested picker, confirm/hold/prompt/required step, reactive conflict
   and durable progress. Use actual acknowledged adapters, not simulated save success.
   Add a dedicated motion/defaults guide and complete public-import examples for
   all six presets, From-button binding, programmatic Rise fallback, speed/duration
   semantics, exit/backdrop/recession choices, precedence and accessibility.
   Include a clear 1×/1.5× timing comparison and unsupported-capability/custom-host
   behavior. A Motion Lab-style interactive preview can demonstrate these choices
   in docs/developer examples; it is not a mandatory production settings panel or
   a second modal manager. Separate legacy API examples from the new contract.
5. Update indexes, source ownership/public catalogs, Doctor docs, scaffold README
   and package-mode recipes. Keep `docs/start-here.md`, `llm.txt`/`llms.txt` and agent
   orientation pointed at supported `docs-next` guides. A concise scaffold agent
   instruction file may be added deliberately; none is currently shipped as an
   installed agent hook, and this plan does not invent one as current behavior.
6. Keep this internal plan out of public docs search/reader projections. Update the
   owning roadmap and release/upgrade notes only with evidence-backed completion.

**Gate:** actual public-import examples compile; metadata/navigation/catalog checks
pass; new API homes, dependencies, capabilities and migration steps are discoverable
without this conversation. Package-local docs and consumer instructions agree.

### Phase 8 — Independent Review, Qualification And Release Handoff

1. Review component/controller responsibility, scope/error/logging conventions,
   public imports, optional-service composition and migration completeness against
   the phase gates. Fix confirmed gaps rather than papering over individual apps.
2. Run focused pure/store/controller tests, package typechecks, packed-consumer tests,
   source-copy/Doctor fixtures and the relevant styled browser suite. These changes
   do affect layout, focus and portals; unlike a backend-only change, browser evidence
   is necessary for those specific behaviors, not an indiscriminate whole-app crawl.
3. Stress repeated open/close/update, child popups and nested decisions during pending
   writes, scope changes, exit animations and reduced-motion toggles. Prove all result
   promises settle, no page lock/layer leaks remain and no stale focus/action survives.
4. Review the packed distribution and migration examples against the intended source
   revision. Record actual test counts/failures, artifact identity and unresolved limits;
   source-observed planning is not package/release qualification.
5. Prepare a documented compatibility window/version decision, rollback guidance and
   representative consuming-app upgrade checklist. Commit/merge/publish only within
   the authorized release workflow after qualification; do not silently deploy apps.

**Gate:** all agreed requirements below have evidence, independent review findings
are resolved or explicitly excluded, and the release/migration handoff is coherent.

## Verification Matrix

| Contract | Required evidence |
| --- | --- |
| Standard shell and small close glyph | All reference layouts; title/meta/actions and long content never overlap X; mouse versus keyboard focus |
| Viewport and custom layouts | 320px through desktop, sheets/full/custom/side placement, safe areas, resize/keyboard, hidden/thin bars |
| Keyboard/accessibility | Named dialogs, appropriate alert role, initial/return focus, Tab/Shift+Tab, tabs, popup Escape, hold/IME/multiline |
| Modal lifecycle | Exact-ID result, replacement/unmount, nested and parent close, coalesced guards, force retirement, open during exit |
| Layers/portals | Modal+date/select/menu/tooltip and modal+child modal, themed/custom containers, scroll lock, inside→outside drag |
| Forms/actions | Real acceptance, invalid/conflict/transport failures, duplicate clicks, newer dirty edits, Save/Discard/Stay abort and router guards |
| Reactive records | External revision, local pending echo, pristine refresh, draft preservation, CAS enforcement, delete/access loss/reconnect/Fabric |
| Torrent | Accepted admission, waiting/retry/input, true progress, terminal/cancel state, dismiss/reopen, unknown readiness, ambiguous reply |
| Theme/motion | Six exact presets/curves, approved 975ms origin or 900ms Rise fallback, duration bounds/precedence, paired/quick exits, blur/recession/stack ownership, capability fallbacks, live reduced motion, unchanged table/calendar timings |
| Distribution/migration | Public archive imports, no private alias dependence, copied-source consumers, old API adapter, Doctor version/analysis limits |

## Working-Source Execution Ledger — 2026-10-08

Observed against dirty 2.6.0 source at baseline
`1b5a1fa0281deba69b3809471d2467d596516e4b`. The following checks qualify
specific working-source contracts, not a released artifact or every consuming app.

- [x] Exact Motion Lab CSS/TS constants, curves, timings and configuration admission.
  Approved origin975/Rise900 defaults, paired/quick exits, capability fallbacks,
  trigger geometry, interrupted visual continuation, reduced preference and
  unscaled hold safety remain covered by the pure motion suite.
- [x] Motion/scene suite: **24 passing tests / 165 assertions**. Added host-derived
  recession with a non-receding top modal, interrupted origin base geometry, and
  settled normal close → reduced open/close → restored full timing.
  A real browser-discovered scene leak was fixed: cancelled Animation.finished
  resets to an idle pending promise; clear cancelled retained handles before
  forming a new scene settlement when there is no replacement surface effect.
- [x] Isolated full-style Chromium presentation: **5 passing tests / 108 assertions**
  in `src/modals/modal-presentation.browser.test.ts`. Desktop/mobile custom,
  left/right/full bounds, explicit portal root, hidden/thin scroll, live
  platform/public/dark tokens through owned popup, lane-only platform → public →
  platform changes without a simultaneous light/dark class change, six exact WAAPI entrance
  timings/settled geometry, and live reduced programmatic close/restore pass.
  Uses synthetic data only, Bun's no-env build, compiled platform styles and
  Code Bank scratch/artifacts. The in-app browser connector failed before
  connection; the existing isolated repository harness supplied this evidence.
  Root's final combined manager/presentation run reports **12 passing tests /
  146 assertions**, including sibling owning-host retirement and specialized
  CommandDialog branch/container/theme/layer/Escape handling. Sibling teardown
  retires captured openings; it never silently remounts a live form/writer.
- [x] Source-only Doctor is implemented separately from config-backed Doctor.
  AST/location/category/confidence, installed-capability-aware advice,
  canonical roots, symlinks, excludes and exemptions have focused fixtures;
  no app config/env/plugin/database execution occurs in the static entry point.
  Ordinary Doctor still evaluates trusted configuration. Static findings cannot
  establish visual correctness, full wrapper/dataflow semantics or accepted writes.
  **36 passing tests / 107 assertions across six files** cover new static
  fixtures and unchanged configuration-backed usage/root semantics. The latter
  deliberately execute synthetic trusted config fixtures, not real app config.
- [x] Professional documentation family rewritten and indexed, with canonical
  forms/record/workflow ownership, complete public-import examples, DenseList,
  Switch/Tabs facades, prompt, exact default timings and migration guidance.
  Agent/Start Here/discovery guidance points at the new documentation.
- [x] Navigation/metadata check: **747 pages / 747 unique IDs / 747 reachable**,
  no problems. Named-symbol placement: **1,019 records / 173 homes**, no problems.
- [x] Current public-source example compiler: **13 actual snippets / 14 assertions**,
  no diagnostics after concurrent CRUD writer types stabilized. This is a
  source-only compiler gate, not execution of a domain writer or installed archive.
- [x] Zero-owned consumers migrated to the shared shell, with CommandDialog's
  deliberately specialized owned composition preserved. CRUD and profile actions
  await domain acknowledgments; synchronous/asynchronous notification failures
  cannot relabel or replay an accepted write. Existing backend authority remains
  authoritative, and generic collection adapters do not fabricate CAS support.
- [x] Final kernel/form/record/workflow regression set: **162 tests / 853 assertions**.
  Final styled manager/confirmation/password/form-save set: **29 tests / 127 assertions**.
  Additional profile, CRUD, Data Studio and domain checks are recorded in the
  [independent review](./modal-system-review.md), not counted twice here.
- [x] Final fresh installed archive and copied-source consumer: **1 test / 24 assertions**,
  including browser build, DOM-free SSR, public exports, consumer TypeScript and
  source-only Doctor. Full repository TypeScript and whitespace checks pass.
- [x] Independent review's confirmed lifecycle, notification, theme, secret-paint,
  capability-analysis, source-copy and A→B→A ownership defects corrected with
  matching regression evidence. Implementation and bounded qualification are complete.
- [ ] Publish/version/merge/deploy through a separately authorized release workflow.
  This ledger is not a claim that Pantheon or another consuming app was upgraded.

CommandDialog is a deliberate separate compatibility composition: hidden
accessible naming and cmdk search/results, not a normal visible form header.
Its own contracts must be audited independently; a direct-primitive Doctor
warning is a manual-review prompt rather than an instruction to auto-rewrite it.
Reference links: [motion](../frontend/modals/motion.md),
[migration](../frontend/modals/migration.md),
[source-only Doctor](../cli/doctor/source-audit.md).

## Completion Checklist And Boundaries

- [x] Phase 0 contracts and compatibility decisions recorded against current source.
- [x] One coordinated manager lifecycle; shared shell for managed and controlled dialogs.
- [x] Header/X/footer/body/tabs/nav/placement/custom sizing verified against the reference.
- [x] Smaller X glyph and accessible focus/hit targets; no close-control overlap.
- [x] Dense list composed from existing Zero primitives with responsive semantics.
- [x] Owned floating portals and nested modal stack verified; no independent Escape race.
- [x] Tokenized reference motion, scrolling and supported viewport behavior verified.
- [x] Six motion presets and configurable exits/backdrop/recession/pace verified;
  default From button falls back to Rise, 1.5 scales presentation but not safety timers.
- [x] Acknowledged form actions, guards, hold confirmation and stale-scope retirement verified.
- [x] Reactive-record awareness includes an honest revision/CAS/readiness contract.
- [x] Torrent progress includes honest admission/readiness/cancel/background semantics.
- [x] Zero consumers migrated; compatibility adapter, Doctor hints and public exports qualified.
- [x] Documentation, runnable examples, scaffold and agent entrances updated.
- [x] Professionally rewritten modal docs in the new track explain the full API,
  layouts/integrations, exact motion defaults/options and consuming-app migration.
- [x] Independent review and relevant tests pass; no published release is claimed.

Do not expand this run into a global design-token redesign, generic database-backed
configuration engine, automatic record merge, alternate workflow engine or custom
auth/session architecture. Keep the separately recorded
[configuration roadmap](../backend/configuration/roadmap.md) aligned where
future UI defaults are useful, without making this redesign depend on that larger
project. If investigation exposes a new backend prerequisite, record its exact
domain owner and narrow scope before proceeding, rather than hiding it in a UI helper.

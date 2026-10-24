---
id: zero.drawer-bottom-sheet-system-plan
type: roadmap
audience: [developer, agent, maintainer]
owner: modals
status: draft
visibility: internal
system: modals
feature: managed-drawers
maturity: planned
applies_to: ["2.6.0 working source; proposed managed drawer and detent system"]
modes: [browser, SSR, application, public-pages, source-copy]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Managed Drawers And Bottom Sheets

[Working evidence](./index.md) · [Interaction follow-up](./arc-interaction-follow-up-plan.md) · [Current modal manager](../frontend/modals/index.md)

Add the requested Arc-style BottomSheet and a full drawer facade comparable to
the modal/dialog system. Standard use supplies content/actions rather than
rebuilding title, close button, body, footer, portals and dismissal each time.
Custom composition and sizing remain available through the same ownership
system. The initial [managed drawer contract](../frontend/drawers/index.md) now
implements shared ownership, contained nonmodal inspectors, basic narrow-screen
modal sheets, guards, results and scrolling. The gesture/detent system below
remains proposed; this plan is not a claim that every named capability ships.
The existing-boundary inventory below records the planning baseline before the
initial drawer implementation; use the linked manual for current public exports.

## Reference And Existing Zero Boundaries

Arc BottomSheet exposes controlled/uncontrolled open state, title/description,
trigger, close and detent options. Defaults are viewport fractions .45 and .92.
It springs between stops, transfers body gestures only when appropriate, expands
for reading/focus and exposes keyboard detent controls. Arc's simpler Drawer
supports four sides, header drag dismissal and responsive bounds. See the
[BottomSheet contract](https://uiarc.dev/components/bottom-sheet/markdown) and
[Drawer contract](https://uiarc.dev/components/drawer/markdown).

The [Drawer registry](https://uiarc.dev/r/drawer.json) additionally exposes a
`container` mode and `useDrawerItem`, which retains the last selected item during
exit. These are reference capabilities, not current Zero APIs. Decide portal
admission, local bounds/clipping, modality and retained-content policy before
adopting them; contained CSS layer numbers cannot replace coordinated ownership.

The [BottomSheet registry](https://uiarc.dev/r/bottom-sheet.json) supplies the
gesture calibration: 160px hidden extension, 40px closed gap, .2s velocity
projection, 320px/s flick threshold and 120px rubber-band stretch constant.
Velocity uses recent samples; stale release momentum is ignored. Dragging can
interrupt a running spring; one position drives sheet and dimming. The largest
detent determines physical height. These are reference observations to qualify,
not automatically adopted Zero tokens or current public options.

The reference skin caps sheet width at 36rem, uses the shared surface radius
on its top corners, accounts for the bottom safe area and shows a header divider
only after body scrolling. Map that geometry/material to Zero roles and expose
deliberate size overrides; do not hardcode another theme root. Keep its responsive
body padding readable without enlarging the user's approved smaller close glyph.

| Current owner | Capability to preserve | Gap for this plan |
| --- | --- | --- |
| [Modal facade](../../src/modals/modal-events.ts), [store](../../src/modals/modal-store.ts) and [structured contracts](../../src/modals/modal-system.types.ts) | Exact IDs/generations, accepted/dismissed/retired outcomes, descendant ownership, guards, pending actions, scope retirement and confirmation. | No drawer descriptor/renderer kind or managed detent contract exists here. |
| [ModalManager](../../src/modals/modal-manager.tsx) | Radix focus/dismissal, reserved exit layers, viewport bounds, coordinated backdrop/recession and focus return. | It renders modal geometry/motion, not the proposed drawer gesture system. |
| [OverlayScope](../../src/components/_internal/overlay-scope/overlay-scope.tsx) | Floating branches inherit owner identity, activity, theme and layer. It does not own focus or dismissal. | New drawer branches must participate in these same ownership fences. |
| [Sheet primitive](../../src/components/animate-ui/primitives/radix/sheet.tsx) and [styled Sheet](../../src/components/animate-ui/components/radix/sheet.tsx) | Existing four-side controlled/composable surface and native Radix contracts, including Sidebar's mobile composition. | No comprehensive drawer facade, standardized body or BottomSheet detent/gesture API. |

Do not rename an ordinary modal `placement="bottom"` into a detent sheet or
claim current Sheet supplies this manager. Preserve the existing modal and
Sidebar consumers until a separately qualified opt-in migration is available.

## Proposed Facade And Composition

The architectural target is a drawer-specific facade/renderer over one shared
modality kernel, extending the existing manager where practical. It must not
install a second uncoordinated global stack, backdrop, focus trap or page lock.
The exact extraction and host naming are decisions to freeze before coding.
Existing `modals.open`/`show` contracts and context identities remain stable.

Proposed responsibilities are:

- A standard descriptor with visible title, optional description/icon/meta,
  body, actions, footer note and labeled header actions. Reserve the standard
  **slightly smaller X glyph**; retain an adequate hit target and keyboard-only
  focus indicator. Never replace it with an oversized Close button or allow
  body content under it. Required/non-dismissible surfaces omit dismissal only
  through their deliberate policy.
- Four edge placements, token-sized presets and bounded custom dimensions.
  BottomSheet additionally supplies explicit detents and current/initial detent
  control. Standard desktop drawers and mobile sheets have deliberate responsive
  mappings, rather than guessing from content or silently changing every Sheet.
- Imperative result handles and controlled React composition with exact owner,
  parent, scope and generation semantics. Names such as `drawers.show`, drawer
  handle/context or drawer body parts are **draft API vocabulary only**; no
  import or runnable example is promised before type/implementation admission.
- Standard body composition using the
  [shared scroll treatment](./arc-scroll-surface-plan.md), with header/footer
  outside its bounds. Custom children identify their actual scroll owner;
  tables and virtualized content retain their specialized ownership.
- Existing form, reactive-record and workflow adapters where their contracts
  apply. UI controls call the admitted writer/observer; the drawer never creates
  a second database query, Guardian identity owner or Torrent execution.

Simple visual drawers must remain usable without backend services. Service-backed
actions remain optional and authority-aware. A successful animation is neither
accepted persistence nor task completion.

## Shared Lifecycle And Stacking Requirements

There is one topmost active modality branch across dialogs, drawers and nested
floating menus. Allocate layers from the owner system rather than fixed CSS
`z-index` guesses. An owned picker/country/mention/menu can render outside clipping
while retaining the drawer's theme and activity; its handled Escape/outside press
must not also dismiss the parent.

Retain exact parent relationships, generation-fenced callbacks and once-only
results. Logical settlement precedes optional exit cleanup; closing branches
reserve their visual layer but are inert and cannot trap focus. Reopen/replace
during a drag, close animation or async action must never affect the new branch.
Use the initiating control for return focus only while connected, admitted and
not inert. Scope/host/parent retirement cancels gestures/listeners and suppresses
old callbacks; it must not wait for an unsaved-change prompt or animation.

All user dismissals, including drag-to-close, route through the same busy/dirty
guard admission as X, Escape, backdrop and cancel. A denied gesture springs
back to its admitted detent. A guard can open an owned decision dialog without
losing the drawer's draft/position. Accepted actions use the existing safe-error
and acknowledged-result policy. Hold-to-delete remains available and its real
safety interval is never scaled by decorative timing.

## Detents, Gestures And Reading

Validate all detents before rendering: finite unique viewport fractions in
`(0,1]`, deterministic ascending order, nonempty result and valid selected/initial
index. Specify whether invalid input rejects or normalizes; do not inherit
accidental reference behavior for NaN, empty lists or out-of-range indices.
Bound custom sizes, safe areas and keyboard-reduced `visualViewport`/dynamic
viewport height. Preserve logical detent identity when resize changes pixels.

The planned gesture model includes interruptible spring position, retained
velocity, nearest projected stop and resistance outside the valid range. A fast
flick advances at least one stop; downward dismissal from the lowest stop still
requires close admission. Freeze reference constants, sampling windows and
thresholds in a pure model with tests before exposing calibration options.

Keep horizontal intent, multi-touch and interactive header controls native.
At the highest detent the body normally scrolls; a downward pull at its top may
transfer to the sheet. Below the highest detent, upward intent can expand first.
Treat pointer cancel/lost capture, unmount, viewport replacement and scope
retirement as explicit cleanup paths. Do not capture a nested table/editor's
gesture or disable page zoom.

Grabber keyboard behavior must be documented and tested: Up/Down move stops,
Home chooses the tallest detent, End the smallest, and Enter/Space toggles between
admitted stops. This reference mapping differs from a numeric field's min/max order.
Screen readers receive useful detent state without frame-by-frame announcements.
Focus or reading intent can expand to reveal controls below the fold without
moving focus. Closing/collapsing, scroll reset and preserved draft position need
an explicit policy and reduced-motion equivalent.

## Motion And Token Policy

Drawer entry/exit follows its edge and detent gesture, with physical dimming
coordinated by the host. This is a distinct recipe from modal From Button/Rise,
Select morphology, Tooltip Grow and compact chart inspection. Preserve those
approved defaults and magnetic menu handoffs. Do not assign Origin to every
drawer simply because it has a trigger.

Reduced motion removes decorative travel, overshoot and drag animation where
appropriate; controls must still open, select detents, scroll, focus and dismiss
through guards. It does not change accepted writes, safety holds or operation
timeouts. Keep shared surface/type/border/focus/backdrop tokens in the existing
catalog; list truly new gesture/geometry roles in the theme ledger rather than
copying Arc's palette into a separate CSS root.

The reference's native thin body scrollbar is not this project's requested end
state: an admitted ordinary drawer body uses Arc ScrollArea treatment. This is
an intentional Zero integration, not pixel-equivalence to that reference detail.

## Delivery And Verification Gates

- [ ] Freeze shared lifecycle extraction, public facade/types, controlled mapping,
  detent validation, current Sheet compatibility and host admission rules.
- [ ] Add the pure detent/gesture model and edge-specific motion before organisms.
- [ ] Compose standard drawer and BottomSheet anatomy with one body owner.
- [ ] Integrate exact stack/portal/scope/guard/result behavior, then optional
  acknowledged form/record/workflow adapters under their existing authorities.
- [ ] Qualify pointer, touch, keyboard, zoom, focus-below-fold, wheel handoff,
  resize/keyboard safe areas, live reduced motion, RTL edge placement and
  forced-color presentation on desktop and mobile.
- [ ] Test modal→drawer→picker, drawer→modal guard, mixed sibling order, exit/reopen,
  async completion after replacement, parent retirement, denied drag close,
  interrupted spring, contained hosts/portals and retained exit content, and
  teardown with no stranded waiter/lock/listener. Scope retirement must not retain
  sensitive content merely to finish a decorative exit.
- [ ] Freeze old/new imports and copied dependencies; preserve customized files,
  package fixture denials, exact contexts, SSR/native types and installed assets.
- [ ] Publish a drawer subsystem overview plus focused Drawer/BottomSheet/gesture
  manuals and compiling examples after implementation. Add capability-aware
  Doctor rules only for actual shipped contracts; no blanket Sheet replacement.

The [organization roadmap](./frontend-component-organization-plan.md) owns future
source relocations. Retaining original theme material, public imports and
polished Sidebar behavior remains a separate compatibility gate.

---
id: zero.inventory.modal-manager
type: inventory
audience: [agent, maintainer]
owner: modals
status: draft
visibility: internal
system: modals
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Modal Manager And Confirmation

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed; its independent source contract review is complete, while whole-platform and package reconciliation remain separate gates. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Independent Source Contract Review

Reviewed independently on 2026-10-05 against the pinned baseline's public
barrels, implementations, configuration/argument definitions and runtime
composition. The feature groups in this inventory are reconciled; the full
platform map, detailed guides and installed-package qualification are separate
gates. Authorized post-baseline source corrections remain supplemental dirty
working evidence, not released support. No app configuration, Doctor, live data,
provider or environment file was executed for this contract review.

## Purpose And Terminology

Owns the browser modal stack, confirmation promises, close/update lifecycle, exit removal and hold-to-confirm UI. Generic ConfirmProvider/useConfirm is a separate implementation, not an alias of this stack.

## Supplemental Authorized Hold-Confirmation Correction

The source baseline above remains pinned to the original committed main; the
following observations describe later authorized, uncommitted corrections. The
original HoldButton was pointer-only and did not retire pending frames on unmount.
The working correction supports sustained Space or Enter, ignores keyboard repeat
restarts and secondary pointer buttons, and confirms once after the configured
duration. Releasing the key/pointer, leaving the pointer target, pointer
cancellation, losing focus, hiding the document, unmounting, or changing the action
callback/duration cancels the hold. A cancelled hold cannot invoke its callback
when a queued frame resumes. The duration still defaults to 1500 ms; the callback
remains caller-owned and its side effects are not awaited. This component does not
provide backend mutation or authorization guarantees.

The closeout reproduced an additional focus lifecycle failure before its
correction: switching away from the browser could leave a hold active and allow
the resumed frame to confirm. Window-blur/hidden-document listeners now retire
that hold and are removed on cleanup. These changes stay within
[hold-button.tsx](../../../../src/modals/hold-button.tsx).

A deterministic wall-clock adjustment check also reproduced premature confirmation
after 101 ms of a 200 ms hold when the system clock jumped forward. Duration now
uses monotonic `performance.now()` rather than `Date.now()`, so forward/backward
wall-clock changes cannot shorten or indefinitely extend the hold.

Executed on 2026-10-05 with Bun 1.3.14 and automatic env-file loading disabled:
`bun --no-env-file test src/components/forms/wizard.test.tsx src/components/forms/wizard-lifecycle.browser.test.ts src/modals/hold-button.browser.test.ts src/modals/modal-store.test.ts`.
Final result: **22 passed, 0 failed, 52 assertions across 4 files**. This includes
**11 isolated Chromium hold-button tests**, **3 existing modal-store tests**, and
8 Wizard tests. The [hold-button.browser.test.ts](../../../../src/modals/hold-button.browser.test.ts)
fixture uses synthetic counters and a deterministic frame clock: no actual
deletion, live app, provider or database is involved. This verifies the specified
interaction/lifecycle behavior, not a complete modal-host, screen-reader,
reduced-motion, mobile-device or packaged-release qualification.

## Features And Documentation Coverage

The HoldButton closeout additionally confirmed that invalid durations could
render unusable confirmation controls. The working source now rejects zero,
negative, nonfinite and untyped duration values before requesting a frame;
omitted/finite positive durations remain supported. Executed:
`bun --no-env-file test src/modals/hold-button.test.tsx src/modals/hold-button.browser.test.ts src/components/crud-page/crud-page.browser.test.ts src/modals/modal-store.test.ts`.
Result: **33 passed, 0 failed, 124 assertions** (2 duration, 11 HoldButton,
17 CrudPage and 3 modal-store tests). The targeted duration regression initially
reported 1 passing and 1 failing test. See
[hold-button.test.tsx](../../../../src/modals/hold-button.test.tsx).
These counts overlap other focused runs and are not a unique whole-suite total.

### Supplemental Generic Confirmation And Alert-Dialog Corrections

Independent source/browser review confirmed three additional defects in the
original baseline: a newer ConfirmProvider request replaced the previous promise
resolver without settling it, unmounting left a pending request unresolved, and
ConfirmModalContent ignored confirmLabel for hold confirmations. The authorized
working correction cancels superseded/unmounted requests with false, rejects a
retained confirmation callback after unmount with false, and settles the latest
acceptance once. Return-focus ownership stays with the original programmatic
opener while requests replace one another.

The isolated browser fixture also reproduced an ordinary open failure in the
animated AlertDialog primitive (a private Radix Slot identity clash) and a close
failure retaining force-mounted content and pointer isolation. Motion now wraps
Radix's content component as one element; content and overlay have explicit
open/closing/rendered lifecycles that retire on animation completion, without a
fixed-delay workaround. Cancel/confirm still use Radix focus and dialog semantics,
including reduced-motion behavior. Programmatic ConfirmProvider has no Radix
Trigger, so it restores a still-connected original opener itself; stale replaced
requests cannot move focus. Missing optional descriptions get an accessible
hidden fallback.

Hold confirmations now use a supplied confirmLabel; otherwise their generic
label is Hold to Confirm and their progress label is Confirming..., rather than
claiming every confirmed action deletes data. The standalone HoldButton's
documented deletion defaults are unchanged.

Executed 2026-10-05 with Bun1.3.14, automatic env-file loading disabled:
`bun --no-env-file test src/hooks/use-confirm.browser.test.ts src/modals/confirm-modal.test.tsx src/modals/modal-store.test.ts`.
Final corrected-source result: **10 passed,0 failed,30 assertions across3 files**.
Fixtures use in-memory synthetic UI only; no app configuration, credentials,
database, service action or provider call was involved. Tests establish these
interaction/ownership contracts, not a complete screen-reader/mobile or package
qualification. All runtime changes remain uncommitted working evidence.

Evidence: [use-confirm.tsx](../../../../src/hooks/use-confirm.tsx),
[use-confirm.browser.test.ts](../../../../src/hooks/use-confirm.browser.test.ts),
[confirm-modal.tsx](../../../../src/modals/confirm-modal.tsx),
[confirm-modal.test.tsx](../../../../src/modals/confirm-modal.test.tsx), and
[animated AlertDialog primitive](../../../../src/components/animate-ui/primitives/radix/alert-dialog.tsx).

| Feature | Exact public symbols/source evidence | Canonical planned guide |
| --- | --- | --- |
| Modal host | ModalManager/ModalManagerProps via root/react and /modals; [src/modals/modal-manager.tsx](../../../../src/modals/modal-manager.tsx) | `frontend/modals/modal-manager.md` |
| Content open | modals.open(options & {content}) returns string ID; [src/modals/modal-events.ts](../../../../src/modals/modal-events.ts) | `frontend/modals/content.md` |
| Awaited confirmation | modals.confirm(OpenConfirmOptions) returns Promise<boolean>; ConfirmModalContent public from /modals | `frontend/modals/confirm.md` |
| Close/update | modals.close(id), closeLast(), closeAll(), update(id, Partial<OpenModalOptions>) | `frontend/modals/lifecycle.md` |
| Scope replacement discard | modals.discardAll(); no app close callbacks; store resolves pending confirms false | `frontend/modals/scope-transitions.md` |
| Hold UI | HoldButton/HoldButtonProps; [src/modals/hold-button.tsx](../../../../src/modals/hold-button.tsx) | `frontend/modals/hold-button.md` |
| Types/presets | ModalSize/ModalType/ModalOverflow/ModalCustomSize/ModalInstance/ConfirmModalOptions/OpenModalOptions/OpenConfirmOptions/ModalStoreState/MODAL_SIZE_CLASSES; [src/modals/modal.types.ts](../../../../src/modals/modal.types.ts) | `frontend/modals/configuration.md` |
| Generic confirm provider | ConfirmProvider/useConfirm/ConfirmOptions via hooks/root/react; [src/hooks/use-confirm.tsx](../../../../src/hooks/use-confirm.tsx) | `frontend/hooks/confirmation.md` |

## Public Surface And Integration Map

AppProvider mounts ModalManager. modalStore is internal to the modals barrel; no useModals API was found. Close callbacks and authority-scope discard differ: discard prevents callbacks captured under replaced account/tenant scope. Confirmation acceptance never grants permission; backend services reauthorize. CRUD/admin flows reuse modals. zero add modals creates app-owned copied source, not a new server service.

## Configuration Inventory

- ModalManagerProps.children required: runtime host, no env/Doctor binding.
- Open content content/title/size/customSize/from/showCloseButton/closeOnClickOutside/closeOnEscape/className/onClose: content required; default md/top and controls enabled. Captured at open, supported fields may be updated. close(id) marks a modal for exit removal; closeAll/discardAll clear the entire stack immediately, rather than waiting for exit animation.
- ModalCustomSize width/maxWidth/height/maxHeight/overflow: CSS; width overrides preset; defaults in types/host.
- Confirm title/description/confirmLabel/cancelLabel/variant/holdToConfirm/holdDuration plus size/customSize/from/className: title required, confirm default sm, hold duration 1500 ms.
- HoldButton onConfirm/holdDuration/label/holdingLabel/icon/className/fillClass/textClass/textFilledClass: callback required, duration defaults to1500 ms and must be a finite positive number; presentation does not cancel a backend transaction. The authorized working correction adds runtime invalid-duration admission described above; the pinned baseline did not enforce it.
- Generic ConfirmOptions title/description/confirmLabel/cancelLabel/variant: separate provider promise.

Planned `frontend/modals/configuration.md` distinguishes user options from exported instance/store shapes carrying private fields such as _resolve.

## Evidence And Verification

Tests present [src/modals/modal-store.test.ts](../../../../src/modals/modal-store.test.ts); scope discard integration inspected in AppProvider. Usage [src/components/crud-page/crud-page.tsx](../../../../src/components/crud-page/crud-page.tsx). The supplemental hold-confirmation browser and modal-store checks above were executed; they do not establish complete modal-host or accessibility coverage.

## Findings, Philosophy, And Known Future Plans

- Exported instance/store types do not expose modalStore mutation or resolver APIs.
- Confirmed HoldButton keyboard and cancellation defects are corrected in the authorized working tree with focused browser coverage above. Full host, assistive-technology and reduced-motion qualification remains distinct from those passing checks.
- Established principle: one shared stack owns dismissal/lifecycle; authority changes discard stale actions.
- [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) plans modal-manager redesign as evolution of an existing implementation.

## Navigation And Completion Review

### Detailed Modal Draft And Close-Notification Correction

The first-draft [modal manual](../../../frontend/modals/index.md) now covers all
eight inventoried feature groups, including the separate
[generic confirmation provider](../../../frontend/hooks/confirmation.md).
Canonical catalog destinations are reconciled rather than duplicating guides.

Detailed tracing reproduced another close lifecycle defect: onClose ran before
committed dismissal/clear. A throwing notification prevented close/remaining
confirm cancellation; recursive close could re-enter the same callback; closeAll
could notify an already-closing instance twice or discard new callback-opened UI.
The initial synthetic store test recorded 0 passed / 5 failed.

The correction commits lifecycle state before observing caller notifications and
uses a focused modal-close-callback helper. Sync/async failures cannot strand
closing UI or pending confirms, and emit only the new stable
frontend.modal_callback.failed code with safe surface/stage metadata.
discardAll still runs no app callbacks. The three-file events/store/confirm run
passed 11 tests / 30 assertions using synthetic strings/counters/local sinks.
No browser/app/database/provider was used; this is not host/package qualification.
Agent B independently reviewed commit/clear-before-notification, repeated and
reentrant close handling, async rejection observation and callback-free discard.
Its independent rerun passed the same 11 tests / 30 assertions with no further
correction requested. This closes the focused source-review gate, not host,
device, accessibility or exact-package qualification.

Sources: [modal-events](../../../../src/modals/modal-events.ts),
[close callback](../../../../src/modals/modal-close-callback.ts),
[regressions](../../../../src/modals/modal-events.test.ts).

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent source/contract review of this inventory.
- [ ] Whole-platform reconciliation.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.

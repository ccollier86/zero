---
id: zero.frontend.modals.roadmap
type: roadmap
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: roadmap
maturity: planned
applies_to: ["Implemented structured-modal upgrade; 2.6.0 source baseline; unreleased"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Modal Manager Roadmap

[Modals index](./index.md) · [Documentation index](../../index.md)

The approved direction is recorded in the source-backed
[modal system redesign plan](../../_work/modal-system-redesign-plan.md). It evolves
the existing manager and primitives. The facade/layouts/integrations are implemented
and qualified on the working branch, but are not a published release. The plan's
investigation, compatibility and verification gates are recorded below; this work
does not introduce a parallel modal lifecycle.

The current stack, exact IDs, confirmation promises, scope discard, keyboard hold
and close callback isolation have their own contracts. Confirmed lifecycle defects
are fixed/tested rather than renamed planned limitations.

## Deliverables And Order

- [x] Freeze public facade/result contracts and legacy migration policy. Existing
  `modals.open` returns a string ID; do not silently change that contract.
- [x] Coordinate nested-modal ownership, owned floating portals, topmost dismissal,
  focus return, scope retirement and exit-layer reservations.
- [x] Add one tokenized shell with visible title, reserved slightly smaller X glyph,
  anchored header/footer, scrolling body, tabs/grouped nav, viewport-safe presets,
  custom sizes/placement and optional hidden/thin scrollbars.
- [x] Add the reference's reusable dense list using existing Zero controls, without
  duplicating integration, notification or permission services.
- [x] Add the [Motion Lab presets and settings](../../_work/modal-system-redesign-plan.md#motion-and-theme-contract):
  From button by default with **Rise fallback**, preset-paired exit, dim+blur,
  page recession and a 1.5 duration multiplier (975ms origin / 900ms Rise entrance).
  Keep Rise/Grow/Origin/Spring/Focus/Drop and the other settings available through
  validated defaults/overrides, with shared effects, tokens and live reduced motion.
  Working-source motion/presentation gates are recorded below; this is not a
  published-package or complete application migration claim.
- [x] Connect acknowledged form/actions, cancellable Save/Discard/Stay, safe errors,
  optional notifications and existing held destructive confirmation.
- [x] Add reactive-record/draft awareness with atomic baseline adoption and honest
  backend revision/CAS requirements; never silently overwrite or merge dirty drafts.
- [x] Add durable Torrent progress using existing hooks, with honest loading,
  unavailable, reconnect, admission/completion and close/cancel distinctions.
- [x] Migrate Zero-owned dialogs, qualify public exports, add installed-capability-
  aware Doctor migration findings and document consuming-app upgrades.
- [x] Update public guides, examples, scaffold/agent guidance and validate the packed
  package plus the specific layout/accessibility/browser behaviors that changed.
  Professionally rewrite the modal documentation family in the new `docs-next`
  track, including motion/defaults, complete examples and migration—not only an
  appended list of props.

The plan preserves the user's supplied layout and subsequent Motion Lab reference,
while all visual styling remains controlled by the current Zero theme. A full
global theme redesign and database-backed application configuration are separate
projects. Basic dialogs must remain usable without Guardian, Fabric or Torrent.

## Verified Working-Source Gates — 2026-10-08

- [x] Motion constants/CSS parity and interruption/lifecycle regressions:
  24 tests, 165 assertions. Includes real WAAPI cancellation semantics: after
  cancel, a newly read idle finished promise must not strand a scene reservation.
- [x] Isolated styled Chromium presentation suite: 5 tests, 108 assertions.
  Covers desktop/mobile custom, side and full bounds; hidden/thin body scrolling;
  live scoped public/dark tokens through owned popups, including lane-only changes
  without a light/dark class change; six exact entrance timings;
  and reduced-motion close/reopen returning to full timing without page locks.
- [x] Professional modal family rewritten with layouts, configuration, six-preset
  motion, acknowledged forms, reactive records, progress, decisions, prompts,
  lifecycle, ownership and migration. DenseList/Switch/Tabs have public guide homes.
- [x] Navigation/metadata: 747 pages, unique IDs and reachable pages, no problems.
  Named-symbol placement: 1,019 records / 173 homes, no missing homes.
- [x] Current public-source example compiler: 13 actual modal/list/form/tab
  snippets, 14 assertions, no diagnostics after CRUD writer types stabilized.
- [x] Zero-owned migrations, independent defect review and installed/copied-source
  package qualification pass. The [review ledger](../../_work/modal-system-review.md)
  records actual checks and supported boundaries, including scoped progress actions,
  secret-safe exit paint and acknowledged notification failures.
- [ ] Version/publish/merge/deploy through the authorized release workflow; consuming
  apps still need their own deliberate migration and rollout.

The source-only Doctor path is non-executing AST inspection, not a visual,
accessibility or write-acknowledgment certification. Missing/older installed
capabilities do not receive unsupported upgrade advice. CommandDialog keeps its
separately audited command-palette anatomy rather than being blindly converted
to an ordinary form frame. The
[execution ledger](../../_work/modal-system-redesign-plan.md#working-source-execution-ledger--2026-10-08)
records these bounded checks and remaining gates.

## Related Guides And Next Steps

- [Host](./modal-manager.md) describes current structure.
- [Configuration](./configuration.md) describes existing props.
- [Lifecycle](./lifecycle.md) describes corrected close ownership.
- [Implementation plan](../../_work/modal-system-redesign-plan.md) owns the detailed
  phases, source findings, compatibility decisions and completion checklist.
- [Shared scroll adoption](../../_work/arc-scroll-surface-plan.md) records the
  remaining managed body/panel/navigation decoration, with retained positions
  and header/footer outside masks. This coverage is planned, not already complete.
- [Managed drawers and BottomSheet](../../_work/drawer-bottom-sheet-system-plan.md)
  defines the proposed drawer facade and detents over coordinated modality
  ownership. Existing Sheet and bottom-placed modals are preserved; no second
  global lifecycle or automatic Sidebar replacement is planned.

---
id: zero.frontend.modals.hold-button
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: hold-button
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Deliberate Pointer Or Keyboard Hold

[Modals index](./index.md) · [Documentation index](../../index.md)

HoldButton is a reusable browser confirmation interaction, public from /modals
and the root/React barrel. It does not execute or await a server mutation itself.

```tsx
import { HoldButton } from '@zero/framework/modals';

<HoldButton onConfirm={requestDelete} holdDuration={1500} label="Hold to delete" />;
```

This fragment assumes caller-owned requestDelete and server-checked deletion.
HoldButtonProps requires onConfirm and optionally holdDuration/label/holdingLabel/
icon/className/fillClass/textClass/textFilledClass.
Defaults1500ms, "Hold to Delete", "Deleting...", Trash2, destructive fill/text and
destructive-foreground filled text. Invalid zero/negative/nonfinite/untyped
duration is rejected before requesting animation frames.

Only sustained primary-pointer, Space or Enter interaction confirms, once.
Keyboard repeat does not restart holds. Release, pointer leave/cancel, button/window
blur, hidden document, unmount or changed callback/duration cancels pending work.
Queued frames after cancellation cannot invoke the old action.
Elapsed duration uses performance.now so wall-clock changes cannot shorten it.

Progress is presentation, not an accepted deletion receipt. The callback remains
void/caller-owned and can arrange an awaited mutation lifecycle separately.
Do not hide backend failures behind a completed fill animation.

In the unreleased structured shell, actions/actionConfirm can set holdToConfirm
and holdDuration directly. Their admission bounds are250–60000ms; the standalone
HoldButton retains its finite-positive compatibility contract. The1500ms default
is actual elapsed safety time: durationMultiplier and reduced motion never shorten
it. Prefer actionConfirm when the dialog must stay open until deletion is accepted.

## Verification

Test pointer and keyboard, short release, cancellation/unmount/action replacement,
hidden-page/window blur, duration validation and wall-clock changes. Synthetic
browser regressions cover focused working-source interaction, not all assistive/
mobile devices or a packaged release.

## Related Guides And Next Steps

- [Confirmation](./confirm.md) composes generic hold labels.
- [Actions](../data-controls/data-table/actions.md) composes awaited mutations.
- [Configuration](./configuration.md) owns exact options.
- [Lifecycle](./lifecycle.md) owns host settlement.

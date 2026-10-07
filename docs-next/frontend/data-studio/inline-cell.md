---
id: zero.frontend.data-studio.inline-cell
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: inline-cell
maturity: supported
applies_to: ["2.2.1 development source with temporal-editor changes; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.2.1"
  commit: "95ba0578f6625fc4597a9ec6786ee1d3353f29cd"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Smooth Revisioned Inline Cells

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioInlineCell preserves the grid cell's typographic box and geometry.
Text, numeric and JSON editors overlay the cell without turning it into a
decorated framework Input. Date/datetime cells keep their compact display and
open an anchored editor using Zero's calendar/time controls. Import from the
Studio subpath or root/React barrel.

Required props: value (DataStudioValue or undefined), column, revision and
onCommit(value):Promise<unknown>. Optional disabled/selected (false), onSelect,
onReload():Promise<unknown>, onNavigate(-1|1) and className.
Capture the authoritative revision and writer at edit start, not a later unrelated
row/callback. The connected controller already supplies revision-aware writes.

DataStudioCellSaveState is idle/pending/saved/error/conflict. For in-cell text,
numeric and JSON editing, Enter saves; Tab/Shift+Tab save then move forward/back;
Escape cancels, and blur saves a changed valid draft. Composition input
suppresses those shortcut decisions. resolveDataStudioCellKeyAction(key,
shiftKey=false,isComposing=false) returns save/save-and-move/cancel or null.
It is a public pure helper; it does not execute a write.

## Date And Datetime Cells

The focused popover has **Apply** and **Cancel** controls. Choosing a calendar
date or changing a time selector only changes the local draft; leaving a portal
control does not implicitly save. Apply validates and
awaits the captured writer. Enter in the date field normalizes/validates that
field; it does not commit the cell. Enter on a calendar day or time choice selects
that choice without saving the cell. An unconsumed Enter in the precision text
field can Apply; use the explicit Apply button for the common save path.
Escape, Cancel or outside dismissal discards
the local change. A nested calendar/selector consumes its own Escape before the
cell editor closes. Pending saves block dismissal and duplicate interaction.

Datetime editors include explicit seconds/milliseconds, so changing a minute
does not truncate an existing timestamp's precision. Invalid typed values remain
editable with field feedback. Unchanged Apply is an exact no-op, including
absent values and explicit null. The [value contract](./values.md) describes
calendar/local-time admission; the [shared primitives](../components/primitives/dates-and-time.md)
describe picker options.

A changed authoritative row revision while editing restores the latest value
and reports a conflict instead of overwriting it. Commit awaits acceptance;
rejected/conflicting drafts restore the previous/current authoritative display.
Unchanged drafts need not issue writes. Pending/saved/error/conflict indicators
communicate status without exposing rejected private payloads.

The component chooses typed editors by column type and uses value helpers for
logical parsing. Parsing is client feedback, not server schema enforcement.
Optional values preserve absent versus stored null. onReload reconciles conflict
state through the actual service, not blind retry with a stale revision.
Error/conflict status can appear before that reload finishes. Requested focus
restoration follows the reload; status alone is not a focus-completion signal.

Standalone composition must change/remount its contextual identity on tenant/
table/record replacement; the connected grid/controller owns those boundaries.
A Promise only represents what the writer awaits, not a rollback or global
exactly-once guarantee.

The synchronous admission fence rejects same-tick duplicate commits, including
boolean toggles before React paints pending state. Unmount retires the pending
save revision and saved-status timer; a late promise/animation-frame callback
cannot restore state, navigate a replacement query or steal focus. Already
accepted server work is not undone by that UI retirement.
Queued focus/navigation also belongs to its captured edit generation: starting
a newer edit or cancelling retires callbacks from the preceding interaction.

## Related Guides And Next Steps

- [Grid](./grid.md) supplies revision/writer and keyboard neighbors.
- [Values](./values.md) owns draft conversion.
- [SDK](./sdk.md) owns revision errors and retained operation IDs.
- [Controller](./controller.md) owns live scope reconciliation.

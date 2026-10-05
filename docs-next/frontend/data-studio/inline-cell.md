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
applies_to: ["2.1.1 source; package qualification pending"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Smooth Revisioned Inline Cells

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioInlineCell edits in place: a native editor overlays the same typographic
box while hidden display content preserves geometry. It does not switch the
whole cell into a decorated framework Input. Import from the Studio subpath or
root/React barrel.

Required props: value (DataStudioValue or undefined), column, revision and
onCommit(value):Promise<unknown>. Optional disabled/selected (false), onSelect,
onReload():Promise<unknown>, onNavigate(-1|1) and className.
Capture the authoritative revision and writer at edit start, not a later unrelated
row/callback. The connected controller already supplies revision-aware writes.

DataStudioCellSaveState is idle/pending/saved/error/conflict. Enter saves;
Tab/Shift+Tab save then move forward/back; Escape cancels. Composition input
suppresses those shortcut decisions. resolveDataStudioCellKeyAction(key,
shiftKey=false,isComposing=false) returns save/save-and-move/cancel or null.
It is a public pure helper; it does not execute a write.

A changed authoritative row revision while editing restores the latest value
and reports a conflict instead of overwriting it. Commit awaits acceptance;
rejected/conflicting drafts restore the previous/current authoritative display.
Unchanged drafts need not issue writes. Pending/saved/error/conflict indicators
communicate status without exposing rejected private payloads.

The component chooses typed editors by column type and uses value helpers for
logical parsing. Parsing is client feedback, not server schema enforcement.
Optional values preserve absent versus stored null. onReload reconciles conflict
state through the actual service, not blind retry with a stale revision.

Standalone composition must change/remount its contextual identity on tenant/
table/record replacement; the connected grid/controller owns those boundaries.
A Promise only represents what the writer awaits, not a rollback or global
exactly-once guarantee.

The synchronous admission fence rejects same-tick duplicate commits, including
boolean toggles before React paints pending state. Unmount retires the pending
save revision and saved-status timer; a late promise/animation-frame callback
cannot restore state, navigate a replacement query or steal focus. Already
accepted server work is not undone by that UI retirement.

## Related Guides And Next Steps

- [Grid](./grid.md) supplies revision/writer and keyboard neighbors.
- [Values](./values.md) owns draft conversion.
- [SDK](./sdk.md) owns revision errors and retained operation IDs.
- [Controller](./controller.md) owns live scope reconciliation.

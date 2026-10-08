---
id: zero.frontend.data-studio.dialogs
type: reference
audience: [developer, agent]
owner: data-studio
status: verified
visibility: internal
system: data-studio
feature: dialogs
maturity: supported
applies_to: ["2.6.0 source/local archive with compact record editors"]
modes: [browser, SSR, Guardian multi, Fabric tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "b003d5b8f738a17d4f0d84bf2643eed615b2c543"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Table, Record And Confirmation Dialogs

[Data Studio index](./index.md) · [Documentation index](../../index.md)

DataStudioTableDialog, DataStudioRowDialog and DataStudioConfirmDialog are public
from @zero/framework/components/data-studio. Their callbacks are Promise-returning;
the packaged workspace passes the scoped controller. They author logical schemas/
values, not physical SQL/DDL or actor paths.

## Table Schema

TableDialog requires open/onOpenChange; table is optional (create if absent).
busy defaults false. onCreate(input:DataStudioTableCreate) or
onUpdate({ name, description, schema }, options?:{ expectedRevision:number })
supply the corresponding writer. Existing one-argument callbacks remain valid;
new custom writers should use the additive opening-revision options.
It stages table name/key/description and ordered column definitions, supports
column add/reorder/removal and explicit default mode (none/null/value).
Machine keys are normalized for creation; existing identities stay stable.
The dialog has an explicitly wide, responsive frame, fixed header/footer and a
scrolling body. Compact column rows use the existing inline-text component;
selecting a column exposes its type/required/description/default options beside
the list. It reuses the same internal column editor as the grid-header popover.
Client authoring errors remain visible; successful callbacks close the dialog.

Visual and JSON are two modes of one draft, not separately saved documents.
The JSON mode uses [Zero JsonEditor](../components/json-editor.md), with structured
editing and whole-document text editing. It edits the actual `DataStudioSchema`
object (`version`, ordered `columns`, stable `columnId`/`key`, supported type,
`required`, optional description/defaultValue), not third-party JSON Schema.
Invalid JSON/unsupported schema properties produce field/path feedback. An
invalid text buffer remains intact and blocks switching back to Visual or saving;
it is never silently replaced from the last valid object. Unfinished valid edits
are locally committed before mode handoff. General code-editor highlighting is
not part of this component.

Table key and Field key label machine identifiers, not authentication/API-key
credentials. IDs remain stable through label edits, selection, ordering and Visual/JSON
round trips. Newly added columns use distinct UUID-derived IDs, not time/index
identities that can collide after removal/re-addition. `startWithNewColumn=true`
adds/selects a fresh draft column on opening; the grid/end and bottom action bar
can therefore enter directly into column configuration.
`maxColumns` can narrow the displayed/addable column count to the application's
quota (never above the structural 128-column maximum). The packaged workspace
passes its admitted capability limit. Both JSON admission and Save enforce the
same UI limit; the server independently validates it again.
The JSON editor delegates vertical scrolling to the dialog body rather than
adding a second nested editor viewport.

Opening captures the table's optimistic `revision`. Background refreshes do not
reset the draft or silently upgrade that precondition. Saving calls onUpdate
with the captured `expectedRevision`; a conflict keeps the draft available.
Creating/editing a different table or closing/reopening starts a new session.
Parent organization boundaries must unmount/key the containing workspace.

Closing a dirty draft offers Save changes, Discard changes or Keep editing.
Save first admits the local JSON/visual draft, then awaits the complete writer;
local JSON admission alone never closes as a successful server save. Explicit
removal, saved field-key rename, type changes or tightening required fields are
reviewed before submitting the complete schema. Backend compatibility checks
still reject unsafe changes against existing values; confirmation does not
create a migration or bypass that policy.

Same-tick submissions reserve one writer. Pending saves disable close/discard;
failed writes retain the draft. Late completion after session replacement cannot
close its successor. A failed close notification after an accepted write is
observed safely, not reclassified as a rejected write or made resubmittable.

The controller accepts the opening expectedRevision. A direct custom callback
must carry it and the operation identity through the SDK, not remove concurrency checks.
An absent writer rejects instead of pretending creation succeeded.

## Record Creation

RowDialog requires open, table (or null), onOpenChange and onCreate(values);
busy defaults false. The packaged controller supplies `scopeKey`; standalone
composition should pass a stable string/number identifying the current
authorization/source context. Opening, changing table identity or changing
scope starts a new draft lifetime. A retired request cannot close, populate or
report its failure into a replacement lifetime, including A→B→A transitions.

The title identifies the destination table. A compact responsive 44rem frame presents
typed fields with recognizable type icons, required markers, descriptions and
default hints. Desktop fields use two columns; JSON and datetime fields use
the full width. On narrow screens fields stack. Only the body scrolls; the
heading, close control and action/error footer remain reachable.

Values are submitted by public column **key**; local drafts use stable
`columnId` identities. Untouched optional/defaulted fields are omitted so
server defaults apply. Required fields without defaults need explicit values.
True/False/Empty (null) choices distinguish boolean false from an absent field
or null. Numeric/JSON input retains incomplete text until validation rather
than losing it to a native number control. Date/datetime fields reuse Zero's
calendar/time controls and preserve seconds/milliseconds; see [values](./values.md).
The date calendar has focused month/year drill-down and a Close action; time
selection uses one compact trigger/list rather than three oversized selectors.
Selecting or dismissing those nested controls does not submit the record.
Validation highlights and focuses the first invalid field without discarding
other values. Client feedback does not replace backend schema/authority checks.

Opening captures a detached schema and `schemaRevision`. A background schema
change keeps the entered values, blocks Create and offers **Reload fields**.
Reloading a dirty draft requires **Discard and reload** or **Keep editing**.
Record counts and unrelated table metadata do not reinterpret the draft.

`onCreate` is awaited. A synchronous admission guard prevents same-tick
duplicate submissions; pending work disables fields, Cancel, Escape and outside
dismissal. Failure keeps the draft, shows a content-free message and uses Zero's
frontend observability, without copying callback exceptions or field values
into logs. An ambiguous `DataStudioMutationError` retains the exact payload for
**Retry request** and prevents editing that request. The supplied writer must
preserve the SDK's same-idempotency-key retry contract; a UI promise is not
itself an idempotency or rollback mechanism. Accepted close-notification failure
is not reclassified as a rejected creation or made resubmittable.

Closing an entered draft asks the author to keep editing, discard it or create
the record. Archived tables and changed schemas remain blocked; no dialog
choice can bypass Guardian or Fabric isolation.

## Confirmation

ConfirmDialog requires open/title/description/confirmLabel/onOpenChange/
onConfirm():Promise<unknown>; busy and destructive default false.
It awaits the caller's complete operation before closing and displays failure.
The dialog also owns a synchronous admission guard and internal pending state;
the caller's busy flag can additionally narrow it. Cancel/close is disabled while
either is pending. Errors reset for a newly opened confirmation. `operationKey`
can identify a replacement target/action explicitly; old completion cannot close
the replacement. Accepted-close callback failure does not resubmit the action.
A dialog is not server authorization,
idempotency or a universal rollback mechanism.

Use these focused controls alongside one workspace rather than add independent
large action cards. The controls narrow UI, while Guardian/Fabric/service
admission and revision checks enforce actual management.

## Verification

Test create/edit distinction, schema revisions/defaults/required values, typed
JSON/date drafts, rejected writers, busy controls, scope replacement and reopening
after failure. Independent source/browser checks must precede claiming broader
installed-package modal/accessibility qualification.

## Related Guides And Next Steps

- [Controller](./controller.md) owns accepted operations/revisions.
- [SDK](./sdk.md) owns exact retry identity.
- [Values](./values.md) owns draft parsing.
- [Workspace](./workspace.md) owns logical action grouping.

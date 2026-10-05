---
id: zero.frontend.data-controls.data-table-actions
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: data-table-actions
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, array, collection, lazy, server query]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Complete Row And Bulk Actions

[DataTable index](./index.md) · [Documentation index](../../../index.md)

Actions declare what the app does; the table handles pending state, duplicate
interactions, confirmation, safe failure presentation and configured refresh.
They are UI operations, not a replacement for server permission enforcement.

## Row Action Definitions

```tsx
import type { RowAction } from '@zero/framework/components/data-table';

const actions: RowAction<Task>[] = [{
  id: 'archive',
  label: 'Archive',
  disabled: (row) => row.archived === true,
  disabledReason: 'Already archived',
  confirm: { title: 'Archive this task?', confirmLabel: 'Archive' },
  onClick: async (row, context) => {
    await archiveTask(row, context?.signal);
  },
}];
```

This declaration fragment assumes app Task and an acknowledged archiveTask writer;
it does not invent a Zero archive endpoint. Pass actions to DataTable.
RowAction includes optional id/icon/variant/visible/disabled/disabledReason/confirm/
refreshOnSuccess plus required label/onClick. variant is default or destructive.
visible receives the target; disabled and disabledReason may be values or target
functions. An optional confirmation has title, description, confirmLabel,
cancelLabel, variant, holdToConfirm and holdDuration, each value or target function.
refreshOnSuccess defaults true.

onClick receives the original row and optional DataTableMutationContext containing
signal and operationId. Return/await a promise when the operation is asynchronous;
a discarded promise cannot be tracked. Visibility is not authorization.

DataTableRowActions is also available from the table subpath. Its runtime props are
row/actions and optional rowId/mutationRunner/onRefresh/mutationBoundaryKey.
A shared runner is preferred inside an organism. A standalone local runner uses
the supplied boundary key plus the integrated authorization boundary.

## Bulk Targets Are Explicit

DataTable's bulkActions receives { scope: 'page', rows, rowIds } projected from
selected rows in the current accepted/rendered page. This includes only the
current page even if externally controlled selection retains other IDs.
Selection changes when query/page/source scope changes; see
[selection and export](./export-and-selection.md).

DataTableBulkAction<T> has the same action definition but its target is a
selection, not a row. DataTableBulkActions accepts selection/actions and optional
mutationRunner/onRefresh/mutationBoundaryKey/ariaLabel/className. The label
defaults "Selected row actions".

Advanced standalone composition may use DataTableAllMatchingBulkSelection<Target>
with scope='all-matching', target, selectionKey and total. This requires an app/
backend-supported executable target. DataTable does not automatically construct
it, infer it from page IDs, or issue an unbounded operation.

## Shared Mutation Runner

```tsx
import { useDataTableMutationRunner } from '@zero/framework/components/data-table';

const runner = useDataTableMutationRunner({ refresh: reloadRows });
await runner.run({
  key: 'publish-selected',
  kind: 'bulk',
  execute: async ({ signal }) => { await publishSelection(signal); },
});
```

This hook fragment belongs inside React and assumes caller-owned reloadRows/
publishSelection. Options are boundaryKey, refresh, failureMessages and
showErrorToast. The default toast can be disabled when a parent owns presentation.
The runner exposes boundaryKey, run, retry, isPending, getError and clearError.
An operation has key, kind ('cell'/'row'/'bulk'), execute, optional refresh and
refreshOnSuccess. Same in-flight key shares one promise; unrelated keys remain
independent. Use collision-free/stable keys for app operations.

Confirmation cancellation is silent. Execute failures report safe generic UI text
and frontend.mutation.failed with surface/kind/stage metadata. After accepted
execution a failed refresh is distinct: retry performs only refresh.
Pending maps/errors clear across authorization/source boundaries and unmount;
late outcomes cannot settle another scope's action. This cannot undo a completed
external operation; server idempotency and permission checks remain necessary.

The hook/controller's internal error classes are not automatically named public
exports from the table barrel. Public runner failures expose their observed code/
message; do not import private files to branch on unsupported classes.
Standard lifecycle codes include DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE,
DATA_TABLE_MUTATION_CANCELLED and DATA_TABLE_MUTATION_RETRY_UNAVAILABLE.

## Verification

Test synchronous/async callbacks, duplicate clicks, disabled reasons, destructive
confirmation cancellation, accepted write plus failed refresh, explicit page vs
all-matching targets and late scope/unmount completion. Do not copy rejected row
values, provider errors, tokens or permission-bearing payloads into observability.

## Related Guides And Next Steps

- [Editing](./editing.md) uses the same lifecycle for cell commits.
- [Selection/export](./export-and-selection.md) defines safe operation targets.
- [Controls](./controls.md) offers compact action outlets.
- [Guardian RBAC](../../../backend/guardian/rbac.md) owns server authority.

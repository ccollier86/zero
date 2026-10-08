---
id: zero.frontend.data-controls.crud-page
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: crud-page
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Generated Schema-Backed CRUD

[Data controls index](./index.md) · [Documentation index](../../index.md)

CrudPage produces a collection-backed management screen with generated create,
edit and delete flows. Choose table layout for modal editing, or master-detail
layout for a selected-record sidebar and bottom action bar. For arbitrary server
sources use DataTable/MasterDetail directly: CrudPage's public interface takes a
collection table name, not a general source prop.

## Minimal Fragment

```tsx
import { CrudPage } from '@zero/framework/react';

<CrudPage
  table="tasks"
  schema={tasks.schema}
  columns={['title', 'done']}
  title="Tasks"
  createLabel="New task"
/>;
```

This fragment assumes configured client/provider, schema and admitted collection
writes. CrudPage is public from the root/React barrel; there is no declared
@zero/framework/components/crud-page subpath.

## Public Configuration

Required table/schema/columns select the collection and presentation fields.
primaryKey overrides descriptor identity. resourceFields carries the shared
resource field-access contract so generated columns/forms avoid disallowed fields;
backend field policies remain authoritative.

layout defaults 'table'; 'master-detail' composes the split panel.
lazy defaults false; filters and lazyOptions configure demand-loaded collection
queries rather than create an isolated server-query source.
createFields/editFields are name-to-overrides maps with autoFocus/hidden/useSwitch.
editableFields controls master-detail form fields. formColumns defaults 2.

title/emptyState customize presentation; createLabel defaults "Create".
searchable/sortable/paginated pass through to the generated table. tableToolbarSlots/
tableToolbarLabel retain the shared controls. toolbar is an extra caller element
near create controls, not a backend configuration surface.

hideCreate/hideEdit/hideDelete remove UI commands only. rowActions adds custom
row operations alongside the generated ones. modalSize defaults 'lg'
(sm/md/lg/xl accepted). onRowClick observes table clicks/master-detail selection.
onBeforeCreate(data) and onBeforeUpdate(id, changes) are synchronous transforms;
onAfterCreate(row)/onAfterDelete(id) are accepted follow-up callbacks.

Master-detail options are detailHeader, detailFooter, navigationActions,
primaryAction, submitLabel, listWidth/detailWidth plus className.
Use the detail panel for fields/information and the bottom bar for compact record
commands. The generated create workflow uses the primary action unless app
configuration supplies a different one; inspect the intended composition.

## Acceptance And Failure

Generated create/update/delete use acknowledged source actions, not optimistic
void methods. The form/modal remains pending until acceptance. Create ensures the
schema primary key before submission; update strips the primary key from changes.
Destructive delete uses confirmation. Missing writers or replaced scope fail
closed, and duplicate/pending work is not silently repeated.

The unreleased structured-modal integration uses `modals.show` with managed
AutoForm bodies for create/edit. One manager header and native footer replace
the older free-form dialog content; Save/Discard/Stay retains the same draft.
Delete uses `actionConfirm`, so the held destructive action, Cancel and close
controls remain locked until its acknowledged remove operation finishes. A
rejected delete stays open with safe actionable feedback; deciding to delete is
not itself write acceptance. Both layouts share this contract.

Success feedback, follow-up callbacks and exact-modal closure occur after accepted
writes. If an accepted follow-up throws, the write is not recast as failed or
reissued. A create modal finishing late cannot close a newer modal.
`onAfterCreate` and `onAfterDelete` may return promises. Their best-effort
notifications are observed without holding write acknowledgment or dialog
closure; synchronous and asynchronous failures use a safe follow-up message and
standard observation code. A retired page/source/account incarnation suppresses
late notifications rather than reporting them into a replacement scope.
Transform/write failures use the common safe frontend mutation presentation and
observability, not raw row/provider payloads. Scope changes and unmount prevent
late UI success in the new context; they cannot roll back accepted server effects.
Page/source teardown retires only its owned dialogs. Form/modal cancellation is
coupled to the existing mutation runner's signal, with source and server
authorization still responsible for actual write admission. It does not imply
generic collection CAS or rollback of already accepted work.

App-specific custom row/navigation callbacks remain app-owned complete operations.
Return promises and use the public mutation runner where pending/refresh/error
lifecycle is required. Visibility and resourceFields do not grant write permission.

## Verification

Test both layouts, custom keys, lazy loading/errors, transforms, delayed/rejected
writers, accepted follow-up failures, duplicate submissions and scope/unmount/
modal replacement. Tests for generated accepted lifecycle are focused dirty-source
evidence, not a broad migration/installed-package qualification.

## Related Guides And Next Steps

- [MasterDetail](./master-detail.md) owns selected-record/context layout.
- [Actions](./data-table/actions.md) owns reusable async operation composition.
- [Forms](../forms/index.md) owns generated logical validation and encoding.
- [SDK receipts](../sdk/acknowledged-mutations.md) owns exact write acceptance.

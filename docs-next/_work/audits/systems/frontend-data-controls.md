---
id: zero.inventory.frontend-data-controls
type: inventory
audience: [agent, maintainer]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Data Tables, Master-Detail, CRUD, Kanban, And Studio Controls

[System inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity And Verification Boundary

Framework `@zero/framework` 2.1.1 source baseline is committed `main` at `a3a5f726768dac890f241a3899c0a1acb66265d9`; inspection date 2026-10-04. The baseline commit was clean. The shared working tree now also contains separately authorized source/test corrections; this inventory's baseline claims remain pinned to the commit unless a supplemental correction is stated. This draft inventory is source-observed and awaiting independent reconciliation. It does not qualify an installed package, wider version range, production browser, or every Guardian/Fabric mode. No application imports, environment files, Doctor, provider requests, live databases, or app scripts were executed. “Tests present” means located, not passed. Planned destinations are plain paths relative to `docs-next/`.

## Purpose And Terminology

Owns schema-aware data organisms, source/query/controller composition, editing/selection/actions and reusable controls. Backend Resources/Sync/Fabric/Guardian own data exposure/authorization; Data Studio and Storage Studio services own their control-plane contracts. Shared UI does not merge those services.

## Features And Documentation Coverage

| Feature | Exact public surface/source evidence | Canonical planned guide |
| --- | --- | --- |
| DataTable/DataTableView composition | DataTableProps and schema source integration; [src/components/data-table/data-table.tsx](../../../../src/components/data-table/data-table.tsx), [src/components/data-table/data-table-types.ts](../../../../src/components/data-table/data-table-types.ts) | [Table entrance](../../../frontend/data-controls/data-table/index.md) |
| Source adapters | useDataTableSource/buildDataTableLazyQuery/DataTableSource and source/action/state types; [src/components/data-table/data-table-source.ts](../../../../src/components/data-table/data-table-source.ts) | `frontend/data-controls/data-table/sources.md` |
| Isolated server queries | createDataTableApiAdapter/buildDataTableServerQuery/DataTableServerSourceError and server offset/cursor/page/query/adapter/result types; working DataTableServerChange and optional subscribeChanges/prefetch metadata are separately noted below; [src/components/data-table/data-table-server-types.ts](../../../../src/components/data-table/data-table-server-types.ts), [src/components/data-table/data-table-server-query.ts](../../../../src/components/data-table/data-table-server-query.ts) | `frontend/data-controls/data-table/server-sources.md` |
| Headless columns/state/sizing | useDataTable and column override/cell/state/result types; [src/components/data-table/use-data-table.ts](../../../../src/components/data-table/use-data-table.ts) | `frontend/data-controls/data-table/state-and-columns.md` |
| Controls/toolbar/search/pagination | DataTableControls/Toolbar/Search/Pagination/ColumnHeader; exact Props/Options/slot/context exports; [src/components/data-table/index.ts](../../../../src/components/data-table/index.ts) | `frontend/data-controls/data-table/controls.md` |
| Table motion and reading-safe arrivals (working addition) | motion/liveUpdates, DATA_TABLE_MOTION, DataTableNewRecordsButton and props; [src/components/data-table/data-table-types.ts](../../../../src/components/data-table/data-table-types.ts), [src/components/data-table/data-table-motion-tokens.ts](../../../../src/components/data-table/data-table-motion-tokens.ts), [src/components/data-table/data-table-new-records-button.tsx](../../../../src/components/data-table/data-table-new-records-button.tsx) | [Motion and live updates](../../../frontend/data-controls/data-table/motion-and-live-updates.md) |
| Inline editing/cells | AnimatedCell/EditableCell; source writer vs onCellEdit/onCellCommit and keyboard/save lifecycle | `frontend/data-controls/data-table/editing.md` |
| Row/bulk actions | DataTableRowActions/DataTableBulkActions/useDataTableMutationRunner; RowAction/BulkAction/MutationContext/Runner/PageBulkSelection/AllMatchingBulkSelection | `frontend/data-controls/data-table/actions.md` |
| CSV export/selection | DataTableView composition and loaded row selection; source-owned server pagination boundary | `frontend/data-controls/data-table/export-and-selection.md` |
| Master-detail view/page | MasterDetailPage/MasterDetailView and props/render context; [src/components/master-detail/master-detail-page.tsx](../../../../src/components/master-detail/master-detail-page.tsx) | `frontend/data-controls/master-detail.md` |
| Generated CRUD page | CrudPage/CrudPageProps, resourceFields, table/master-detail modes; [src/components/crud-page/crud-page.tsx](../../../../src/components/crud-page/crud-page.tsx) | `frontend/data-controls/crud-page.md` |
| Kanban | KanbanBoard/KanbanTaskCard/groupKanbanItemIds/projectKanbanMove and move/target/input/result types; [src/components/kanban/index.ts](../../../../src/components/kanban/index.ts) | `frontend/data-controls/kanban.md` |
| Data Studio UI/helpers | All DataStudio* controls/dialogs and value/key-action helpers individually in catalogs; [src/components/data-studio/index.ts](../../../../src/components/data-studio/index.ts) | `frontend/data-studio/index.md` |

## Public Surface And Integration Map

Component/hook/support catalogs enumerate subpath-only pieces as well as root/react. DataTable subpath includes AnimatedCell/EditableCell; do not assume all public subcomponents are named in the root barrel. MasterDetail has explicit /components/master-detail; CrudPage is root/react, not an invented /components/crud-page route. Data Studio dialogs/value helpers can be subpath-only.

Data source precedence is explicit source, then collection/lazy, then caller data. Full/lazy sources use SDK auth and reactive state; server queries stay isolated with scope/abort fences. Editing promises require an authoritative writer; onCellCommit replaces source write, while legacy onCellEdit can notify after source writes or act as array writer. Loaded-page selection/export is not an implicit “all server matches” operation. UI pagination/sorting/filtering does not authorize backend fields. MasterDetail/CRUD share schema primary keys, source controls, AutoForm and modal confirmation. Studio UI calls dedicated revisioned command APIs, not raw browser SQL/DDL.

## Configuration Inventory

| Exact option group | Defaults, resolution and effects |
| --- | --- |
| DataTableProps schema/source/data/collection/lazy/filters/lazyOptions/primaryKey | schema required; source wins legacy props; lazy=false; render/query-time. Backend plane/exposure still authoritative. |
| columns/editable/columnOverrides/tableLayout | schema fields/PK; editable=[], tableLayout=auto; overrides header/cell/width/minWidth/maxWidth/flex/wrap/truncate/sortable/filterable/editable. |
| searchable/sortable/filterable/filterColumns/paginated/selectable | DataTable defaults: searchable=false, sortable=true, filterable=false, filterColumns=omitted, paginated=true only for explicit server source, selectable=false; pageSize fallback20. Standalone DataTableToolbar defaults searchable=true. MasterDetail defaults searchable=true and, after the dirty correction below, paginated=true for server sources/false otherwise. Do not merge those component defaults. |
| state/initialState/onStateChange | Partial controlled state facets; scope/source partition resets; not arbitrary persisted server preferences. |
| actions/bulkActions/onSelectionChange/onCellEdit/onCellCommit/onRowClick/onRowDoubleClick/highlightedRowId | Awaited actions/mutation runner support abort/acceptance; writer override is not duplicate write. |
| toolbarActions/toolbarSlots/toolbarLabel/toolbarClassName/showToolbar | Table-aware slots; controls/actions/supplemental shared shell; derived toolbar visibility. |
| exportFilename/showExport/showColumnVisibility/emptyState/loadingState/errorState/getRowClassName/className | export.csv/true/true defaults; rendering/export options, loaded-page boundary. |
| DataTableSource | data/collection/lazy/server discriminated sources; server pagination offset/cursor, query/adapter/result contracts at server-types declaration. |
| motion/cellMotion/liveUpdates (working addition) | table presentation defaults true where supported; eligible existing text defaults to bounded typewriter replacement; motion opt-out/reduced motion distinct from source invalidation/authority. |
| server prefetch/adapter.subscribeChanges/confirmInsertedRows (working addition) | prefetch defaults true for known pages; query-bound genuine change callback; accepted-page or bounded authoritative membership evidence, no inferred unseen totals. |
| MasterDetailPageProps | schema/listColumns, source/data/collection/lazy, selection controlled/default/autoSelectFirst, detail header/body/footer/content, update callbacks, navigation, toolbar/search/sort/page/form/layout options; source declaration authoritative. |
| CrudPageProps | table/schema/columns, resourceFields, table/master-detail layout, lazy/filter/options, create/edit fields, callback transforms, hide actions, modal labels/sizes, detail/navigation/layout options. |
| KanbanBoardProps | Schema/data/grouping/move/render configuration and callbacks from source; IDs/group utilities do not grant backend write authority. |
| DataStudio* props/options | Public controller/permission/schema/revision/readiness and rendering interfaces at catalog source rows; owning Studio inventory defines backend settings. |

Planned `frontend/data-controls/configuration.md`, DataTable focused option reference and separate Studio settings. These are client/query/render-time props; Doctor source/config audits do not simulate UI acceptance, server pagination or browser cache races.

### Working Table Motion And Source Evidence — 2026-10-07

The explicitly marked working additions above were observed against published
framework 2.6.0 baseline `5aa2a34a47c7bc05b0c6f01849fdbf477dc01ea8` plus the current
dirty worktree. This does not relabel the historical clean 2.1.1 inventory or
declare that the published 2.6.0 archive includes them. Their public homes are
[motion/live updates](../../../frontend/data-controls/data-table/motion-and-live-updates.md)
and [server sources](../../../frontend/data-controls/data-table/server-sources.md).
The server cache/event/hook source gate passed 50 tests/193 assertions including
13 controlled browser cases, and the actual frontend Markdown example gate
passed 1 test/79 assertions. These synthetic source checks are not installed-
archive or live-application qualification; the independently owned row-motion/
organism acceptance gates remain separate.

## Evidence And Verification

Tests present: [src/components/data-table/data-table-source.test.ts](../../../../src/components/data-table/data-table-source.test.ts), [src/components/data-table/data-table-server-request-coordinator.test.ts](../../../../src/components/data-table/data-table-server-request-coordinator.test.ts), [src/components/data-table/data-table-state.test.tsx](../../../../src/components/data-table/data-table-state.test.tsx), [src/components/kanban/kanban-utils.test.ts](../../../../src/components/kanban/kanban-utils.test.ts), [src/components/kanban/kanban-board-rendering.test.tsx](../../../../src/components/kanban/kanban-board-rendering.test.tsx), [src/frontend/client/data-studio-hooks.test.ts](../../../../src/frontend/client/data-studio-hooks.test.ts). Additional adjacent source/control tests need reconciliation with each feature's scenario. Examples guardian-fabric-proof and source examples. Research [docs/frontend/data-table.md](../../../../docs/frontend/data-table.md), [docs/frontend/master-detail.md](../../../../docs/frontend/master-detail.md), [docs/frontend/kanban.md](../../../../docs/frontend/kanban.md), [docs/data-studio.md](../../../../docs/data-studio.md).

## Findings, Philosophy, And Known Future Plans

- Verification gap: action acceptance, scope replacement, cursor adapters, keyboard editing, controlled state and every source mode were not executed here.
- Source-backed Kanban boundary: KanbanBoard.tsx calls onItemMove synchronously and remains caller-controlled. Group/project helpers do not persist moves or await server receipts; do not infer that stronger mutation guarantee from other data organisms.
- Source/release boundary: 2.1.1 carries 2.1.0 additive table APIs; exact artifact and compatibility claims need qualification, not inferred from current source.
- Packaging test-wildcard exposure is recorded in component/package inventories; exported tests are not UI features to teach.
- Established principle: one schema and source-aware data layer compose reusable controls without duplicating authenticated transport.
- [docs/platform-roadmap.md](../../../../docs/platform-roadmap.md) records richer data control/editor/calendar work; existing DataTable/Kanban/Studio controls must not be described as missing.

## Independent Source Reconciliation

Reviewed independently on 2026-10-05 against source resolution, TanStack manual-query wiring, query/response validation, toolbar slots, selection/cursor/page metadata, source actions and CRUD/master-detail composition. The three frontend symbol catalogs now agree with this inventory's focused sources, server-sources, state/columns, controls, editing and action homes. The [nine-file frontend reconciliation run](./frontend-sdk.md#independent-source-reconciliation) passed table query normalization, manual server row-model bypass, partial controlled state, column sizing, custom row identity and master-detail selection tests; this is not complete browser/action/server-source qualification.

Two original acceptance defects were traced beyond the already corrected useForm hook: MasterDetail's default submit wrapper discarded `liveActions.update()`'s returned promise, and CrudPage create/update/delete callbacks immediately announced success around optimistic void collection methods. Both are corrected in the authorized dirty working tree as detailed below. Low-level optimistic hook methods remain an intentional SDK API, not themselves a defect.

## Supplemental CrudPage Acceptance Closeout

The independent UI owner corrected generated table/master-detail create/update/delete to use the acknowledged source actions and a focused shared [CRUD mutation hook](../../../../src/components/crud-page/use-crud-mutation.ts). Callbacks now await acceptance before toast/after-create/delete notifications and exact-modal closure. Pending/duplicate, scope and unmount fences prevent stale completion; transform failures use the existing mutation runner's safe `frontend.mutation.failed` presentation. A notification callback failure after an accepted write is distinguished from a failed write, and closing a create modal cannot accidentally close a newer modal.

The reproduction replayed the original pinned create callback extracted from its syntax tree and confirmed it returned no receipt, immediately reported success/called onAfterCreate/closed the modal after one optimistic write. This is precise callback-level evidence, not a full clean-historical browser run. The owner's final `bun --no-env-file test src/components/crud-page/crud-page.browser.test.ts` run passed **17 tests, 0 failed, 77 assertions** using synthetic SDK receipts with no network or live application data. See [CrudPage source](../../../../src/components/crud-page/crud-page.tsx) and [browser regressions](../../../../src/components/crud-page/crud-page.browser.test.ts). Exact packaged qualification remains separate.

## Supplemental MasterDetail Server And Write Closeout

The original MasterDetail accepted the complete DataTable source union but resolved server data with a fixed default query, then passed the accepted page to a browser-array DataTable. Search/sort/page controls therefore did not drive server requests, pagination invented a total from page rows, and loading hid the toolbar. Custom numeric IDs also disagreed with detail selection, and default write wrappers could signal a successful no-op or complete after a source replacement.

The dirty correction extracts a shared source/query/state/cursor/manual-row-model controller in [use-data-table-controller.ts](../../../../src/components/data-table/use-data-table-controller.ts). [DataTable](../../../../src/components/data-table/data-table.tsx) and [MasterDetailPage](../../../../src/components/master-detail/master-detail-page.tsx) consume one controller and accepted ordered result rather than installing a second fetch or browser filtering pass. Selection consumes the accepted result, supports the same custom numeric identity, and resets with source partitions. MasterDetail keeps server controls mounted while loading and enables server pagination by default without changing the array/collection/lazy default. Missing detail writers reject using the existing `DATA_TABLE_MUTATION_ACTION_UNAVAILABLE`; retained or mid-flight replaced source contexts reject with `DATA_TABLE_MUTATION_SCOPE_UNAVAILABLE`. Custom `onUpdate` retains precedence and both generated forms and `renderContext.update` await acceptance/rejection.

Reproduction built the original pinned MasterDetail module into an otherwise current, synthetic in-memory browser fixture; all **six original scenarios failed**. This is a module-level regression reproduction, not a test of an entire clean historical artifact. That temporary build override was removed after the recorded run. The final regression file adds a seventh pending-completion fence scenario.

Executed on Bun 1.3.14 with env-file loading disabled:

```sh
ZERO_TEST_SCRATCH_ROOT=/Volumes/code-bank/tmp/scratch/zero-platform bun --no-env-file test src/components/data-table/data-table-server.browser.test.ts src/components/master-detail/master-detail.browser.test.ts src/components/data-table/data-table-source.test.ts src/components/master-detail/master-detail-selection.test.ts
```

Result: **25 passed, 0 failed, 76 assertions across four files**. The existing full DataTable browser suite covers query races, offset/cursor metadata, adapter/source partitions, sizing and accepted edits alongside the new MasterDetail scenarios. A separate table-state/SSR/selection run passed 16 tests/52 assertions. All rows/adapters/HTML were synthetic; only isolated test scratch was created/cleaned by the existing table harness. No application data, real database, provider or deployed app was used. New shared controller/view/selection exports are internal module bindings, not new public package imports. Exact package and broader mode qualification remain outstanding.

## Navigation And Completion Review

### Partial Controlled Facets Independent Closeout

Root reproduced undefined partial control props replacing local defaults,
including an SSR pagination crash and erased initial search (4 passed / 2 failed).
The private merge now omits only undefined facets in both candidate and final
state construction; no public API or invalid typed-null contract was added.
Independent source review and public-hook/state/Progress rerun passed 17 tests /
65 assertions. Manual server pages remain untouched by local filtering, and
defined empty values still have controlled precedence. This is synthetic
SSR/null-rendered hook evidence, not a browser or installed-artifact certificate.

### Supplemental Headless Search Shorthand Correction

The public UseDataTableOptions.globalFilter declaration was ignored by its
hook implementation. Actual public-facade SSR/null-hook cases reproduced
1 passing / 3 failing checks. Working source now seeds initial search through
the same state owner as pageSize: explicit initialState.globalFilter (including
empty string) and controlled state.globalFilter win; local setters still work,
later shorthand props do not reseed, and manualQuery does not filter an accepted
server page again. No callback/public method or API shape changed.

Executed 2026-10-05: `bun --no-env-file test
src/components/data-table/use-data-table-filter.test.tsx
src/components/data-table/data-table-state.test.tsx` — **10 passed / 30
assertions**. Tests use only synthetic rows, public source facade and in-memory
React, no app/client/query/database/browser. This is dirty development evidence,
not package-qualified release behavior. The state-and-columns draft describes
the corrected precedence rather than documenting a no-op.

### Supplemental Accepted Edit Notification

The legacy onCellEdit path is intentionally dual-purpose: an authoritative writer
for an array source without actions, but a follow-up notification after a source
update when that writer exists. Detailed tracing reproduced a throwing follow-up
being classified as a failed cell mutation, exposing Retry for an already
accepted source update. Original actual-table regression: **1 passed / 1 failed**.

The correction observes the follow-up separately after source acceptance, emits
only standard frontend.mutation.failed accepted-callback metadata with safe
toast feedback, and checks source partition/abort before notification reporting.
It preserves the no-source-action array writer and authoritative onCellCommit
precedence. A rejected notification cannot make the runner reissue an accepted
source update. Async follow-up completion after unmount is silent.

The final standalone in-memory real-table fixture passes **3 tests / 0 failed /
15 assertions**; the earlier two-case + numeric-inline combined run passed four
tests/25 assertions. Fixtures use only synthetic source promises/rows and a local
observability sink, never app/provider/live data or disk bundles. See
[DataTable](../../../../src/components/data-table/data-table.tsx),
[fixture](../../../../src/components/data-table/data-table-notification.browser-fixture.tsx)
and [regressions](../../../../src/components/data-table/data-table-notification.browser.test.ts).
Current global typecheck completed with exit0 before adding the third test-only
unmount case; final freeze/package qualification remains distinct.

### Supplemental Numeric Inline Clear

Known optional numeric fields now emit explicit null from the shared inline
editor rather than an empty string/drop-patch undefined. The separate synthetic
actual EditableCell fixture validates through the declaration and waits for its
writer. Its old stored value remains until acknowledgment; accepted null persists
and reopens blank. Required clear emits a blank invalid value, remains rejected
and does not report acceptance or lose its previous number. This uses existing
editor/mutation lifecycle behavior; metadata does not become server validation.

`bun --no-env-file test src/components/data-table/editable-cell-numeric.browser.test.ts`
passed **2 tests, 0 failed, 13 assertions** using an in-memory browser build with
no app/provider/live data or disk fixture. The broader [Schema closeout](./schema.md#supplemental-schema-correction-and-detailed-draft-closeout)
also proves null through JSON, server logical validation, fresh SQLite storage
and reactive change delivery. This is dirty-source regression evidence, not a
claim about an already published artifact.

Planned section entrance/configuration/roadmap and per-feature homes above require their parent indexes, contextual links and useful reciprocal guides. Keep these working inventories out of public publication. See the [process](../../../documentation-process.md) and [standards](../../../documentation-standards.md).

- [x] Source-backed feature groups, public routes, and planned homes recorded.
- [x] Tests present, source inspection, and execution claims distinguished.
- [x] Findings and uncertainties recorded without documenting defects away.
- [x] Independent targeted feature/default/import reconciliation.
- [ ] Whole-platform reconciliation and discovered-defect closeout.
- [ ] Exact-package/export/example/mode qualification.
- [x] First-draft feature guides, configuration, indexes and roadmaps placed.
- [ ] Whole-set guide review, public projection and publication qualification.

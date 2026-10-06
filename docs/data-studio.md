# Data Studio: Organization-Owned Logical Tables

Data Studio is Zero's optional, first-party control plane for creating and
editing bounded, structured application datasets at runtime. It is intended for
organization-owned function, Torrent workflow, automation, and agent state:
for example, a Pantheon workspace can create a `customers` or
`workflow_memory` table without receiving SQLite paths, raw SQL, or authority
over another workspace's database.

Data Studio is a logical table system. It does **not** add arbitrary physical
SQLite tables at request time. Every organization uses the same fixed,
versioned physical schema inside its Fabric database; logical schemas and rows
are validated data stored through named Fabric queries and commands. That
choice keeps actor realms deterministic, ReactiveDB changes observable, and
Guardian/Fabric authority enforceable.

The feature is opt-in. Installing none of its fragments changes nothing.
Installing only part of it fails startup with `DATABASE_CONFIG_INVALID`.

## Ownership And Security Model

The complete request path is:

```text
Guardian session or user API key
  -> live organization membership and permission check
  -> server-derived tenant scope
  -> Fabric-selected organization database
  -> scope-closed zero.data capability
  -> DataStudioService
  -> registered actor query/command
  -> fixed ReactiveDB tables
```

Important invariants:

- Data Studio requires an active Guardian customer-organization or
  administration-organization membership. An administration organization can
  own and manage its own Data Studio tables; platform authority alone never
  grants access to another organization's data. Data Studio is not a
  global-user table store and it does not accept a tenant ID, database ID,
  database path, or Fabric reference from the browser.
- Fabric selects the physical database from committed server authority. URL
  parameters, request bodies, headers, logical table keys, and row values
  cannot select a database.
- The public routes accept session and Guardian user API-key credentials. The
  same live membership and RBAC authority applies to both. Guardian currently
  issues tenant-bound user API keys only for customer organizations; the
  protected administration organization uses a live session.
- `data-studio:read`, `data-studio:write`, and `data-studio:manage` are
  tenant-scoped Guardian permissions. UI capability checks improve
  presentation; the server remains authoritative.
- Platform-administration authority is not implicit cross-organization data
  access. A platform operator must enter a live target-organization membership
  and receive its Data Studio permission through normal Guardian policy.
- Physical rows retain `created_by_*` and `updated_by_*` user/membership IDs.
  Fabric's Guardian identity projection supplies only the required ID anchors
  to each organization database. Profiles, credentials, sessions, membership
  state, and role authority remain in `systemDb`.
- Mutations are registered Fabric commands. Direct Sync writes to every Data
  Studio physical table are protected.
- Admitted handler/domain failures use stable `DATA_STUDIO_*` codes and fixed
  messages. Malformed JSON and Elysia request-shape failures are rejected
  before a Data Studio handler as `ZERO_REQUEST_PARSE_FAILED` (400) and
  `ZERO_REQUEST_VALIDATION_FAILED` (422), respectively. Rejected bodies and
  schema details are never reflected. A handler response that violates its
  declared response contract fails as `ZERO_RESPONSE_VALIDATION_FAILED` (500)
  and emits the safe `APP_RESPONSE_VALIDATION_FAILED` event without reflecting
  the response body. Error responses and Data Studio observability metadata do
  not reflect logical row values, table names, SQL, paths, tenant/user IDs, or
  idempotency keys.

Data Studio does not turn possession of a table ID into authority. The active
organization database is selected first; the ID is resolved only inside that
database.

## Physical And Logical Model

Each installed organization realm contains five fixed tables:

| Physical table | Exposure | Purpose |
| --- | --- | --- |
| `data_studio_tables` | HTTP + Sync metadata; dedicated API for full reads | Logical catalog and current schema. The generic projection carries catalog metadata/revisions but omits `schema_json`. |
| `data_studio_rows` | HTTP + Sync metadata; dedicated API for full reads | Canonical aggregate row storage. The generic projection carries row identity/revisions but omits `values_json`. |
| `_data_studio_schema_versions` | Internal | Immutable logical-schema history. |
| `_data_studio_cells` | Internal | Typed cell projections used for filtering, sorting, and exact value bookkeeping. |
| `_data_studio_column_stats` | Internal | Per-column counts and the permanent stable-column-ID registry used by safe schema evolution. |

Rows and their typed cell projections change in one actor transaction. The
logical row's `(table_id, row_id)` identity is local to one logical table, so
two logical tables may use the same `rowId` without colliding.

A logical schema has version `1` and an ordered list of columns:

```ts
import type { DataStudioSchema } from '@zero/framework/data-studio';

export const contactsSchema = {
  version: 1,
  columns: [
    {
      columnId: 'contact_name_v1',
      key: 'name',
      label: 'Name',
      type: 'text',
      required: true,
    },
    {
      columnId: 'contact_active_v1',
      key: 'active',
      label: 'Active',
      type: 'boolean',
      required: true,
      defaultValue: true,
    },
  ],
} as const satisfies DataStudioSchema;
```

The supported column types are `text`, `number`, `boolean`, `date`,
`datetime`, and JSON. Dates use canonical `YYYY-MM-DD` strings; datetimes are
normalized to UTC. Values are strict, bounded JSON values: accessors, sparse
or extended arrays, unsafe prototype keys, non-finite numbers, cycles,
and unsupported object prototypes fail validation. Service requests are also
detached before actor dispatch, rejecting non-cloneable executable shapes.

`columnId` is the immutable storage identity. `key` is the stable public field
name used by create/replace/filter requests and may be changed deliberately
during schema evolution. Returned `DataStudioRow.values` are keyed by
`columnId`; use `dataStudioRowValuesByKey(row, table.schema.columns)` when a
function needs the public-key projection, or `dataStudioCellValue(row,
columnId)` when absence must remain distinct from stored `null`.

The logical table `key` is immutable and intended for functions, workflows,
and configuration. Its display `name` and description can change.

## Complete Installation

Data Studio is designed for Guardian multi-tenancy with Fabric physical tenant
databases and advanced authorization. Compose every fragment from the same
feature into the app config, actor realm, and browser catalog.

Before generic Resource-registry validation, Zero treats any Resource backed
by one of Data Studio's five physical table names as an installation request.
That preflight requires all of the following:

- Guardian auth is enabled;
- `auth.tenancy.mode` is `multi`;
- `auth.authorization.mode` is `advanced`;
- `databaseTopology.mode` is `multiple`;
- `databaseTopology.tenantIsolation` is `tenant-database`.

An unsupported profile fails startup with the safe, non-retryable
`DATABASE_CONFIG_INVALID` Data Studio installation error. Merely declaring an
application table with a matching name does not opt in; a Data Studio Resource
declaration is the signal. Once signaled, the later complete-fragment admission
still requires every Data Studio table and the exact official Resource
contracts. Spread `dataStudio.resources` (or `DATA_STUDIO_RESOURCES`) unchanged;
do not recreate, extend, narrow, rename, or override those declarations.
Startup compares the normalized Resource name, table, primary key, exposure,
realm, actions, field allow-lists, and policy. A missing or altered contract
fails closed with `DATABASE_CONFIG_INVALID` before the router is mounted.
Admission also requires the exact official fixed table schemas, including their
Guardian reference metadata and mutation validators, and the original registered
Data Studio actor query/command handlers. Matching table or operation names do
not authorize substituted schemas or handlers.

`createDataStudioFeature()` groups the install fragments. The equivalent
named exports are `DATA_STUDIO_APP_TABLES` for `createApp()`,
`DATA_STUDIO_TENANT_TABLES` for raw realm schemas,
`DATA_STUDIO_CLIENT_TABLES` for `AppProvider`, `DATA_STUDIO_RESOURCES`,
`DATA_STUDIO_REALM_CONTRIBUTION`, `DATA_STUDIO_PERMISSION_REGISTRY`, and
`DATA_STUDIO_ROLE_FRAGMENTS`. Prefer the feature object in server config so a
fragment is harder to omit; use named constants in the side-effect-free realm
and client modules that cannot import a server factory.

| Feature property | Install target |
| --- | --- |
| `appTables` | Spread unchanged into `createApp()` / `defineZeroConfig({ tables })`; preserves catalog metadata as full Sync, row metadata as lazy Sync, and private tables as raw/server-only. |
| `tables` | Raw fixed realm schemas for lower-level realm work; never substitute `DATA_STUDIO_TENANT_TABLES` or this property for `appTables` in app config. |
| `resources` | Spread unchanged into the server Resource registry. Zero admits only the exact normalized official Resource contracts. |
| `realmContribution` | Compose with the app realm; equivalent to `DATA_STUDIO_REALM_CONTRIBUTION`. |
| `permissions` / `roleFragments` | Merge into advanced Guardian authorization under app-selected role keys. |
| `clientTables` | Browser table fragment; side-effect-free client modules normally import `DATA_STUDIO_CLIENT_TABLES` directly. |
| `router` | Focused tests or explicit standalone Elysia composition only; ordinary `createApp()` installs the router after complete admission. |

### 1. Compose the actor realm

Keep the realm module side-effect-free. Convert the existing app realm to a
contribution, then add the Data Studio contribution:

```ts
// db/tenant-realm.ts
import {
  composeDatabaseRealm,
  databaseRealmContribution,
  defineDatabaseRealm,
} from '@zero/framework/server';
import { DATA_STUDIO_REALM_CONTRIBUTION } from '@zero/framework/data-studio/server';
import { tenantServerTables } from './schema';
import { tenantCommands, tenantQueries } from './tenant-operations';

const appTenantRealm = defineDatabaseRealm({
  name: 'pantheon-tenant-app',
  version: '4',
  tables: tenantServerTables,
  queries: tenantQueries,
  commands: tenantCommands,
});

export const tenantDatabaseRealm = composeDatabaseRealm({
  name: 'pantheon-tenant-data',
  version: '5',
  contributions: [
    databaseRealmContribution(appTenantRealm),
    DATA_STUDIO_REALM_CONTRIBUTION,
  ],
});
```

Contribution order does not affect the resulting realm. Duplicate table,
migration, query, or command names fail composition. Bump the outer realm
version whenever the complete application realm contract changes; the Data
Studio contribution carries its own behavior version. Compose the official
`DATA_STUDIO_REALM_CONTRIBUTION` unchanged; recreating the same operation names
with replacement query or command handlers fails Data Studio startup admission.

### 2. Merge server tables, Resources, permissions, and roles

`createDataStudioFeature()` returns one immutable installation bundle. An app
chooses the final role keys; the role fragments are templates, not roles that
Zero silently installs.

```ts
// zero.config.ts
import { fileURLToPath } from 'node:url';
import { defineZeroConfig } from '@zero/framework/server';
import { createDataStudioFeature } from '@zero/framework/data-studio/server';
import { tables } from './db/schema';
import { tenantDatabaseRealm } from './db/tenant-realm';
import { resources } from './server/resources';
import { APP_PERMISSIONS, APP_ROLES } from './server/access';

const dataStudio = createDataStudioFeature();

export default defineZeroConfig({
  db: { mode: 'file', path: './data/application.db' },
  systemDb: { mode: 'file', path: './data/system.db' },

  tables: {
    ...tables,
    // createApp-ready wrappers preserve full catalog-metadata Sync and lazy
    // row-metadata Sync while keeping private tables server-only.
    ...dataStudio.appTables,
  },
  resources: [
    ...resources,
    ...dataStudio.resources,
  ],

  auth: {
    tenancy: { mode: 'multi' },
    authorization: {
      mode: 'advanced',
      // Increment this when permission/role semantics change.
      registryVersion: 6,
      permissions: {
        ...APP_PERMISSIONS,
        ...dataStudio.permissions,
      },
      roles: {
        ...APP_ROLES,
        'data-studio-viewer': dataStudio.roleFragments.viewer,
        'data-studio-editor': dataStudio.roleFragments.editor,
        'data-studio-manager': dataStudio.roleFragments.manager,
      },
    },
  },

  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-databases',
    realm: tenantDatabaseRealm,
    actors: {
      launch: {
        kind: 'source',
        entrypoint: fileURLToPath(new URL('./app/server.ts', import.meta.url)),
      },
    },
    tenantIsolation: 'tenant-database',
    placement: 'file',
    readers: true,
  },
});
```

For ordinary `createApp()` composition, do not also mount
`dataStudio.router`. Zero mounts the built-in
`/api/_zero/data-studio` router only after it sees every Data Studio table and
the exact normalized official Resource contracts plus every registered Data
Studio actor query and command. The fixed table schemas must retain their exact
columns, identities, Guardian metadata, and mutation validators; actor operation
names must still point to the official handlers. The two public app-table
wrappers must retain catalog `full` Sync and row `lazy` Sync. A partial or
altered table/Resource/handler/Sync contract fails startup with
`DATABASE_CONFIG_INVALID` instead of leaving a route that can reach a weakened
or incomplete realm. The returned router exists for focused tests and explicit
standalone Elysia composition.

The final actor realm must include the same Data Studio tables and operations.
`dataStudio.tables` remains the raw fixed realm-schema fragment;
`dataStudio.appTables` is the `createApp()` fragment carrying explicit client
sync modes. Using raw `DATA_STUDIO_TENANT_TABLES` in `createApp({ tables })`,
changing either public Sync mode, or omitting
`DATA_STUDIO_REALM_CONTRIBUTION` from `databaseTopology.realm` is invalid.

### 3. Use the composed realm in the actor entrypoint

The actor bootstrap and the topology must receive the exact same composed
realm:

```ts
// app/server.ts
import {
  createApp,
  runDatabaseActorIfRequested,
} from '@zero/framework/server';
import config from '../zero.config';
import { tenantDatabaseRealm } from '../db/tenant-realm';

if (!await runDatabaseActorIfRequested({ realm: tenantDatabaseRealm })) {
  const app = await createApp(config);
  app.listen(config.port ?? 3000);
}
```

Using the pre-composition app realm here can start the parent and then fail
child actors with an incompatible fingerprint or missing command registry.

### 4. Add the browser tables and control plane

Merge Data Studio's read-only tenant Sync fragment into the tables passed to
`AppProvider`. Catalog reconciliation metadata is full-sync and row
reconciliation metadata is lazy; complete schemas and values still come from
the dedicated Data Studio API:

```tsx
// app/layout.tsx
'use client';

import type { ReactNode } from 'react';
import { DATA_STUDIO_CLIENT_TABLES } from '@zero/framework/data-studio';
import { AppProvider } from '@zero/framework/react/app-provider';
import { tables } from '../db/schema';

const clientTables = {
  ...tables,
  ...DATA_STUDIO_CLIENT_TABLES,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <AppProvider
      url={typeof window === 'undefined' ? '' : window.location.origin}
      tables={clientTables}
      auth
    >
      {children}
    </AppProvider>
  );
}
```

Then place the packaged organism where authorized organization members should
manage logical data:

```tsx
'use client';

import { DataStudio } from '@zero/framework/components/data-studio';

export default function OrganizationDataPage() {
  return (
    <DataStudio
      title="Workspace data"
      description="Tables used by this workspace's functions and workflows."
      pageSize={25}
    />
  );
}
```

`DataStudio` loads server capabilities and adapts to read, row-edit, or
schema-management permission. Its optional `capabilities` prop can only narrow
the UI, such as `capabilities={{ canManage: false }}`; it cannot grant access.

## Packaged Table Workspace

The connected `DataStudio` defaults to a spreadsheet-style workspace. Schema
headers remain visible when a table has no records. Each header shows its name,
type and required marker; clicking it opens the column editor. Its visible menu
button and right-click menu offer the authorized edit, sort, reorder and remove
actions. Column resizing and wide-table scrolling stay inside the grid. An
add-column action is available at the end of the headers and in the bottom bar.

Records load in bounded batches as the grid scrolls, with virtualized rendering
for large loaded windows. `pageSize` sets the requested batch size, subject to
the server's row/byte limits; it does not download the whole table. Search,
filters and sorting remain server-owned. The workspace has loading, retry,
empty, end-of-results and refresh-required states, not page navigation buttons.
Previous/Next **record** actions in the bottom bar move through loaded records.

The optional inspector has **Record**, **Table**, and **Code** tabs. Record
shows complete selected values; Table shows the description, stable key,
record/column counts, revisions and lifecycle metadata; Code shows a copyable
typed SDK example. Schema editing stays in column headers and the full schema
dialog rather than a permanent list of schema cards.

| Presentation prop | Default | Behavior |
| --- | --- | --- |
| `defaultDetailsOpen` | `false` | Give the grid the full desktop width initially. |
| `detailsOpen` / `onDetailsOpenChange` | Uncontrolled | Control desktop inspector visibility. |
| `resizableDetails` | `true` | Allow desktop pane resizing while the inspector is open. |

These props also apply to `DataStudioWorkspace`. On mobile, editing a cell stays
in the grid; explicit record inspection opens the details view, with **Back to
records** to return. The bottom action bar remains reachable while either pane
scrolls. Its add-record, add-column, inspect, delete, archive and restore
controls follow server capabilities, selection, pending writes and table state.

Place the component in a bounded workspace. [AppShell content
modes](./frontend/app-shell.md#content-height-and-scrolling) and the shared
[master/detail composition](./frontend/master-detail.md#bounded-workspace-composition)
explain the public height/scroll pattern. A natural document page can instead
give the component an explicit height such as `className="h-[42rem]"`.

## Guardian Permissions

| Permission | Server authority |
| --- | --- |
| `data-studio:read` | Logical table/schema reads, row reads, search/filter/sort, and schema history. |
| `data-studio:write` | Create, replace, and delete rows in an active logical table. |
| `data-studio:manage` | Create/update logical tables and schemas, and archive or restore a table. |

The packaged role fragments are:

- `viewer`: read;
- `editor`: read + row write;
- `manager`: read + row write + schema management.

Apps select role keys, combine these fragments with app permissions when
needed, and follow Guardian's normal grant-ceiling and `registryVersion`
rules. Data Studio access does not implicitly grant permission to execute an
app function, start a workflow, manage Guardian members, or inspect a different
organization.

## Browser SDK

Every Zero browser client has a `client.dataStudio` surface. It uses
`client.fetch`, so access-token restoration, refresh, same-origin checks,
authorization-scope cancellation, and tenant-switch cache clearing stay in the
official SDK path.

```ts
const capabilities = await client.dataStudio.getCapabilities();
const tables = await client.dataStudio.listTables('active');
const table = await client.dataStudio.getTable(tables[0]!.tableId);

const created = await client.dataStudio.createRow(
  table.tableId,
  { name: 'Acme', active: true }, // public column keys
  { operationId: crypto.randomUUID() },
);

const page = await client.dataStudio.listRows(table.tableId, {
  limit: 25,
  search: 'Acme',
  filters: [{ columnKey: 'active', operator: 'eq', value: true }],
  sortColumnId: table.schema.columns[0]!.columnId,
  sortDirection: 'asc',
});
```

Main methods:

| Method | Result |
| --- | --- |
| `getCapabilities()` | Enabled state, exact read/write/manage grants, and server limits. |
| `listTables(status?)` | Bounded summaries; schemas are deliberately omitted. |
| `getTable(tableId)` | One table with its current schema. |
| `createTable(input, options)` | Create a logical table. |
| `updateTable(tableId, input, options)` | Rename, describe, or update a schema with an expected revision. |
| `setTableStatus(tableId, expectedRevision, status, options)` | Archive or restore. |
| `listRows(tableId, query?)` | Server search/filter/sort plus byte-aware paging. |
| `createRow(tableId, values, options)` | Create from public column-key values. |
| `replaceRow(tableId, rowId, expectedRevision, values, options)` | Replace the complete logical cell set. |
| `deleteRow(tableId, rowId, expectedRevision, options)` | Delete one row. |
| `listSchemaVersions(tableId, query?)` | Newest-first immutable schema history. |

`useDataStudio()` is the React controller used by the packaged component. It
owns catalog/table/row loading, authorization-scope partitioning, selection,
search, filters, sorting, bounded row loading, mutations, conflict reloads,
and capability-derived actions. Use `DataStudioWorkspace` with that controller
when the standard organism needs a custom outer shell. Lower-level exports
include `DataStudioGrid`, `DataStudioToolbar`, `DataStudioFilterControl`,
`DataStudioInspector`, and `DataStudioInlineCell`. The table, row, and
confirmation dialogs are also exported as `DataStudioTableDialog`,
`DataStudioRowDialog`, and `DataStudioConfirmDialog` for custom control planes.
The hook retains `rowLoading: 'paged'` as its default for existing custom
controllers; their `offset`, `previousOffset`, `nextOffset`,
`goToPreviousPage()` and `goToNextPage()` contracts remain available. Use
`useDataStudio({ rowLoading: 'progressive' })` when composing the new workspace.
The connected `<DataStudio>` chooses progressive mode by default. The general
[DataTable](./frontend/data-table.md) keeps its independent pagination modes.

Progressive controllers expose `hasMoreRows`, `isLoadingMore`, `loadMoreRows()`,
`loadMoreError` and `rowsNeedRefresh`. Their ordered result window is separate
from the shared record cache: rows loaded by another query are not membership
in this grid. Superseded queries and authorization-scope changes retire old
requests, rows and selection before replacement data becomes visible.

`listRows()` now supplies an optional `readSequence` from the same strong Fabric
read as its rows and count. Progressive continuation requires a contiguous,
unique window with the same sequence and total. If concurrent writes shift the
snapshot, the controller requires a refresh instead of silently skipping or
deduplicating records. Refresh rebuilds the previously loaded prefix in bounded
batches and publishes it atomically; one retry is allowed on snapshot drift.
The sequence is consistency metadata, not a credential or a database selector.
An older response without it can still be read as a single page, but cannot be
safely joined into a multi-batch progressive window.

`DataStudioToolbar` uses the same `DataTableSearch` control as Zero's table
toolbars. Search is the first control before table selection and filters,
collapses to 112 px, and expands to 216 px on focus or while a query is active.
The existing controller value/change contract is unchanged, so applications
using `DataStudio`, `DataStudioWorkspace`, or `DataStudioToolbar` do not need a
call-site rewrite.

## Visual And JSON Schema Editing

Table creation and full-schema editing share one draft with **Visual** and
**JSON** modes. Visual mode provides compact column selection, inline display
names, supported types, required state, descriptions, typed defaults and
reordering. JSON mode uses Zero's reusable [JsonEditor](./frontend/json-editor.md)
over the actual `DataStudioSchema` representation. It is structured JSON/text
editing, not a general-purpose syntax-highlighted code editor.

Switching modes validates the complete schema and preserves unfinished work.
Invalid JSON syntax or schema shape keeps the draft visible with an actionable
error. Existing `columnId` values survive label/key edits and reordering; a
display-name change does not silently rename a persisted API key. A key change
is an explicit contract edit. Removing fields or changing their stored type
requires confirmation. Closing a dirty draft offers Save, Discard or Stay.

The dialog captures the table revision when opened and sends that revision on
save. It does not replace it with a newer background revision and overwrite
concurrent work. Mutation acknowledgment, operation IDs and Guardian/Fabric
authority remain the existing server contracts. Applications implementing a
custom `DataStudioTableDialog.onUpdate` callback should honor its additive
second argument, `{ expectedRevision }`, when calling the SDK/controller writer.
For custom header editors, `updateSchema(schema, { expectedRevision })` and
`updateTable(input, { expectedRevision })` accept the same captured precondition.

## Adding Records

The packaged **Add record** dialog identifies the selected table and generates
typed fields from its schema. The wide, responsive form shows type icons,
required markers, descriptions and server defaults, with full-width JSON and
datetime fields. Its header and actions stay visible while the field body
scrolls; mobile uses a single column.

Untouched optional/defaulted fields are omitted, so server defaults apply.
Explicit zero, False, empty text and null remain distinct from omission. Invalid
numeric/JSON/date drafts remain visible, with field feedback and focus on the
first error. Dates use Zero's DatePicker; datetimes combine it with TimePicker
and a seconds/milliseconds field. Changing the date or minute does not truncate
timestamp precision. Date-only values remain `YYYY-MM-DD`; local datetime
drafts must represent a valid local time before becoming canonical UTC timestamps.

`DataStudioRowDialog` accepts optional `scopeKey: string | number`; the packaged
workspace supplies its scoped controller identity. Standalone uses should pass
their authorization/source identity. Table/scope replacement starts a fresh
form and retires late outcomes. Schema-only replacement preserves the opening
draft, blocks creation and offers **Reload fields**, with deliberate discard
confirmation when necessary. Closing an entered draft similarly offers Keep
editing, Discard draft or Create record.

Creation awaits the writer and fences same-tick duplicate submission. Pending
work disables editing and dismissal. Rejected writes keep the values and show
a safe error, never a raw callback exception. An ambiguous SDK mutation result
locks the exact input for **Retry request** using the existing idempotency
contract. These UI protections do not replace Guardian/Fabric admission,
operation IDs, mutation acknowledgement or server validation.

## Inline Editing Contract

Inline editing is intentionally cell-like. Entering edit mode does not swap a
cell for the framework's decorated form input or change row height/column
width. Text, numeric and JSON cells use a transparent editor over the cell box,
inherit its typography, and leave hidden display text in flow to preserve
geometry. Date/datetime cells retain the same cell-sized display and open a
focused, anchored Zero calendar/time editor instead of a native date input.

- Click selects a cell and opens its editor when permitted. A keyboard-focused
  cell opens the same editor when activated with `Enter` or `Space`.
- `Enter` validates and commits a changed draft.
- `Tab` saves a changed draft and moves forward; `Shift+Tab` does the same
  backward.
- `Escape` restores the displayed value without writing.
- Text/numeric/JSON blur commits a changed, valid draft. An unchanged `Enter`,
  `Tab`, or blur is an exact no-op, preserving absent cells and stored nulls.
- Date/datetime popovers use **Apply** and **Cancel**. Calendar/time selection
  changes only the draft; portal blur does not save. Enter in the date field
  validates it; Enter on a calendar day/time choice only selects that choice.
  Use Apply to save the cell.
  Outside dismissal cancels; a nested picker consumes its own Escape first.
  The explicit seconds field retains existing millisecond precision.
- Boolean cells use an in-place tokenized toggle and preserve nullable state.
- Pending, saved, validation-error, and revision-conflict states use small
  indicators without expanding the cell.
- A failed save restores the prior value. A revision conflict reloads the
  authoritative row and explains that the latest value was restored.

Custom uses of `DataStudioInlineCell` must pass the row's authoritative
`revision`. The component snapshots that revision when editing begins and
restores the current value if reconciliation advances it, so a stale draft is
never silently rebased onto a newer row.

Every cell change is still a complete optimistic-concurrency row replacement.
The controller converts the existing column-ID map to public column keys,
changes one value, and submits the current row revision. There is no direct
client write to `_data_studio_cells`.

## Server And Headless Use

Functions, app routes, and trusted activities can use the same engine without
rendering the control plane. Construct `DataStudioService` only around a
scope-closed `zero.data` capability and a Guardian actor already projected by
the request or background authority:

```ts
// server/endpoints/import-contact.ts
import { t } from 'elysia';
import {
  defineEndpoint,
  createDataStudioService,
} from '@zero/framework/server';
import { DataStudioError } from '@zero/framework/data-studio';

export default defineEndpoint({
  name: 'contacts.import',
  method: 'POST',
  path: '/api/contacts/import',
  auth: {
    user: 'required',
    tenant: 'required',
    permission: 'contacts:import',
    credentials: ['session', 'api-key'],
  },
  body: t.Object({
    name: t.String({ minLength: 1, maxLength: 120 }),
    operationId: t.String({ minLength: 1, maxLength: 128 }),
  }),
  handler: async ({ access, body, zero }) => {
    const auth = access.requireUser();
    access.requireTenant();
    const organizationKind = auth.tenantKind === 'organization'
      || auth.tenantKind === 'administration';
    if (!organizationKind || !auth.membershipId) {
      throw new DataStudioError(
        'DATA_STUDIO_AUTHORITY_REQUIRED',
        'Data Studio requires an active organization membership.',
      );
    }
    if (!zero.data) {
      throw new DataStudioError(
        'DATA_STUDIO_NOT_READY',
        'Data Studio tenant database is not ready.',
      );
    }

    const studio = createDataStudioService({
      data: zero.data,
      actor: {
        userId: auth.userId,
        membershipId: auth.membershipId,
      },
    });
    const table = await studio.getTable({ key: 'contacts' });
    return await studio.createRow(
      table.tableId,
      { name: body.name },
      { operationId: body.operationId },
    );
  },
});
```

The service deliberately has no tenant selector, path, SQL handle, or database
manager. Its methods are promise-based because they cross the Fabric actor
boundary. An app endpoint or activity must still enforce its own feature
permission (`contacts:import` above); Data Studio's built-in permissions guard
the built-in router, not every business operation that may use stored data.

For Pantheon, make the customer organization the owner of tables, functions,
workflows, and related durable state. Use Guardian RBAC to decide which
organization members can view rows, edit rows, or manage schemas. Keep the
logical table key in function/workflow configuration, resolve it inside the
already-scoped service, and never derive a Fabric database from a user-provided
organization ID. User membership controls access; the organization owns the
data.

## Schema Evolution

Every accepted schema revision is stored before it becomes current. Changes
are checked against transactional per-column statistics:

- Labels, descriptions, public keys, defaults, and presentation order can
  change while keeping the same `columnId`.
- An optional column can be added to a non-empty table.
- A required column can be added only while the table is empty.
- Optional can become required only when every existing row has a non-null
  value for that column.
- A populated column cannot be removed or change type. Remove its values from
  every row first.
- A retired `columnId` cannot later be reused, even after its column is
  removed. Create a new stable ID.
- Archived tables are readable but reject row writes and schema changes.
  Restore before changing them.

Defaults are write-time behavior. A create or complete replacement
materializes a current default for an omitted column. Adding or changing a
default does not backfill older rows, make an absent old cell appear as stored,
or make filters/search pretend that old rows contain it. This preserves the
historical row payload and prevents a schema-only change from silently changing
query results.

`expectedRevision` protects table and row mutations. A stale write returns
`DATA_STUDIO_REVISION_CONFLICT`; reload and consciously reapply the edit.

## Search, Filters, Sorting, And Paging

Search and filters are compiled from a closed operator/type model and always
use bound SQL parameters. Callers cannot provide SQL fragments.

- Search performs escaped contains matching over stored text projections.
- `contains` is supported only for `text` columns.
- `eq`/`ne` support stored `null`; range comparisons against `null` are
  rejected.
- Boolean and JSON columns support equality/inequality only.
- Filter inputs are scalar; object/array JSON values are not filter operands.
- Filters use public `columnKey`; sorting uses immutable `columnId`. JSON
  columns cannot be sorted.
- One request accepts at most eight filters and 200 search characters.
- Pages default to 25 rows and cannot exceed 25 rows.
- A page may contain fewer rows than requested because results are also bounded
  by the actor response-byte budget. Always follow `nextOffset`; do not compute
  the next page as `offset + limit`.
- Table catalogs return summaries and hydrate the selected schema separately.
- Schema history is newest-first, at most 10 entries per request.

## Limits And Idempotency

Current hard bounds include:

| Boundary | Limit |
| --- | ---: |
| Logical tables per organization database | 100 |
| Rows per logical table | 100,000 |
| Columns per schema | 128 |
| Schema revisions per logical table | 256 |
| Canonical schema document | 64 KiB |
| One canonical cell value | 64 KiB |
| One aggregate row-value document | 256 KiB |
| JSON value nesting / total nodes | 32 / 4,096 |
| Members in one JSON array or object | 1,024 |
| Actor result budget | 768 KiB |
| Row page / schema-history page | 25 / 10 |

All mutations require an operation ID. The browser SDK creates one when it is
omitted; server/headless callers supply one explicitly. The service derives
actor-bound Fabric receipt keys and deterministic create IDs from it. An exact
replay with the same actor and payload returns the committed result; reusing it
for a different payload returns `DATA_STUDIO_IDEMPOTENCY_CONFLICT`.

When `DataStudioMutationError.requiresSameIdempotencyKey` is true, the commit
outcome is unknown. Retry only the exact logical mutation with the error's
`operationId`. Generating a new ID can create a duplicate. The packaged hook
retains the operation ID for this case automatically.

## Sync And Mutation Transport

The two public physical resources expose lightweight reconciliation metadata
through generated HTTP reads and the active tenant Sync plane. Catalog metadata
is full-sync and row metadata is lazy; both Resource declarations expose only
`list`/`get`. The catalog allow-list omits `schema_json`, the row allow-list
omits `values_json`, and both omit Guardian attribution columns. Complete
logical schemas and row values are read through the dedicated byte-bounded Data
Studio API. Schema history, typed cell projections, and column statistics
remain internal. This split keeps generic lazy `/api/data` pages from bundling
many maximum-size logical documents past Fabric's actor-result budget.

These Resource declarations are part of Data Studio's security contract, not
customization templates. Keep their normalized name/table/primary-key,
exposure, tenant realm, actions, field allow-lists, and Guardian policy exactly
as shipped. Put app-specific business permissions on app routes or functions
that call `DataStudioService`; do not weaken or broaden the built-in Resources.

This read exposure does not create a mutation API. All five physical tables
are in Zero's framework write-protection catalog. Use `client.dataStudio`,
`useDataStudio`, the built-in component, the HTTP API, or a server-side
`DataStudioService`; do not call collection `insert/update/delete` for these
tables.

The browser SDK keeps dedicated-API result caches partitioned by the complete
Guardian authorization boundary and clears them on tenant/session replacement.
Own mutations refresh the relevant schema/catalog/row page or progressive
window. `useDataStudio()`
subscribes to generic Sync metadata and invalidates/reloads the affected full
reads. Apps that consume the public Sync rows directly must treat them only as
read-only reconciliation signals, never as complete logical records, and use
the command path for changes.

## HTTP Surface

The auto-mounted router lives at `/api/_zero/data-studio`:

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /capabilities` | active organization | Return installed state, grants, and limits. |
| `GET /tables` | read | List summaries by `active`, `archived`, or `all`. |
| `GET /tables/:tableId` | read | Hydrate one current schema. |
| `POST /tables` | manage | Create a logical table. |
| `PATCH /tables/:tableId` | manage | Update metadata or schema with `expectedRevision`. |
| `POST /tables/:tableId/status` | manage | Archive or restore. |
| `GET /tables/:tableId/rows` | read | Search/filter/sort/page rows. |
| `GET /tables/:tableId/rows/:rowId` | read | Read one row. |
| `POST /tables/:tableId/rows` | write | Create a row. |
| `PUT /tables/:tableId/rows/:rowId` | write | Replace a complete row with `expectedRevision`. |
| `DELETE /tables/:tableId/rows/:rowId` | write | Delete with `expectedRevision`. |
| `GET /tables/:tableId/schema-versions` | read | Read bounded immutable history. |

Prefer the browser SDK or service instead of hand-building this transport.
They preserve token restoration, scope cancellation, canonical validation,
revision handling, and operation-ID semantics.

## Observability And Operations

Data Studio emits Zero observability codes for schema creation, schema update,
schema archival/restoration, rejected operations, and failed operations:

- `data-studio.schema.created`
- `data-studio.schema.updated`
- `data-studio.schema.archived`
- `data-studio.schema.restored`
- `data-studio.operation.rejected`
- `data-studio.operation.failed`

Events carry bounded operation/code/retry/outcome metadata and the standard
request scope added by Zero's observability boundary. Do not add logical data,
raw IDs, SQL, paths, request bodies, or idempotency keys to those events.
The server service's table-mutation `*WithReceipt()` variants return
`{ value, replayed }`; the built-in router uses that durable replay signal so
an exact idempotent replay does not emit a second schema lifecycle event.

The server normalizes failures to the closed `DataStudioError` code set before
choosing an HTTP status or emitting an event. Authority/readiness failures,
missing or archived records, schema/value/limit failures, revision and
idempotency conflicts, in-progress operations, unavailable actors, and
unknown commit outcomes therefore remain distinguishable without exposing a
raw database failure. The browser projects failed writes as
`DataStudioMutationError`, preserving `code`, `retryable`, `operationId`, and
the same-key retry requirement. Treat an outcome-unknown write as a special
reconciliation case; do not turn it into a generic retry with a new operation
ID.

Provisioning follows Fabric and Guardian identity-realm readiness. Keep tenant
creation/switching controls outside a `DataRealmReadyGate`, and mount Data
Studio inside the ready organization application area. While the scoped data
capability is unavailable, `/capabilities` reports `enabled: false` and an
attempted data operation returns `DATA_STUDIO_NOT_READY`; neither path falls
back to the pinned application database.

## Upgrade And Removal

Adding Data Studio to an existing Fabric app changes two versioned contracts:

1. compose the contribution and bump the outer actor-realm version;
2. merge permissions/roles and increase Guardian `registryVersion` whenever
   the installed authorization semantics change.

Also merge the server table fragment, spread the official Resource fragment
unchanged, merge the browser table fragment, then restart the parent and actors
from the same build. Existing organization databases receive the fixed realm
tables through normal Fabric realm initialization. No app-authored
per-organization DDL loop is needed. A partial or modified Resource, fixed
schema, actor-handler, or public Sync-mode fragment is an invalid installation
and fails startup with `DATABASE_CONFIG_INVALID`.

Data Studio does not convert existing application tables into logical tables,
nor does it migrate logical rows into app-defined physical tables. Import or
export through the supported SDK/service if an app needs that conversion.

To remove the feature, first remove access and UI, export/backup any required
logical data, drain active actors, then remove the complete table/Resource,
permission/role, realm-contribution, and client-table fragments together while
bumping the applicable realm/Guardian versions. Do not remove only the router
or only a subset of physical Resources. Removing the feature from configuration
does not constitute a data-erasure procedure for existing tenant files.

## Follow-On Control Planes

Organization-managed Storage drives and Vector indexes are related ideas, but
they are not implemented by Data Studio and should not be folded into its
logical-table contract. The focused
[Storage Studio and Vector Studio control-plane roadmap](./control-plane-roadmap.md)
defines their separate future provisioning, Guardian/Fabric authority, quotas,
jobs, lifecycle/deletion, recovery, Sync visibility, service, and adaptive-UI
work. The intended sequence is:

1. finish and validate Data Studio's organization-owned table flow;
2. design an adaptive organization Storage provisioning/control plane around
   Zero's existing Storage service;
3. separately design organization-owned Vector index provisioning and access.

That preserves one clear authority/lifecycle boundary per system while letting
their eventual control planes share Zero's list/detail, Guardian capability,
inline-action, and design-token patterns.

---
id: zero.guides.user-owned-records
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: user-owned-records
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Store Records Owned By Real Users

[Guides index](./index.md) · [Documentation index](../index.md)

A record needs two separate guarantees: referential existence and authority.
A Guardian reference provides the local FK anchor; a resource policy determines
who may create/read/change the record.

## A Single-Workspace Declaration

Keep the shared schema browser-safe. In `db/schema.ts`:

```ts
import { defineTable, field } from '@zero/framework/schema';

export const notes = defineTable('notes', {
  owner_id: field.guardianUser(),
  body: field.text({ required: true, maxLength: 2000 }),
}, { sync: 'lazy' });
```

In the server-only `zero.config.ts`, bind that table to its owner policy and
application/system planes:

```ts
import {
  defineResource, globalRealm, ownerPolicy,
} from '@zero/framework/resources';
import { defineZeroConfig } from '@zero/framework/server';
import { notes } from './db/schema';

export const notesResource = defineResource({
  table: notes,
  exposure: 'all',
  realm: globalRealm(),
  policy: ownerPolicy({ userField: 'owner_id' }),
});

export const config = defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  systemDb: { mode: 'file', path: './data/zero.system.db' },
  tables: { notes },
  resources: [notesResource],
  auth: {
    tenancy: 'single',
    authorization: 'simple',
    bootstrap: {
      mode: 'secret',
      secret: Bun.env.INSTALLATION_BOOTSTRAP_SECRET,
    },
  },
});
```

INSTALLATION_BOOTSTRAP_SECRET is an app-selected server environment variable.
Its value must satisfy the [bootstrap contract](../backend/guardian/bootstrap.md);
missing authority leaves an empty installation unavailable for owner setup.
Never send the configuration/secret to the browser.

## What This Actually Does

Guardian remains canonical in the system database. The schema requests a minimal
application-plane users anchor so owner_id has a real FK. The reference does not
copy profile/password/role state and does not authorize a submitted owner.

ownerPolicy binds admitted action/row ownership to the authenticated actor.
Generated Resource CRUD and Sync use the shared policy/compiler. Do not bypass
that boundary with a raw SQL route and then assume the declaration still checks it.
Its default create mode stamps the owner from authenticated server context;
the browser does not choose another person's owner_id. Immutable ownership also
prevents an admitted update from transferring the record merely by changing
that field. The local FK anchor proves existence, not that its user is allowed
to read or write this note.

## Frontend And Writes

This table is declared `sync: 'lazy'`: a collection read alone does not fetch
missing records. Choose an explicit loading/query source rather than rendering
an empty cache and assuming there are no notes.

For a searchable, paginated inline editor, put this page in
`app/notes/page.tsx` beneath the app's existing frontend provider:

```tsx
import { DataTable } from '@zero/framework/react';
import { notes } from '../../db/schema';

export default function NotesPage() {
  return (
    <DataTable
      schema={notes.schema}
      source={{ type: 'server', table: 'notes' }}
      columns={['body']}
      editable={['body']}
      searchable={{ fields: ['body'], placeholder: 'Find notes…' }}
      sortable
      paginated={{ pageSize: 20 }}
    />
  );
}
```

The built-in server source makes search, sorting and pagination request an
authorized `/api/data` page through the normal SDK. It does not double-filter
that page in the browser. Inline body edits use the registered table's
acknowledged source writer; keep the actual mutation Promise intact so a
rejected write does not appear saved. This example edits existing notes; a
separate create flow must use the admitted Resource/table mutation contract
and its server-owned attribution policy.

The page imports only the shared schema, never the server config or bootstrap
secret. Hiding owner_id from columns/editors is helpful presentation, but is
not the ownership enforcement boundary. Protect the page as appropriate for
the app; server resource/query/write policies still govern access independently
of whether its UI is visible.

A Resource HTTP list or an accepted table query is not a Sync baseline. Plain
collection/record hooks observe already-loaded cache data; they do not secretly
run a list request or make every cached row belong to this query. Choose the
appropriate explicit loading/reactivity contract when composing a custom view.
See [SDK data composition](../frontend/sdk/data-composition.md),
[collection reads and loading](../frontend/sdk/data-hooks.md),
[Resource reads](../frontend/sdk/resource-hooks.md),
[DataTable server sources](../frontend/data-controls/data-table/server-sources.md)
and [acknowledged edits](../frontend/data-controls/data-table/editing.md).

## Multi-Tenant Variation

Use a tenant realm and the chosen logical/physical isolation model. A
guardianMembership reference can attribute the specific organization membership
rather than just the global person. Do not simply substitute a client tenant ID
in the single-workspace example.

## Verify Both Guarantees

Create a real user through the disposable fixture's normal Guardian flow.
Prove the local FK exists, then prove user A cannot assign/read/change user B's
record. In multi mode also prove the same identities cannot cross organization
boundaries. Revoke authority and retry with the old credential.

See [Guardian references](../backend/schema/guardian-references.md),
[ownership policy](../backend/resources/policies.md),
[realm semantics](../backend/resources/realms.md),
[organization apps](./organization-app.md) and [verification](./verification.md).

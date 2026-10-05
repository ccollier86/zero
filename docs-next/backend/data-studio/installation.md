---
id: zero.data-studio.installation
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: installation
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Install The Complete Data Studio Feature

[Data Studio index](./index.md) · [Documentation index](../../index.md)

createDataStudioFeature returns immutable appTables, raw realm tables,
clientTables, resources, realmContribution, permissions, roleFragments and router.
There is no generic dataStudio:true setting.

## Server Configuration

```ts
import {
  composeDatabaseRealm, createDataStudioFeature,
} from '@zero/framework/server';
import type { AppConfig } from '@zero/framework/server';

const studio = createDataStudioFeature();
export const realm = composeDatabaseRealm({
  name: 'data-app',
  version: '1',
  contributions: [studio.realmContribution],
});
export const config = {
  port: 3000,
  db: { mode: 'file', path: './data/app.db' },
  systemDb: { mode: 'file', path: './data/zero.system.db' },
  tables: { ...studio.appTables },
  resources: [...studio.resources],
  auth: {
    tenancy: { mode: 'multi' },
    authorization: {
      mode: 'advanced',
      permissions: { ...studio.permissions },
      roles: { tableManager: studio.roleFragments.manager },
    },
  },
  databaseTopology: {
    mode: 'multiple',
    rootDirectory: './data/tenant-files',
    realm,
    tenantIsolation: 'tenant-database',
    actors: { launch: { kind: 'source', entrypoint: new URL('./server.ts', import.meta.url) } },
  },
} satisfies AppConfig;
```

The actual server entry must import this realm and perform the
[same-entry actor check](../fabric/actors.md) before ordinary startup.
Merge additional app declarations/resources/contributions deliberately.
Role fragments do not assign a role to anyone automatically.

## Browser Tables

```ts
import { createClient } from '@zero/framework';
import { DATA_STUDIO_CLIENT_TABLES } from '@zero/framework/data-studio';
export const client = createClient({
  url: 'http://localhost:3000',
  tables: { ...DATA_STUDIO_CLIENT_TABLES },
});
```

Use one app client, combining its other registered tables rather than constructing
a new client on each page.

## Admission

Managed createApp automatically mounts the router after validating complete
official tables/resources/realm handlers and required full/lazy modes.
Do not mount another router manually or activate the feature merely by giving an
unrelated app table the same name.

See [profiles](./profiles.md), [public API](./public-api.md),
[permissions](./permissions.md) and [realm integration](./realm-integration.md).

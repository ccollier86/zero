---
id: zero.database-automations.configuration
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: configuration
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Configure Database Automations

[Database automations](./index.md) · [Platform configuration](../configuration/index.md) · [Documentation index](../../index.md)

A physical source owns an immutable automation registry admitted at startup.
There are no automation-specific environment variables, persisted handler
settings or public dispatcher tuning fields in AppConfig.

## Pinned Database

createApp({ databaseAutomations: registry }) installs interception on the
pinned application ReactiveDB, not system.db. This remains separate from any
multiple-database actor registry.

Complete definition/config value example; the application's normal app paths
and other feature settings remain its responsibility:

```ts
import { defineDatabaseAutomations, defineDatabaseFunction, defineDatabaseTrigger,
  type DatabaseTriggerFunctionInput, type DatabaseTransactionFunctionCapability,
} from "@zero/framework/database-automations";
import type { AppConfig } from "@zero/framework/server";

const count = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseTransactionFunctionCapability
>({
  name: "orders.count", version: 1, mode: "transaction",
  handler({ transaction }) {
    const previous = transaction.get("order_totals", "all");
    transaction.insert("order_totals", {
      total_id: "all", count: Number(previous?.count ?? 0) + 1,
    });
  },
});
const registry = defineDatabaseAutomations({
  functions: [count],
  triggers: [defineDatabaseTrigger({
    name: "orders.created", version: 1, table: "orders",
    after: { insert: true }, run: count,
  })],
});
export const config = {
  db: { mode: "file", path: "./application.db" },
  tables: {
    orders: { order_id: "text primary key", title: "text not null" },
    order_totals: { total_id: "text primary key", count: "integer not null" },
  },
  databaseAutomations: registry,
} satisfies AppConfig;
```

A tracked orders insert increments the rollup in the same commit. No HTTP
permission or Sync write policy is created by this configuration.

## Fabric Realms

defineDatabaseRealm({ automations: registry, ... }) admits definitions against
the realm's final tables. Supply that realm in the normal
databaseTopology: { mode: "multiple", realm, rootDirectory, actors, ... }
configuration. The actor imports its trusted realm module; handlers never
cross IPC. The pinned registry and actor registry are independent.

Fragment using previously declared applicationTables and registry:

```ts
import { defineDatabaseRealm } from "@zero/framework/databases";
const realm = defineDatabaseRealm({
  name: "customer-data", version: 1,
  tables: applicationTables, migrations: [], queries: {}, commands: {},
  automations: registry,
});
```

This is not a complete actor launch configuration. See
[ReactiveDB](../reactive-db/index.md) for topology, placement and realm routing.

## Registry Composition

defineDatabaseAutomations({ functions?, triggers?, include?, validation? })
combines included registries first, then local definitions. The key is include,
singular, containing existing registries. Lists are detached/frozen; identity
collisions fail instead of overwriting earlier definitions.

A bare registry preserves composition order. Managed pinned/Fabric admission
sorts function/trigger definitions by canonical identity so equal manifests
cannot hide differing execution order. Each trigger's run order is retained.

Readonly manifest and fingerprint describe admitted definitions.
listFunctions()/listTriggers() return definitions; getFunction accepts an exact
reference or identity, getTrigger accepts identity, missing lookup returns null.
resolveTriggerFunctions(trigger) resolves ordered targets; match(change) returns matches.
Passing a function definition to run does not automatically register it in
functions: include every target in the composed registry.

## Storage And Lifecycle

| Configuration | Requirement |
| --- | --- |
| Transaction-only source | Ephemeral, file or admitted hot mode. |
| Durable function on ephemeral source | Rejected; effects could not survive restart. |
| Pinned durable hot source | Enabled snapshots. |
| Any managed durable registry | Non-ephemeral system DB for source-catalog recovery. |
| Durable Fabric source | Admitted source placement/durability and local outbox. |

The catalog/outbox is constructed only when durable functions exist. Dispatcher
startup follows Elysia startup; runtime cleanup drains it before its dependencies
are released. Do not install a second manual interceptor/poller on managed DBs.

Authorize origin writes with Guardian/Resource policy. Trusted trigger code is
not another user grant. Repair failed schema/storage admission instead of
silently removing durable work or weakening persistence.
[Validation](./validation.md), [services and authority](./services-and-authority.md)
and [versioning](./versioning.md) describe those boundaries.

Related: [transaction functions](./transaction-functions.md),
[delivery](./delivery.md), [configuration resolution](../configuration/resolution.md).

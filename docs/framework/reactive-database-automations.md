# ReactiveDB Database Functions And Triggers

ReactiveDB database automations run declared functions after tracked table
changes. Use them for synchronous same-database invariants, derived rows and
rollups, or for durable post-commit work such as calling an external service or
resuming one exact Torrent workflow instance.

This is an application-level ReactiveDB feature. It does not install raw
SQLite `CREATE TRIGGER` objects and it does not watch writes which bypass
ReactiveDB change tracking. Writes through ReactiveDB, a registered Fabric
command, a Resource, `/api/data`, or Sync enter the tracked mutation boundary.
Direct `zero.sql` writes and migrations do not.

The public authoring API is:

```ts
import {
  defineDatabaseAutomations,
  defineDatabaseFunction,
  defineDatabaseTrigger,
} from '@zero/framework/database-automations';
```

## Choose The Execution Mode

Every database function declares one of two modes. Choose based on where the
work must commit, not on how long its source file is.

| Contract | `mode: 'transaction'` | `mode: 'durable'` |
| --- | --- | --- |
| Starts | During the tracked source transaction | After the source transaction commits |
| Handler | Synchronous only | May be asynchronous |
| Database work | Same source database through a narrow tracked capability | Managed, source-authority-scoped Zero services |
| Network or other external effects | Forbidden | Supported; make the destination idempotent |
| Failure before source commit | Rolls back the source change, cascades, and outbox inserts | Outbox admission failure rolls back the source change |
| Failure after source commit | Not applicable | Retried with backoff; source data remains committed |
| Delivery | Part of one local SQLite transaction | At least once, with fenced leases and restart recovery |
| Ephemeral source | Supported | Rejected at startup |

The durable outbox and the source mutation share one SQLite commit. Zero never
accepts a source change and then best-effort appends its durable effect later.
The dispatcher claims the effect only after the writer lane has released the
source database.

## Recommended Project Layout

Keep schema, functions, and trigger declarations independently reviewable,
then compose one explicit registry:

```text
db/
  schema.ts                 # complete exported table registry
  schemas/
    orders.ts               # focused table definitions
    customer-rollups.ts
  functions/
    rebuild-customer-rollup.ts
    publish-order-change.ts
    resume-order-workflow.ts
  triggers/
    order-triggers.ts
  automations.ts            # explicit registry composition
server/
  tenant-database.realm.ts  # Fabric realm, when used
zero.config.ts              # imports schema and registry explicitly
```

Zero does not scan these directories. `db/automations.ts` must import every
definition, and `zero.config.ts` or a Fabric realm must import the resulting
registry. This keeps configuration deterministic for humans, agents, the
parent process, and Fabric actors.

## Define A Same-Transaction Rollup

This example rebuilds a customer summary whenever a relevant order changes.
The summary mutation is another tracked ReactiveDB change in the same commit,
so authorized clients see the order and rollup atomically.

```ts
// db/functions/rebuild-customer-rollup.ts
import {
  defineDatabaseFunction,
  type DatabaseTriggerFunctionInput,
  type DatabaseTransactionFunctionCapability,
} from '@zero/framework/database-automations';

interface OrderRow {
  order_id: string;
  customer_id: string;
  status: string;
  amount_cents: number;
}

export const rebuildCustomerRollup = defineDatabaseFunction<
  DatabaseTriggerFunctionInput,
  void,
  DatabaseTransactionFunctionCapability
>({
  name: 'orders.rebuild-customer-rollup',
  version: 1,
  mode: 'transaction',
  handler: ({ input, transaction }) => {
    const source = input.change.row ?? input.change.previousRow;
    const customerId = source?.customer_id;
    if (typeof customerId !== 'string') {
      throw new Error('Order automation requires a customer identity.');
    }

    const orders = (transaction.query('orders') as unknown as OrderRow[])
      .filter((order) => order.customer_id === customerId);
    const paid = orders.filter((order) => order.status === 'paid');
    const values = {
      order_count: orders.length,
      paid_order_count: paid.length,
      paid_total_cents: paid.reduce(
        (total, order) => total + order.amount_cents,
        0,
      ),
      updated_at: input.change.timestamp,
    };

    if (transaction.queryOne('customer_order_rollups', customerId)) {
      transaction.update('customer_order_rollups', customerId, values);
    } else {
      transaction.create('customer_order_rollups', {
        customer_id: customerId,
        ...values,
      });
    }
  },
});
```

The transaction capability exposes tracked create, insert, update, delete,
read, scoped-write, natural-identity, and nested-transaction helpers. It has no
raw SQLite handle and no `afterCommit()` escape. Returning a Promise or any
thenable fails the operation and rolls back the complete source transaction.

If a transaction function writes a table with another matching trigger, Zero
queues that logical change after the current trigger chain. Cascades remain in
the same commit and are bounded; they are not recursive JavaScript stack
calls.

## Define A Durable Post-Commit Service Call

Use a durable function for a network call. The destination must honor a stable
idempotency key because a process can stop after the destination accepts a
request but before Zero records completion.

```ts
// db/functions/publish-order-change.ts
import {
  defineDatabaseFunction,
  type DatabaseTriggerFunctionInput,
} from '@zero/framework/database-automations';
import type {
  DatabaseAutomationExecutionServerServices,
} from '@zero/framework/server';

export const publishOrderChange = defineDatabaseFunction<
  DatabaseTriggerFunctionInput,
  void,
  DatabaseAutomationExecutionServerServices
>({
  name: 'orders.publish-change',
  version: 1,
  mode: 'durable',
  async handler({ input, invocation, signal }) {
    const baseUrl = Bun.env.FULFILLMENT_SERVICE_URL;
    if (!baseUrl) throw new Error('Fulfillment service is not configured.');

    const response = await fetch(new URL('/events/order-change', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': [
          'zero-db',
          invocation.invocationId,
          invocation.functionIdentity,
        ].join(':'),
      },
      body: JSON.stringify({
        orderId: input.change.rowId,
        operation: input.change.operation,
        sequence: input.change.sequence,
      }),
      signal,
    });

    if (!response.ok) {
      // Keep sensitive response bodies out of errors and observability.
      throw new Error('Fulfillment service rejected the order change.');
    }
  },
});
```

`invocationId` is stable across retries and is shared by the ordered functions
for one matched trigger. Include `functionIdentity` when deriving an external
idempotency key so each durable function in the chain has its own destination
identity. Honor `signal`; Zero aborts it when execution times out, the lease is
lost, or the runtime shuts down. Scoped service methods separately recheck the
source authority before effects and after awaitable work.

Managed durable handlers also receive `zero`, a strict
`DatabaseAutomationExecutionServerServices` projection. Its storage,
notifications, rooms, workflows, PDF, observability, auth compiler, and—when
applicable—tenant data capabilities are already closed over the source
catalog's trusted application or tenant authority. Raw persistence,
registries, `unsafe`, and a caller-controlled tenant selector are absent.

## Resume One Exact Torrent Instance

`zero.torrent.deliverEvent()` is the database-automation bridge to Torrent. It
targets the exact persisted `instanceId`; it never broadcasts by event name.
Zero derives permanent Torrent idempotency from the private durable delivery
identity and an optional bounded discriminator, so replaying an outbox attempt
returns the original Torrent acknowledgement instead of inserting a second
event.

```ts
// db/functions/resume-order-workflow.ts
import {
  defineDatabaseFunction,
  type DatabaseTriggerFunctionInput,
} from '@zero/framework/database-automations';
import type {
  DatabaseAutomationExecutionServerServices,
} from '@zero/framework/server';

export const resumeOrderWorkflow = defineDatabaseFunction<
  DatabaseTriggerFunctionInput,
  void,
  DatabaseAutomationExecutionServerServices
>({
  name: 'orders.resume-workflow',
  version: 1,
  mode: 'durable',
  async handler({ input, zero }) {
    const row = input.change.row;
    const instanceId = row?.workflow_instance_id;
    if (typeof instanceId !== 'string') {
      throw new Error('Order change is missing its Torrent instance identity.');
    }

    await zero.torrent.deliverEvent(
      instanceId,
      'order.fulfillment-ready',
      {
        orderId: input.change.rowId,
        sourceSequence: input.change.sequence,
      },
      { key: 'fulfillment-ready' },
    );
  },
});
```

The optional `key` distinguishes multiple logical Torrent deliveries made by
one durable handler. It is not an authority token and it is not the complete
idempotency key. It must begin with an alphanumeric character, use only
letters, digits, `.`, `_`, `:`, or `-`, and contain at most 64 characters.
Keep it constant for one logical event. Reusing the derived identity for a
different instance, event name, or payload fails closed as a Torrent
idempotency conflict.

Zero supplies the fixed database-automation system principal and derives its
application or tenant scope from the trusted source catalog. Do not put a
tenant selector, principal, or authorization snapshot in the changed row or
handler input. The bridge revalidates that source authority once before the
call, again inside the same system-database transaction that writes the Torrent
event, sealed authority envelope, and idempotency receipt, and once after the
awaitable operation returns. Revocation cannot win the preflight-to-commit race.

## Declare AFTER Triggers

A trigger identifies one table, one or more logical AFTER operations, and a
non-empty ordered function chain:

```ts
// db/triggers/order-triggers.ts
import { defineDatabaseTrigger } from '@zero/framework/database-automations';
import { rebuildCustomerRollup } from '../functions/rebuild-customer-rollup';
import { publishOrderChange } from '../functions/publish-order-change';
import { resumeOrderWorkflow } from '../functions/resume-order-workflow';

export const onOrderChanged = defineDatabaseTrigger({
  name: 'orders.after-change',
  version: 1,
  table: 'orders',
  after: {
    insert: true,
    update: {
      columns: [
        'amount_cents',
        'status',
        'workflow_instance_id',
      ],
    },
    delete: true,
  },
  run: [
    rebuildCustomerRollup,
    publishOrderChange,
    resumeOrderWorkflow,
  ],
});
```

`update: true` matches every update. `update: { columns: [...] }` matches only
when at least one listed value changed. Insert, update, and delete declarations
are canonicalized in that order. Unknown tables, unknown update columns,
duplicate identities, duplicate targets, and missing function versions fail
during config or realm admission before a database accepts work.

The `run` order is behavioral: transaction functions execute and durable
effects enqueue in the declared order. Durable effects are not executed until
the source commit succeeds, so a mixed chain is not an awaitable cross-mode
saga. Model multi-step asynchronous orchestration in Torrent.

Each function receives an immutable, detached input:

```ts
interface DatabaseTriggerFunctionInput {
  readonly change: {
    readonly sequence: number;
    readonly table: string;
    readonly operation: 'insert' | 'update' | 'delete';
    readonly rowId: string;
    readonly row: Readonly<Record<string, DatabaseAutomationValue>> | null;
    readonly previousRow:
      | Readonly<Record<string, DatabaseAutomationValue>>
      | null;
    readonly timestamp: number;
  };
}
```

For inserts, `previousRow` is `null`; for deletes, `row` is `null`. Durable
payloads use strict JSON data: `null`, booleans, finite numbers other than
negative zero, strings, arrays, and plain objects. `undefined`, `bigint`,
`Date`, binary values, non-finite numbers, sparse arrays, class instances,
accessors, and cycles are rejected rather than silently transformed. Store
files in Zero Storage and pass stable object IDs.

## Compose The Registry

```ts
// db/automations.ts
import { defineDatabaseAutomations } from '@zero/framework/database-automations';
import { rebuildCustomerRollup } from './functions/rebuild-customer-rollup';
import { publishOrderChange } from './functions/publish-order-change';
import { resumeOrderWorkflow } from './functions/resume-order-workflow';
import { onOrderChanged } from './triggers/order-triggers';

export const applicationAutomations = defineDatabaseAutomations({
  functions: [
    rebuildCustomerRollup,
    publishOrderChange,
    resumeOrderWorkflow,
  ],
  triggers: [onOrderChanged],
});
```

`include` can compose existing registries before local definitions. All
definition identities must still be unique. A function identity is
`function:<name>@<version>` and a trigger identity is
`trigger:<name>@<version>`. A name begins with a lowercase letter and contains
lowercase alphanumeric segments separated by a single `.`, `_`, or `-`, up to
128 characters total. Versions are positive safe integers.

The registry produces a handler-free canonical manifest and SHA-256
fingerprint. Function order in a trigger chain remains part of the manifest.
Handler source is deliberately not serialized or sent over Fabric IPC.

## Configure The Pinned Application Database

The pinned application database uses top-level `databaseAutomations`:

```ts
// zero.config.ts
import { defineZeroConfig } from '@zero/framework/server';
import { applicationAutomations } from './db/automations';
import { tables } from './db/schema';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/application.sqlite' },
  systemDb: { mode: 'file', path: './data/system.sqlite' },
  tables,
  databaseAutomations: applicationAutomations,
  auth: {
    tenancy: 'single',
    authorization: 'advanced',
  },
});
```

Config resolution re-admits the registry against `tables`. Transaction-only
registries work with memory or other ephemeral storage and do not install a
durable outbox. A registry containing any durable function requires a
crash-durable source database; ephemeral storage is rejected before writes are
accepted.

## Configure A Fabric Realm

Automations for tenant or named Fabric databases belong on the realm, not on
the top-level application registry:

```ts
// server/tenant-database.realm.ts
import { defineDatabaseRealm } from '@zero/framework/server';
import { tenantAutomations } from '../db/automations';
import { tenantTables } from '../db/schema';

export const tenantDatabaseRealm = defineDatabaseRealm({
  name: 'tenant-data',
  version: '4',
  tables: tenantTables,
  migrations: [],
  automations: tenantAutomations,
  queries: {},
  commands: {},
});
```

Import that exact realm module into both `zero.config.ts` and
`runDatabaseActorIfRequested()`. The parent and actor independently import the
handlers; executable functions never cross the actor protocol. The realm
fingerprint binds its schema, migrations, registered operation names, Guardian
anchors, and automation manifest. Mixed actor generations or stale realm
fingerprints fail closed.

Every physical Fabric source owns its own private durable outbox in the same
SQLite file as its application rows. Different source databases can commit and
drain independently. Within one source, writes remain ordered and the durable
worker admits only the earliest active insertion. A retry delay or live claim
therefore blocks later insertions in that source until the head completes or
becomes dead.

For this subsystem, the system database contains the durable automation source
catalog rather than a centralized outbox. It maps a stable opaque source
reference to its trusted application or tenant authority so restart recovery
can find active source-local outboxes. It never contains their payloads. A
tenant source is registered only after its file is ready, and its authority
comes from Guardian/Fabric routing—not a URL, header, body, browser cache, row
field, or handler argument. The dispatcher revalidates that catalog record and
tenant eligibility around handler execution and completion.

Any registry containing a durable function therefore requires a crash-durable
`systemDb` as well as crash-durable source databases. Zero rejects an ephemeral
system database during configuration, before the application can accept
writes; otherwise a restart could retain source-local outbox work while losing
the catalog needed to discover it.

File-mode system catalogs use SQLite commit durability. A hot system catalog
requires enabled snapshots and synchronously publishes each committed catalog
registration or lifecycle transition before discovery can use it. A failed
hot publication reports `DATABASE_OUTCOME_UNKNOWN` and fences later catalog
access; a rolled-back surrounding transaction publishes nothing.

## Atomicity, Ordering, And Cascades

For one root source transaction, Zero provides this sequence:

1. ReactiveDB creates a logical tracked change with its source sequence.
2. Matching triggers are selected in admitted registry order.
3. Each trigger's functions are visited in declared order.
4. Transaction functions run synchronously. Their tracked changes join a
   bounded cascade queue.
5. Durable functions append canonical commands to the source-local private
   outbox in the same SQLite transaction.
6. The source rows, tracked `_changes`, transaction cascades, and outbox
   commands commit or roll back together.
7. After commit and writer-lane release, the host dispatcher claims due durable
   commands and invokes their exact registered function versions.

Private outbox writes do not create ReactiveDB change rows and are never sent
through Sync. Application changes made by transaction functions are ordinary
tracked changes and preserve ReactiveDB's existing atomic fanout behavior.

The managed transaction budgets per root commit are:

| Budget | Default |
| --- | ---: |
| Cascade depth | 16 |
| Observed tracked changes | 256 |
| Invoked functions | 256 |
| Enqueued durable effects | 256 |

Exceeding a budget raises a stable `DatabaseError` with a not-committed outcome
and rolls back the root transaction. Split unbounded batch processing into a
Torrent workflow or another bounded job instead of increasing a trigger
cascade indefinitely.

## Durable Delivery Contract

Durable effects move through `pending`, `processing`, `completed`, or `dead`.
A claim includes a fenced lease token. Heartbeats extend only the current
lease; an expired or replaced worker cannot complete, retry, or dead-letter a
new owner's attempt. Startup and every drain recover expired processing
leases. Recoverable work returns to `pending`; exhausted work becomes `dead`.

Each physical source preserves outbox insertion order. A processing delivery,
or an earlier delivery waiting for its retry time, blocks later deliveries in
that source until it completes or becomes dead. Different physical sources
still drain concurrently. This makes the declared trigger function order and
the source mutation order explicit; split independent work across sources when
head-of-line retry blocking is not acceptable.

Delivery is at least once. Build handlers around these rules:

- Use the stable invocation plus exact function identity for an external
  idempotency key.
- Prefer `zero.torrent.deliverEvent()` for Torrent; its receipt identity is
  derived automatically from the durable delivery.
- Do not use process memory, an attempt number, or wall-clock time as the
  identity of a business effect.
- Treat a handler return as success only after every required external action
  has acknowledged its idempotent command.
- Keep errors free of row contents, secrets, provider response bodies, and
  personal data.
- Observe the supplied abort signal and keep calls within the execution
  deadline.

Handler failures retry after exponential backoff beginning at one second and
capped at five minutes. The default attempt ceiling is 20; the hard ceiling is
100. Completion and dead-letter transitions erase the stored input while
retaining bounded terminal metadata: stable identity, status, timestamps,
attempt count, and bounded error code. Each source keeps only its newest
configured terminal records. Older terminal metadata is removed atomically;
active work is never eligible for compaction, and a separate monotonic ordinal
keeps later admissions ordered across compaction and restart. Downstream
idempotency receipts remain owned by the destination, including Torrent's
system-event receipt store.

## Versioning And Compatible Deployments

Definition versions identify executable behavior. Whenever a handler's
business behavior changes, add a new function version and update the trigger
to reference it. For Fabric, also bump the explicit realm version. Keep the old
function version registered until its durable backlog reaches zero:

```ts
export const tenantAutomations = defineDatabaseAutomations({
  functions: [
    publishOrderChangeV1, // retained for already committed deliveries
    publishOrderChangeV2, // referenced by the current trigger
  ],
  triggers: [onOrderChangedV2],
});
```

An additive deployment may change the current manifest or realm fingerprint
while old deliveries remain. That drift is reported for operations, but an old
delivery can execute when its exact durable `functionIdentity` is still
registered in durable mode. A missing version or a same-identity definition
changed to transaction mode is a permanent failure and is dead-lettered. The
framework never intentionally reuses a delivery identity. While its metadata
is retained, attempting to reuse that identity with a changed command fails
closed.

Deploy the parent and every Fabric actor from the same realm module. Doctor
reports live actor/config fingerprint disagreement; drain and replace stale
actor generations rather than accepting mixed code.

## Bounds And Backpressure

The private outbox is deliberately bounded per physical source database:

| Resource | Managed default | Hard maximum |
| --- | ---: | ---: |
| Canonical payload | 1 MiB | 1 MiB |
| Active `pending` + `processing` records | 10,000 | 100,000 |
| Active payload bytes | 64 MiB | 256 MiB |
| Retained terminal records | 10,000 | 900,000 |
| Total active + terminal records | 20,000 | 1,000,000 |
| Delivery attempts | 20 | 100 |
| Processing lease | 30 seconds | 1 hour |
| Handler execution timeout | 5 minutes | 24 hours |
| Claims in one bounded drain | 100 | 1,000 |

Supported runtime integrations may lower a deployment limit but cannot raise
it above the schema hard cap. A terminal transition and source startup compact
oldest terminal metadata to the configured retention bound, and admission
rechecks compaction before evaluating total capacity. Admission checks payload
bytes, active rows, active bytes, total records, and attempts synchronously. If
active work would exceed capacity, the source transaction fails rather than
committing a change whose required effect was discarded. Completed history
therefore cannot permanently exhaust a long-lived source.

The source catalog supports at most 100,000 permanent source identities. Its
restart scan defaults to 100 sources per coherent page and is bounded at 500.
Any concurrent catalog revision invalidates the scan cursor so recovery starts
again from a coherent boundary.

Processing leases must be at least one second, and their renewal interval must
remain shorter than the lease. These bounds ensure the heartbeat can refresh a
claim without turning a stalled worker into permanent ownership.

## Errors And Privacy

Definition and composition failures use the closed `AutomationError` contract:
`AUTOMATION_DEFINITION_INVALID`, `AUTOMATION_FUNCTION_DUPLICATE`,
`AUTOMATION_TRIGGER_DUPLICATE`, `AUTOMATION_TARGET_MISSING`,
`AUTOMATION_TABLE_MISSING`, or `AUTOMATION_TABLE_INVALID`. Config and Fabric
realm admission translate invalid installed registries into the stable
`DatabaseError` configuration boundary.

Runtime failures retain `DatabaseError.code`, `retryable`, and `outcome`.
Important operational codes include `DATABASE_BACKPRESSURE`,
`DATABASE_CAPACITY_EXHAUSTED`, `DATABASE_PAYLOAD_INVALID`,
`DATABASE_PAYLOAD_LIMIT`, `DATABASE_SCHEMA_MISMATCH`,
`DATABASE_AUTHORITY_CHANGED`, and `DATABASE_EXECUTOR_FAILED`. A transaction
automation failure reports a not-committed outcome. Never infer commit status
from an exception message; use the structured outcome.

The durable row records only a bounded stable failure code such as
`AUTOMATION_HANDLER_FAILED` or `AUTOMATION_FUNCTION_UNAVAILABLE`, not the
handler exception or input. Logs and Doctor findings likewise use stable
low-cardinality codes and aggregate counters. Application handlers must not
copy row data, provider bodies, secrets, lease tokens, source references, or
Torrent receipt identities into messages or event metadata.

## Private Schema And Migrations

The automation outbox is framework-private source-local schema. The managed
runtime installs it when a durable registry starts and validates every table,
column, index, trigger, version, and invariant before accepting writes. Schema
tampering or an incompatible private version fails startup. Do not add the
outbox to `db/schema.ts`, expose it as a Resource, query it from application
code, include it in Sync, or create an app migration for it.

Two system migrations support the complete bridge:

- `036_workflow_system_event_receipts` adds Torrent's immutable system-event
  receipt used for exact retry-safe delivery.
- `037_database_automation_source_catalog` adds the private system-plane source
  catalog used to recover pinned, named, and tenant outboxes after restart.

Apply managed system migrations before enabling durable functions. Fabric
realm migrations remain app-owned and run independently in each source file;
the private outbox is installed by its source runtime after the realm is ready.

## Operations And Diagnostics

Run Platform Doctor against the exact config used for deployment:

```sh
bun run doctor -- --config ./zero.config.ts
bun run doctor -- --config ./zero.config.ts --strict
```

The normal config run checks:

- definition identities, collisions, function targets, trigger tables, and
  filtered update columns;
- the canonical manifest and automation fingerprint;
- fresh Fabric realm admission;
- durable source storage, source-local outbox, and dispatcher readiness;

Runtime/operator tooling can import `checkDatabaseAutomations()` from
`@zero/framework/doctor` and additionally supply live actor fingerprints plus
aggregate queue health. That adds configured/live realm drift, pending,
processing, total backlog, dead, stale-lease, warning-threshold, and hard-limit
findings without giving Doctor access to individual work items.

Doctor and observability receive aggregate counters and stable low-cardinality
codes only. They do not receive trigger inputs, row IDs, delivery IDs, lease
tokens, Torrent receipt keys, source paths, exception messages, or payloads.
Application handlers must follow the same rule when emitting their own events.

At startup, a durable dispatcher scans the trusted source catalog, opens only
registered active sources, validates the realm/outbox binding, recovers expired
leases, and drains due records. During graceful shutdown it stops new claims,
aborts active handlers, awaits their fenced cleanup, and leaves unfinished work
recoverable by lease expiry. A restart therefore does not require an operator
to replay source mutations.

Respond to findings as follows:

| Finding | Required response |
| --- | --- |
| Registry, manifest, table, or column error | Correct declarations before startup |
| Actor or realm fingerprint drift | Stop mixed generations and redeploy parent and actors together |
| Ephemeral source or missing outbox/dispatcher | Move the source to durable storage and restore managed delivery before accepting writes |
| Stale leases | Restore the recovery dispatcher and source connectivity |
| High backlog | Check downstream latency/failures and worker throughput before capacity is reached |
| Dead deliveries | Investigate the stable failure code, repair the downstream contract, and make an explicit versioned or compensating recovery decision; never edit private rows |

## Deployment Checklist

1. Back up the system and application/Fabric source databases.
2. Apply the managed system migrations, including `036` and `037`.
3. Declare JSON-safe trigger inputs and bounded function behavior.
4. Use transaction mode only for synchronous same-source work.
5. Give every external durable effect a stable destination idempotency
   contract.
6. Import the registry explicitly into top-level config or the Fabric realm.
7. Import the same realm module in the parent and actor entrypoint.
8. Keep old durable function versions until their backlog is drained.
9. Run Doctor in strict mode and resolve every automation error.
10. Exercise rollback, retry, restart recovery, authority revocation, and exact
    Torrent resume in a production-shaped test environment.

See also:

- [ReactiveDB server design](../realtime-sync/realtime-sync/reactive-db.md)
- [ReactiveDB Fabric architecture](./multi-database-architecture.md)
- [Platform configuration](../platform-configuration.md)
- [Torrent durable workflows](../workflows.md)
- [Migrations](../migrations.md)
- [Observability](../observability.md)

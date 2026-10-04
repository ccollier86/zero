# Torrent: Durable Workflows

**Source:** `src/workflows/`

**Related client/runtime files:** `src/frontend/client/workflow-hooks.ts`,
`src/frontend/client/workflow-run-hooks.ts`,
`src/frontend/client/workflow-topology-hooks.ts`, and
`src/frontend/server/app-factory.ts`

**Torrent** is Zero's durable workflow system: versioned execution graphs
backed by SQLite and ReactiveDB. A workflow can run ordinary activities,
choose a branch, execute parallel branches, fan out over an array, wait for an
event, or pause for a human or external-system response. Runtime progress is
projected through owner-scoped ReactiveDB Sync, so an authorized browser can
render a live run without polling.

Torrent is the product and documentation name. The established public API
vocabulary remains `workflows`: configuration stays under
`AppConfig.workflows`, imports stay under `@zero/framework/workflows`, HTTP
routes stay under `/workflows`, and existing table names, error codes, and
observability codes do not change.

New graph definitions share one canonical execution model across several
authoring surfaces:

- The TypeScript DSL is the normal app-code surface.
- The canonical JSON-safe graph IR is the storage, API, agent, and future
  visual-editor contract.
- Immutable database definitions and mutable drafts use the same IR.
- Separately, the Zero 1.3 sequential `steps` compatibility path remains
  supported and keeps its established behavior.

Activities are trusted server functions. Graphs contain only serializable
data and version-pinned activity references; persisted definitions never
contain closures or executable source strings.

## Enable And Register

Torrent is enabled by default when auth is enabled. Set `workflows: false` to
omit the workflow subsystem. Register activities and code-authored definitions
in the application configuration callback:

```ts
import { t } from 'elysia';
import { defineZeroConfig } from '@zero/framework/server';
import {
  choose,
  each,
  expr,
  flow,
  otherwise,
  parallel,
  requestAndWait,
  step,
  when,
} from '@zero/framework/workflows';
import { tables } from './db/schema';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  tables,
  auth: true,
  workflows: {
    register(registry) {
      registry.registerActivity({
        name: 'patients.load',
        version: '2',
        default: true,
        inputSchema: t.Object({ intakeId: t.String() }),
        outputSchema: t.Object({
          urgent: t.Boolean(),
          patients: t.Array(t.Object({ id: t.String() })),
        }),
        handler: async (ctx) => loadPatients(ctx.input, ctx.signal),
      });

      registry.registerActivity({
        name: 'insurance.check',
        version: '1',
        inputSchema: t.Object({ id: t.String() }),
        handler: async (ctx) => {
          const result = await checkInsurance(ctx.input, {
            signal: ctx.signal,
            idempotencyKey: ctx.idempotencyKey,
          });
          ctx.memory?.set('last-provider', result.provider);
          return result;
        },
      });

      registry.registerActivity({
        name: 'approval.email',
        version: '1',
        handler: async (ctx) => {
          // Delivery activities receive { interactionId, request } as input
          // and privacy-safe interaction metadata on ctx.interaction.
          await sendApprovalEmail(ctx.input, ctx.idempotencyKey);
          return { delivered: true };
        },
      });

      registry.registerActivity({
        name: 'approval.validate',
        version: '1',
        handler: async (ctx) => {
          const response = ctx.input as { approved: boolean };
          return response.approved
            ? { valid: true, value: response }
            : {
                valid: false,
                code: 'approval_required',
                publicMessage: 'Approval is required.',
              };
        },
      });

      for (const name of ['notify.team', 'audit.write', 'summary.build']) {
        registry.registerActivity({
          name,
          version: '1',
          handler: async (ctx) => runAppActivity(name, ctx),
        });
      }

      registry.create({
        name: 'patient-intake',
        version: 1,
        inputSchema: t.Object({ intakeId: t.String() }),
        access: {
          start: ['clinician'],
          inspect: ['clinician', 'reviewer'],
        },
        flow: flow(
          step('load-patients', 'patients.load'),
          choose(
            'route',
            when(
              expr.eq(expr.output('load-patients', 'urgent'), true),
              step('notify-urgent', 'notify.team'),
            ),
            otherwise(step('record-normal', 'audit.write')),
          ),
          parallel('prepare-review', {
            audit: [step('record-review', 'audit.write')],
            summary: [step('build-summary', 'summary.build')],
          }),
          requestAndWait('approval', 'approval.submitted', {
            delivery: ['approval.email'],
            validator: 'approval.validate',
            request: { title: 'Review the patient intake' },
            inputSchema: {
              type: 'object',
              required: ['approved'],
              properties: { approved: { type: 'boolean' } },
            },
            maxRejections: 5,
            timeoutMs: 24 * 60 * 60 * 1_000,
          }),
          each(
            'check-patients',
            expr.output('load-patients', 'patients'),
            flow(step('check-insurance', 'insurance.check', {
              input: expr.item(),
              retries: 3,
            })),
            {
              itemKey: expr.item('id'),
              concurrency: 4,
              onInvalid: 'skip',
              onError: 'collect',
            },
          ),
        ),
      });
    },
  },
});
```

`AppWorkflowsConfig` has four optional settings:

| Option | Default | Contract |
| --- | --- | --- |
| `register` | No callback | Registers trusted activities and code-authored definitions during app composition. It receives `(registry, { ai })`, where `ai` is this app's isolated `AIService` or `null`. Zero awaits synchronous or asynchronous registration before recovery and service publication. |
| `onServiceCreated` | No callback | Synchronously observes this app's recovered, published `WorkflowService`. Use it to bind an app-local integration already registered in `register`; throwing rolls startup back. |
| `shutdownGraceMs` | `30_000` | Maximum time to wait for physical handlers to settle after cancellation during shutdown. It must be a safe integer from `0` through `2_147_483_647`. |
| `interactionAuthority` | Built-in starter-only authority | Replaces Torrent's default human/agent response policy with one fail-closed Guardian/app `WorkflowInteractionAuthority`. It does not grant run inspection or lifecycle authority. |

Omitting `workflows` is equivalent to the enabled default when auth is on;
`workflows: {}` accepts all defaults. `workflows: false` is the explicit
opt-out. These are app-composition settings, not per-definition graph options.

Register each activity before definitions that reference it. Registration and
compilation reject malformed graphs, unknown options, missing activities,
unsafe expressions, invalid limits, cycles, ambiguous fan-out, unreachable
nodes, and invalid schemas before execution begins.

The registry holds trusted handlers and compiled definitions in memory while
ReactiveDB persists durable execution state. Private authority seals, attempt
leases, graph coordination, memory, and interaction details live in
underscore-prefixed, non-Sync tables. Publicly named workflow tables are still
subject to policy: definitions stay outside generic Sync and runtime rows are
owner-filtered. In multi-tenant mode, a global `users.role=admin` value does
not by itself grant peer-workflow access inside an organization.

`createWorkflowPlugin()` constructs its registry during composition. In a
managed app, prefer `workflows.register`; Zero awaits that callback before
recovery. Direct plugin composition can use `getWorkflowRegistry()` after
composition and before `listen()`. Do not register definitions or activities
from request handlers or after the server starts.

## Upgrading Existing Torrent Applications

Existing sequential workflow definitions do **not** need to be rewritten to
use Torrent. The `steps` shape and `registerHandler()` remain supported, and an
application can convert one definition at a time to `flow` later. An upgrade
does, however, have two separate operator actions:

1. update the `@zero/framework` package; and
2. apply the pending framework migrations to the database that owns Torrent.

`zero update` performs only the first action. It does not run migration
commands, rewrite application source, or move database rows. Managed
`createApp()` runs pending framework migrations for a non-ephemeral database
when `migrate` is left at its default `true`, but a production upgrade should
still be planned, backed up, and applied while traffic is stopped. An app with
`migrate: false` must run the migration command explicitly before startup.

### Compatibility at a glance

| Upgrade | Workflow-definition rewrite | Database action | Application action |
| --- | --- | --- | --- |
| Zero 1.3.x to 1.3.3 | No; existing sequential and graph definitions remain valid | Apply any missing `030`, `032`, and `033` to the existing combined application database | Register handlers and activities before recovery; keep one Torrent owner for the database |
| Zero 1.3.x to 2.0 | No all-at-once rewrite; `steps` remains supported | Perform the app-specific offline system/application split, then apply the 2.0 framework registry to `systemDb` | Adopt Guardian/Fabric configuration, update managed raw start call sites to actor/system authority, and retain every implementation required by a recoverable run |
| One definition from `steps` to `flow` | Optional, definition by definition | No special migration beyond the installed Torrent schema | Publish a new immutable version; do not rewrite a version used by an existing run |

### Staying on the maintained 1.3 line

Use this path when the application must retain its combined database and does
not yet want Guardian, Fabric, or the 2.0 database split:

1. Stop every process that can use the database. Do not introduce the runtime
   ownership generation while an older Torrent runtime can still write.
2. Capture a restorable SQLite backup, including committed WAL content, and
   preserve the current package, lockfile, configuration, and environment.
3. Check out the exact `v1.3.3` source (or the maintained `release/1.3`
   branch), then preview and install it through the explicit local path. Do not
   use the main-branch `zero-update` wrapper for an app that is staying on 1.3.
4. Against the exact configured combined database, inspect status, apply the
   pending registry, and inspect status again. Use the app's existing scripts;
   pass `--db` when they do not already pin the path.
5. Start one runtime, let registration and recovery finish, and verify
   nonterminal runs before admitting traffic.

```bash
# Run from the Zero 1.3.3 checkout.
bun run zero update --project /path/to/app --local /path/to/zero-1.3 --dry-run
bun run zero update --project /path/to/app --local /path/to/zero-1.3 --check

# Run from the application. Keep this path equal to AppConfig.db.
bun run migrate:status -- --db /absolute/path/to/app.db
bun run migrate -- --db /absolute/path/to/app.db
bun run migrate:status -- --db /absolute/path/to/app.db
```

An app already on 1.3.1 or 1.3.2 may have no pending Torrent migration;
1.3.2's interaction-event recovery fix and 1.3.3's reusable frontend additions
do not add another numbered migration. Trust the status command and ledger,
not an assumed starting version. Never edit or re-checksum an applied
migration.

### Moving from 1.3 to 2.0

This is a breaking topology adoption, not the next step of the 1.3 patch
procedure. Zero 2.0 stores all Guardian and Torrent state in `systemDb`; `db`
contains application-owned data. Startup detects a legacy combined layout and
fails closed. It does not split that database automatically.

Use this sequence:

1. Prefer first reaching 1.3.3 and proving its migrations and recovery. This
   is a staging recommendation, not permission to skip the 2.0 split.
2. Drain, complete, or deliberately cancel every nonterminal 1.3 workflow.
   A 1.3 run has no 2.0 Guardian execution-authority seal. Migration `014`
   creates the authority tables but does not invent authority for an existing
   run; managed 2.0 recovery fails a nonterminal run with missing or invalid
   authority rather than dispatching it under guessed privilege.
3. Stop all old runtimes and take one consistent backup of the combined
   database and every related storage asset.
4. Follow the app-specific offline split in
   [System and Application Database Planes](./framework/system-database.md#existing-application-upgrade).
   Preserve the migration ledger and the complete Zero/Guardian/Torrent state
   in the new system plane, retain business tables in the application plane,
   and seed the documented ID-only identity anchors needed by application
   foreign keys. Do not point `db` and `systemDb` at the same file.
5. Configure a durable `systemDb` explicitly. Run the framework migration
   status and migration commands against that system database only. Run app
   schema Doctor/plan separately against the application database.
6. Complete the applicable Guardian profile and Administration Organization
   adoption steps before admitting traffic. Follow the
   [installed auth-profile upgrade contract](./platform-configuration.md#installed-auth-profile-and-mode-upgrades)
   and, where applicable, the
   [Administration Organization adoption procedure](./auth/platform-administration.md#adopting-the-administration-organization-on-a-pre-024-installation).
   A package change or migration cannot infer tenant ownership, application
   roles, or the administration organization for a populated app.
7. Register all handlers, activity versions, and code definitions before
   recovery, then start one Torrent owner and verify status, definition
   versions, completed history, and new actor/system starts.

The 2.0 registry applies missing migrations `008` through `029` and guarded
migration `031`. If the extracted ledger already records `030`, `032`, and
`033`, those versions are not rerun. Migration `031` rebuilds the affected
workflow relations for tenant integrity and reinstalls the final `033`
constraints. Its file-backed migration requires the normal backup. Do not
delete ledger rows to force an already-applied migration to run again.

Managed request code should start work through the scope-closed
`zero.workflows` facade. A plugin or trusted job holding the raw 2.0 service
must replace a managed raw `start()`/`run()` call with `runAsActor()` or the
explicitly privileged `runAsSystem()`. This is a caller-authority change, not a
rewrite of the workflow definition.

### Definitions, versions, and recovery

- Keep every `registerHandler()` key needed by a nonterminal sequential run.
  Keep every exact registered activity version referenced by a nonterminal
  graph or database definition. Recovery validates the complete set before it
  publishes the service.
- Move registration into `workflows.register` if it currently happens in an
  `onStart` hook, request handler, or after `listen()`. Managed Zero awaits the
  callback before recovery. Direct plugin composition must finish registration
  after composition and before `listen()`.
- Migration `030` backfills an immutable version only when the legacy snapshot
  can be canonicalized and matched. Ambiguous history remains on the proven
  sequential path; the migrator does not guess.
- Published code and database versions are append-only. Existing runs remain
  pinned. Publish and activate a new version for changed behavior instead of
  editing graph JSON, fingerprints, or active-version rows directly.
- Database-defined versions and drafts remain durable database state; no JSON
  re-entry is required for a 1.3 patch. A 2.0 split must transfer them with the
  rest of Torrent's system state. Migration `031` preserves and validates the
  stored scope tuple rather than guessing a new tenant assignment.
- Database-authored definitions remain data, not executable source. Every
  referenced implementation must still be registered in application code with
  `databaseCallable: true`, including interaction delivery, validation, and
  `each` activities.
- Exactly one live `WorkflowService` generation may own a physical workflow
  database. A second owner receives retryable `WORKFLOW_RUNTIME_OWNED`; it must
  not be treated as a cue to bypass or delete the lease.

### Backup and rollback

Treat package code, configuration, the migration ledger, and database files as
one release unit. A package downgrade does not undo schema changes.

- For a failed 1.3 patch upgrade, stop all writers and restore both the old
  package/lockfile and the pre-migration combined-database backup. Older
  migrators can refuse a database whose ledger contains unknown newer
  versions.
- For a failed 2.0 adoption, restore the complete pre-cutover asset set, or the
  complete verified post-split system/application set. Do not try to recombine
  planes or restore only one file while writes continue.
- `--down-to` is not a substitute for a data backup. A `down()` migration can
  restore only what it explicitly implements; it cannot recreate lost rows,
  execution authority, or an earlier database topology.

See [Migrations](./migrations.md) for ledger, status, backup, checksum, and
rollback contracts, and [Releasing Zero](./releasing.md#maintained-13-compatibility-line)
for the maintained 1.3 package-update boundary.

### Execution authority and race guarantees

An authenticated start uses `runAsActor()`. Zero captures a secret-free
reference to the already hydrated Guardian credential—either a live session or
an explicitly admitted user API key—and derives the application or tenant
scope from live server authority; workflow input never selects a tenant. The
private, MAC-protected authority seal records the credential kind and stable
identity, the session or API-key generation fence, account security generation,
tenant and membership authorization generations, advanced-role assignment
revision, effective roles and permissions, and a keyed digest of server-owned
user properties. It contains no bearer token, API-key secret, refresh token,
cookie, password, signing key, or raw user-property values.

Before dispatch and again before accepting asynchronous output, Zero verifies
the authority seal and the current attempt lease. A revoked or expired session
or API key, suspended account, changed tenant membership or role assignment,
pause, cancellation, timeout, or replacement recovery attempt therefore
prevents stale output from committing. Authority failures are terminal rather
than retried.

Managed `createApp()` also supplies the scope-closed `ctx.zero` service facade
for storage, notifications, rooms, workflows, PDF, auth, and observability.
Those adapters fence mutations against the live actor and attempt. Every
`ctx.zero.observability` sink writer repeats the synchronous authority assertion
immediately before emission, so a captured facade cannot publish stale
user/tenant-attributed telemetry after revocation. Raw SQL,
tokens, KV, vector, email, AI, scheduler, registries, and `zero.unsafe` are not
exposed through a normal managed workflow context. For an app-owned external
effect, call `ctx.assertCurrentAuthority()` immediately before the effect and
use `ctx.idempotencyKey` to make it idempotent.

### Torrent state and Fabric data planes

Managed Torrent persistence always belongs to Zero's system ReactiveDB. This
includes public run, step, event, and interaction rows as well as private
authority seals, graph state, event delivery, attempt leases, scratch memory,
and runtime ownership. Enabling Fabric does not copy those tables into the
application database or a tenant database. Workflow payloads remain private
system-plane data; browser Sync receives only the filtered and redacted public
progress projection described below.

An actor activity receives `ctx.zero.data` only when all of these conditions
are true:

- Guardian resolved a live tenant scope for the run.
- `databaseTopology.mode` is `multiple`.
- `databaseTopology.tenantIsolation` is `tenant-database`.

The value is an `AsyncDatabaseClient` closed over the tenant ID from the run's
MAC-verified execution authority. It exposes no database name, path, tenant
selector, `DatabaseManager`, raw SQLite handle, or `zero.unsafe` escape. Every
operation binds that same tenant actor and repeats the live authority and
physical-attempt checks before its result can escape. Recovery reconstructs
the capability from the persisted authority, so a wait can survive a process
restart and resume against the same tenant file without retaining a bearer
token.

In single-database mode and multiple-database `shared-row` mode,
`ctx.zero.data` is `null`. Multiple/shared-row mode may still provide named
databases to trusted setup or operator code through the raw server-side
`DatabaseManager`; that manager and `zero.databases` are deliberately absent
from managed activity contexts. Pass a deliberately scoped service into
trusted application code when a workflow activity must use a named database.

The browser observes the two durable effects over their owning Sync planes:
workflow progress comes from the system plane, while a physical tenant-table
mutation comes from the tenant plane. The SDK multiplexes both planes on one
connection, but system policy still owner/manager-filters workflow progress
and the tenant plane remains bound to the selected tenant. Another tenant
receives neither the app row nor the run's progress.

System workflow state and a Fabric tenant file do not form a distributed SQL
transaction. Pause, cancellation, timeout, recovery replacement, or Guardian
revocation fences an activity before dispatch and rejects a queued tenant
write before actor admission. An external effect that already committed cannot
be rolled back by a later workflow transition. Activities must therefore use
`ctx.idempotencyKey`, honor `ctx.signal`, and call
`ctx.assertCurrentAuthority()` immediately before effects outside Zero's
scope-closed adapters.

## Activities And The Trust Boundary

`registry.registerActivity()` registers one immutable application-code
implementation:

```ts
registry.registerActivity({
  name: 'documents.render',
  version: '3',
  description: 'Render and persist one document',
  inputSchema: t.Object({ documentId: t.String() }),
  outputSchema: t.Object({ objectId: t.String() }),
  capabilities: ['database', 'storage'],
  databaseCallable: true,
  default: true,
  handler: async (ctx) => ({ objectId: await renderDocument(ctx) }),
});
```

The important fields are:

| Field | Contract |
| --- | --- |
| `name` + `version` | Immutable activity identity. `version` defaults to `1`. |
| `default` | Selects the version used when a new definition omits one. Otherwise the deterministic latest registered version is selected. |
| `inputSchema` / `outputSchema` | TypeBox validation before invocation and before durable output commit. |
| `capabilities` | Descriptive metadata for inspection and policy adapters. |
| `databaseCallable` | Explicit permission for database/API/visual definitions to reference the activity. Defaults to `false`. |
| `handler` | Trusted server code. It is never serialized into the graph. |

Compilation resolves every reference to an exact activity version before the
definition is fingerprinted. Changing the catalog default affects only future
definitions; an existing version and every run pinned to it keep the original
activity version.

Database-authored definitions are untrusted data. They can call only
activities whose app-code registration sets `databaseCallable: true`. This
applies to ordinary nodes, interaction delivery activities, interaction
validators, and `each` bodies. The check occurs when a graph is published and
again when it is started or recovered.

`registerHandler()` remains the compatibility surface for sequential Zero 1.3
workflows. It registers activity version `1` as code-only. New graph workflows
should use `registerActivity()`.

### Legacy-compatible root tables

The original Zero 1.3 table names remain the roots of the current workflow
schema, but the columns below describe the upgraded schema rather than frozen
1.3 DDL. ReactiveDB tracks these tables. Their lack of an `_` prefix does not
bypass platform policy: direct Sync writes are protected,
`workflow_definitions` remains private to generic Sync, and execution rows are
owner-filtered and payload-redacted. The underscore-prefixed version, graph,
memory, event-delivery, and interaction-detail tables remain server-only.

### workflow_definitions
| Column | Type | Notes |
|--------|------|-------|
| definition_id | TEXT PK | UUID |
| name | TEXT | Workflow name; unique only within `(scope_type, scope_id)` |
| version | INTEGER | Latest published definition version number; not the graph schema version |
| steps_json | TEXT | Legacy sequential snapshot or active-version compatibility mirror |
| input_schema | TEXT | Optional active input-schema compatibility mirror |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |
| active_version_id | TEXT nullable | Currently selected immutable version |
| source | TEXT | `code` or `database` |
| scope_type / scope_id | TEXT | Application or tenant definition namespace |
| status | TEXT | Catalog lifecycle status: `active` or `retired` |
| access_policy_json | TEXT nullable | Canonical start/inspect policy mirror |
| created_by / updated_by | TEXT nullable | Definition-management actor IDs |

### workflow_instances
| Column | Type | Notes |
|--------|------|-------|
| instance_id | TEXT PK | UUID |
| tenant_id | TEXT nullable | Server-stamped active tenant; `NULL` is legacy application scope in single mode |
| definition_id | TEXT | FK to definitions |
| name | TEXT | Workflow name (denormalized for queries) |
| status | TEXT | WorkflowStatus enum |
| current_step | INTEGER | Index of current/next step |
| input | TEXT | Server-only JSON workflow input; projected as `null` to clients |
| output | TEXT | Server-only JSON workflow output; projected as `null` to clients |
| error | TEXT | Server-only bounded failure; projected as `null` to clients |
| started_by | TEXT | Optional caller identifier |
| steps_json | TEXT | Definition snapshot used by this instance |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |
| completed_at | TEXT | Optional completion timestamp |
| definition_version_id | TEXT nullable | Private storage relation to the pinned immutable version |
| definition_version | INTEGER nullable | Public pinned version number |
| graph_json | TEXT nullable | Private canonical executable snapshot |
| graph_fingerprint | TEXT nullable | Public immutable topology identity |

### workflow_steps
| Column | Type | Notes |
|--------|------|-------|
| step_id | TEXT PK | UUID |
| tenant_id | TEXT nullable | Copied from the owning instance for direct Sync/query filtering |
| instance_id | TEXT | FK to instances |
| step_index | INTEGER | Ordered position |
| step_name | TEXT | Human-readable step name |
| status | TEXT | StepStatus enum |
| input | TEXT | Server-only JSON node input; projected as `null` to clients |
| output | TEXT | Server-only JSON node output; projected as `null` to clients |
| error | TEXT | Server-only bounded failure; projected as `null` to clients |
| retries | INTEGER | Physical attempts already used |
| max_retries | INTEGER | Total-attempt budget, including the first invocation; defaults to 3 |
| retry_at | TEXT | ISO timestamp for next retry |
| wait_event | TEXT | Event name this step waits for |
| timeout_at | TEXT | ISO timestamp for step deadline |
| started_at | TEXT | Optional execution start timestamp |
| completed_at | TEXT | Optional completion timestamp |
| created_at | TEXT | ISO timestamp |
| node_id / node_kind / node_path | TEXT nullable | Stable graph and presentation identity |
| parent_step_id / branch_key | TEXT nullable | Delivery/fan-out parent and selected lane |
| item_key / item_index | TEXT / INTEGER nullable | Private fan-out key and public ordered position |
| activation_key | TEXT nullable | Private durable activation identity |
| updated_at | TEXT nullable | Latest transition timestamp |

### workflow_events
| Column | Type | Notes |
|--------|------|-------|
| event_id | TEXT PK | UUID |
| tenant_id | TEXT nullable | Copied from the owning instance for direct Sync/query filtering |
| instance_id | TEXT | FK to instances |
| event_name | TEXT | Event identifier |
| payload | TEXT | Server-only JSON event payload; projected as `null` to clients |
| sent_by | TEXT | Optional sender identifier |
| created_at | TEXT | ISO timestamp |

### workflow_interactions
| Column | Type | Notes |
|--------|------|-------|
| interaction_id | TEXT PK | Durable request/response identity |
| tenant_id | TEXT nullable | Copied from the owning instance |
| instance_id | TEXT | Immutable owning run |
| node_id | TEXT | Required wait-node identity |
| step_id | TEXT nullable | Optional durable step identity; unique with `instance_id` |
| safe_label | TEXT | Browser-safe operational label |
| status | TEXT | `open`, `accepted`, `expired`, `cancelled`, or `rejection_limit` |
| opened_at | TEXT | Request-open timestamp |
| expires_at / accepted_at | TEXT nullable | Optional expiry and acceptance timestamps |
| accepted_by | TEXT nullable | Accepted actor identity |
| rejection_count / max_rejections | INTEGER | Current and maximum rejected submissions |
| created_at / updated_at | TEXT | Persistence timestamps |

## The Code DSL

The DSL builds inert descriptors and compiles them into canonical graph IR:

| Builder | Meaning |
| --- | --- |
| `flow(...nodes)` | Ordered dependency chain. |
| `step(id, activity, options?)` | Invoke one registered activity. |
| `choose(id, when(...), otherwise(...))` | Select the first true branch, otherwise the required fallback. |
| `parallel(id, branches)` | Start named branches together and continue after their generated all-branches join. |
| `each(id, source, body, options?)` | Snapshot an array and invoke one activity for each item with bounded concurrency; use `visibility: 'private'` when item payloads must not enter public run/step rows. |
| `waitFor(id, event, options?)` | Wait for a named durable event. |
| `requestAndWait(id, event, options?)` | Open a durable interaction, optionally deliver a request, and wait for one accepted response. |

Node IDs are stable persistence and visualization identities. Use meaningful,
trimmed IDs and keep them stable across edits. IDs under `@zero/` are reserved
for compiler-generated joins and other control nodes.

### Serializable expressions

New graphs use the `expr` AST rather than JavaScript source strings:

```ts
const eligible = expr.and(
  expr.eq(expr.input('account.active'), true),
  expr.gte(expr.output('score-account', 'score'), 80),
  expr.includes(expr.memory('allowedStates'), expr.input('state')),
);
```

References can read `input`, `previous`, durable `memory`, a named node
`output`, the current `item`, or `itemIndex`. A wait's accepted payload is that
wait node's output and can be consumed as `previous` or by its named output.
Operators include `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `and`, `or`, `not`,
`exists`, and `includes`. Expressions are size/depth bounded, side-effect free,
and use safe path traversal. `item` and `itemIndex` references are valid only
in an `each` item-key or body-activity context. The same JSON shape works in
TypeScript, the admin API, an agent, or a visual editor.

### Choices

`choose()` evaluates branches in declaration order, selects exactly one, and
persists that decision. Recovery does not reevaluate the condition against
later state. `otherwise()` is required, making the route deterministic.

### Parallel branches and joins

`parallel()` starts every named branch whose dependencies are ready. Branches
can execute concurrently, and different workflow instances remain concurrent.
The compiler creates an explicit `strategy: 'all'` join; downstream work is
not ready until every selected branch reaches that join. Public step rows keep
the node and branch identities needed to draw the live fan-out and join.

### Array fan-out

`each()` resolves and durably snapshots its source array once. It then invokes
the body activity per item, up to `concurrency` at a time. `itemKey` creates a
stable identity; without it, the array index is used. Every child receives:

```ts
ctx.item // { value, index, key }
```

`itemSchema` validates each snapshot item. `onInvalid: 'fail' | 'skip'`
controls invalid input, while `onError: 'fail' | 'collect'` controls exhausted
item failures. Collected results retain input order. Each item has its own
scratch-memory namespace and idempotency key. Fan-out is bounded at 10,000
items and 100 concurrent items per node. An explicit `itemKey` must resolve to
a unique, non-empty string or number of at most 256 characters; the default is
the item index.

With the fail/fail defaults, the node output is the ordered array of activity
outputs. When either skip or collect behavior is enabled, each output position
is explicit: `{ ok: true, value }` for success or
`{ ok: false, skipped, error }` for an invalid/failed item.

An `each` body is one activity invocation. Put a reusable multi-step sequence
inside that activity, or model additional graph work after the aggregated
`each` result.

`visibility` defaults to `'public'`. With `visibility: 'private'`, Torrent
stores the snapshotted source, item inputs, and item outputs only in its
underscore-prefixed private execution tables. The public parent and child step
rows retain safe topology, status, labels, indexes, and timing, but their
payload-bearing input/output columns remain `null`. Private fan-out items also
share the run's instance scratch-memory namespace so a trusted downstream
activity can assemble results without copying them through a public aggregate
output. This is a projection boundary, not encryption: keep credentials in a
secret manager and continue to authorize every effect.

## Canonical Graph IR

The compiler emits `WorkflowGraphIR` schema version `1`:

```ts
interface WorkflowGraphIR {
  schemaVersion: 1;
  entry: string;
  nodes: readonly WorkflowIRNode[];
  edges: readonly WorkflowIREdge[];
}
```

`@zero/framework/workflows` exports the DSL builders, expression helpers, IR
types and limits, graph compiler/validator helpers, the activity catalog
contracts, and `normalizeWorkflowSchemaSnapshot()`,
`rehydrateWorkflowSchema()`, and `validateWorkflowSchemaValue()`. Agent,
editor, and deployment tooling should share these contracts instead of
inventing a second graph shape.

For example, this graph can be submitted by an admin tool after `check-order`
and `complete-order` have been registered as database-callable:

```json
{
  "schemaVersion": 1,
  "entry": "check",
  "nodes": [
    {
      "id": "check",
      "kind": "activity",
      "label": "Check order",
      "activity": { "name": "check-order", "version": "2" }
    },
    {
      "id": "completed",
      "kind": "activity",
      "label": "Complete order",
      "activity": { "name": "complete-order", "version": "1" }
    }
  ],
  "edges": [
    { "id": "check-to-completed", "from": "check", "to": "completed" }
  ]
}
```

Canonicalization sorts topology deterministically, validates the entire graph,
deep-freezes compiled values, and fingerprints the graph together with its
input schema, access policy, graph format, and schema version. The runtime
pins the canonical graph JSON, version ID, version number, and fingerprint to
each new instance. Recovery verifies that immutable history and the run
snapshot still agree before dispatching work.

Publication also validates every expression in its execution context. A named
`expr.output(nodeId, path?)` reference must name an existing node that
dominates its consumer: that output must be guaranteed to exist on every path
that can reach the expression. A value produced only by one choice branch,
for example, cannot be read after the join as though every branch produced it.
After a parallel join, consume the join's deterministic branch-keyed
`previous` value rather than reaching through to a branch-only node. Invalid
references fail at compile/publish time instead of becoming `undefined` during
a run.

### Durable schema snapshots

Workflow definition, wait, and `each` item schemas accept TypeBox schemas or
plain JSON Schema. Zero snapshots them as JSON-safe data and restores TypeBox
runtime kind metadata when validating. The durable form carries
`x-zero-typebox-kind`; tools that round-trip a definition must preserve that
extension. Executable TypeBox transforms, accessors, functions, cycles,
unsupported symbol metadata, and other non-data values are rejected. Put data
normalization in a trusted activity or interaction validator instead of a
schema transform.

Each canonical definition or draft content envelope—graph, input schema,
access policy, graph format, and schema version—is capped at 2 MiB. Draft
editor metadata has an independent 2 MiB cap. Oversized or non-canonical
publish/draft content fails with HTTP `422` and
`WORKFLOW_DEFINITION_GRAPH_INVALID`.

The main bounded-publication limits are:

| Area | Limit |
| --- | --- |
| Graph topology | 1,000 nodes and 4,000 edges across nested graphs; nesting depth 16 |
| Parallel node | 2–64 branches |
| `each` node | concurrency 100 at publication; 10,000 snapshotted items at runtime |
| Interaction delivery | 32 delivery activities and 1,000 maximum rejections |
| Expression AST | depth 32, 512 nodes, and 64 safe path segments |
| Durable schema snapshot | depth 128 and 100,000 members |
| Definition/draft content envelope | 2 MiB of canonical UTF-8 JSON |

The IR is the visual-editor boundary: editor positions and other mutable UI
metadata belong on a draft, while executable nodes and edges belong in the
canonical graph. Definitions, drafts, IR, conditions, and activity references
are server-only and never enter browser Sync.

## Immutable Definition Versions

Code-authored `flow`/`graph` definitions and database-authored graph
definitions use the same append-only version store:

- Publishing identical canonical content is idempotent and reuses the existing
  fingerprinted version.
- Automatic versions increase monotonically. An explicit positive `version`
  is accepted only if it advances history or exactly matches existing content.
- `activate` defaults to `true`. Starting without a version selects the active
  database version; passing `{ version }` pins a specific published version.
- Activating a version atomically changes the default for future starts.
- Retiring a version prevents new resolution and activation. Existing pinned
  runs still recover against it.
- Definition source and scope are immutable. Code and database authors cannot
  silently take over one another's definition history.
- Published version content cannot be updated or deleted. Drafts are mutable,
  revision-fenced editing state outside published history.
- Publishing a draft requires its current positive `expectedRevision`. The
  revision and canonical fingerprint are rechecked in the same writer
  transaction that appends the immutable version, so an edit racing publication
  fails with `WORKFLOW_DRAFT_CONFLICT` instead of publishing stale content.
- Catalog-head creation, activation, retirement, and latest-version updates use
  tracked ReactiveDB writes, so server-side administration subscribers observe
  committed changes. Definition content remains excluded from browser Sync.

Definition identity is the complete `(scope_type, scope_id, name)` tuple. Code
definitions always belong to application scope and remain available to tenant
execution. A tenant-scoped database definition with the same name shadows that
code definition only for that tenant. Database-authored application definitions
remain application-owned and are not exposed through tenant management. Start,
catalog, draft, publication, activation, and retirement paths all resolve the
same exact namespace; a bare global name is never an authority key.

Code definitions are compiled during registration, then published or
deduplicated when the graph runtime is constructed before recovery. You can
declare an explicit version:

```ts
registry.create({
  name: 'monthly-close',
  version: 4,
  activate: true,
  flow: flow(step('close-ledger', { name: 'ledger.close', version: '3' })),
});
```

From an app-owned request handler, the scope-closed `zero.workflows` facade
starts as the current actor. Select the active version or pin one explicitly:

```ts
const activeRun = await zero.workflows.start('monthly-close', input, userId);
const pinnedRun = await zero.workflows.start(
  'monthly-close',
  input,
  userId,
  { version: 4 },
);
```

### Database definitions and drafts

Database-authored definition management is a protected active-scope manager
surface. In single/application scope, the established platform administrator is
the manager. In multi-tenant scope, the active tenant's protected `owner` role,
`allPermissions`, or `workflows:manage` permission can manage that tenant's
database definitions. The `/admin/` path segment names the control surface; it
does not grant cross-tenant platform authority.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/workflows/admin/definitions` | List code and database catalog summaries. |
| `GET` | `/workflows/admin/definitions/activities` | List registered activity versions, schemas, capabilities, defaults, and database-callable status. |
| `GET` | `/workflows/admin/definitions/:definitionId/versions` | List immutable version metadata, newest first. |
| `GET` | `/workflows/admin/definitions/:definitionId/versions/:versionId` | Read one immutable version with its editable graph, schema, and access policy. |
| `POST` | `/workflows/admin/definitions/publish` | Validate and publish canonical graph content. |
| `PUT` | `/workflows/admin/definitions/drafts` | Create a server-identified draft, or update one with required `draftId` and `expectedRevision`. |
| `GET` | `/workflows/admin/definitions/drafts/:draftId` | Read one draft with graph, schema, access policy, and editor metadata. |
| `DELETE` | `/workflows/admin/definitions/drafts/:draftId?expectedRevision=N` | Delete a draft only when its required positive revision is current. |
| `POST` | `/workflows/admin/definitions/drafts/:draftId/publish` | Publish a validated draft; body requires `expectedRevision` and accepts the normal publication options. |
| `POST` | `/workflows/admin/definitions/:definitionId/versions/:versionId/activate` | Make one published version active. |
| `POST` | `/workflows/admin/definitions/:definitionId/versions/:versionId/retire` | Retire one version from future starts. |

Publish requests contain `{ name, graph, inputSchema?, access?, version?,
activate?, expectedActiveVersionId? }`. `expectedActiveVersionId` is a compare
fence that prevents an editor from replacing a newer active version. Draft
writes include `definitionId`, `name`, `graph`, optional schemas/policy/editor
metadata, and no caller-selected id. Updating adds the returned `draftId` and
requires its current positive `expectedRevision`; deletion requires that same
revision in the query. Missing fences are HTTP `422` `WORKFLOW_REQUEST_INVALID`,
while stale fences are HTTP `409` `WORKFLOW_DRAFT_CONFLICT`. Draft publication
requires `{ expectedRevision, version?, activate?, expectedActiveVersionId? }`.
Zero recompiles the selected draft, then atomically rechecks that exact revision
and canonical fingerprint while appending the immutable version. A draft changed
before that transaction commits is not published and returns HTTP `409`
`WORKFLOW_DRAFT_CONFLICT`.

Catalog and version-list responses expose only metadata and fingerprints.
Explicit single-version and draft reads return editable graph content to the
authenticated active-scope manager surface. Publication always revalidates graph
shape, schemas, contextual output references, canonical fingerprint, activity
versions, and the `databaseCallable` boundary on the server; an editor's local
validation is never trusted as the authorization boundary.

## Step Context And Idempotency

Activity handlers receive `StepContext`:

```ts
interface StepContext<TInput = unknown, TServices = unknown> {
  input: TInput;
  workflowInput: unknown;
  instanceId: string;
  stepIndex: number;
  attempt: number;
  attemptId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  memory?: WorkflowMemoryContext;
  item?: { value: unknown; index: number; key: string };
  interaction?: WorkflowInteractionRecord;
  waitEvent?: { id: string; name: string; payload: unknown };
  execution: WorkflowExecutionIdentity;
  zero: TServices | null;
  assertCurrentAuthority(): void;
}
```

Graph activity, delivery, and validator contexts supply `attemptId`,
`idempotencyKey`, `signal`, and `memory`; the optional TypeScript fields
preserve source compatibility. Legacy sequential handlers receive the attempt,
idempotency, and cancellation fields but leave `memory` undefined.

- `input` is the resolved node input. Without an explicit expression, it is
  the deterministic predecessor output, a branch-keyed object after a
  multi-branch join, or the original input at the entry.
- `workflowInput` always contains the original run input.
- `attempt` is the zero-based retry counter.
- `attemptId` identifies one physical invocation and changes on retry.
- `idempotencyKey` is stable for the logical node/item across retries and
  recovery. Use it to deduplicate email, payments, webhooks, storage writes,
  and other nontransactional effects.
- For durable graph nodes and delivery attempts, `signal` is aborted on pause,
  cancellation, timeout, failure, and shutdown. Cancellation is cooperative,
  so external systems still need idempotency.
- `item` is present for `each` activities.
- `interaction` is present for interaction delivery/validation activities and
  contains only safe metadata.
- `waitEvent` is the legacy sequential wait-handler envelope. A graph wait's
  accepted payload is its node output, read through `expr.previous()` or
  `expr.output(waitNodeId)` downstream.

### Actor and system starts

Workflow code encounters two deliberately different service surfaces:

- App-owned request handlers and managed workflow activities receive a
  restricted, scope-closed `zero.workflows` facade. Its `start()`/`run()` calls
  are adapted to the current live actor, enforce definition `access.start`, and
  do not accept a caller-selected tenant. Lifecycle and event methods enforce
  owner-or-active-scope-manager authority.
- Plugins, jobs, and framework internals can hold the raw `WorkflowService`.
  In a managed app its compatibility `start()`/`run()` methods fail with
  `WORKFLOW_AUTHORITY_REQUIRED`; use `runAsActor()` for end-user work or
  `runAsSystem()` for an explicit privileged principal. Only standalone
  compatibility composition can use raw `start()`/`run()` directly.

| Method | Signature | Description |
|--------|-----------|-------------|
| `runAsActor` | `(name: string, input: unknown, authContext: AuthContext, options?: WorkflowStartOptions, assertCurrentAuthority?: () => void) => Promise<instanceId>` | Derive/seal a live request credential and scope, enforce start access, optionally pin a version, seed graph-private memory, or select a bounded per-run memory policy, then execute. The fifth argument is a low-level adapter fence, not an ordinary application option. |
| `runAsSystem` | `(name, input, { principal, reason, scope }, options?) => Promise<instanceId>` | Explicit audited privileged background execution with an optional version pin, graph-private memory seed, or bounded per-run memory policy. |
| `run` | `(name, input?, startedBy?, scopeOrOptions?, options?) => Promise<instanceId>` | Standalone compatibility only; accepts `WorkflowStartOptions` directly in single-tenant mode, or a trusted scope followed by those options when scope and version are both required. Managed raw services require an actor/system method. |
| `advance` | `(instanceId, scope?) => Promise<void>` | Execute next pending step; multi-tenant callers require the validated owning scope |
| `sendEvent` | `(instanceId, eventName, payload?, sentBy?, scopeOrActor?, actor?, mutation?) => Promise<boolean>` | Persist an event under trusted scope/actor authority and report whether the legal frontier claimed it |
| `stop` | `(instanceId, scope?, mutation?) => void` | Set workflow and all pending/waiting steps to cancelled |
| `pause` | `(instanceId, scope?, mutation?) => void` | Set workflow to paused and halt advancement |
| `resume` | `(instanceId, scope?, mutation?) => Promise<void>` | Set workflow back to running and re-advance |

Compatibility aliases remain supported: `start()` for `run()`,
`startAsActor()` for `runAsActor()`, `startAsSystem()` for `runAsSystem()`, and
`cancel()` for `stop()`. In a managed Zero app, raw `run()`/`start()` cannot
silently become privileged system execution. Trusted jobs must state their
principal, reason, and scope through `runAsSystem()`.

The optional fifth `runAsActor()`/`startAsActor()` argument and the exported
`WorkflowActorAuthorityFence` and `WorkflowMutationOptions` contracts exist for
framework adapters. A scoped request or HTTP adapter admits the operation under
current Guardian authority, then carries a synchronous assertion to the final
ReactiveDB writer transaction so authorization cannot change between admission
and commit. Normal application code should use scoped `zero.workflows`, or the
four-argument actor form when it legitimately holds a live `AuthContext`.

`WorkflowStartOptions` accepts `version`, the trusted graph-only
`initialMemory` map, and a trusted `memoryLimits` override. `initialMemory` is
validated and written atomically with the new run, its authority seal, version
selection, and normalized memory policy. A failed validation or stale
authority assertion leaves none of those rows behind. The seed and policy are
never copied into Sync-visible run or step input, are not accepted by the
workflow HTTP start route, and are rejected for legacy sequential workflows.
Use them from trusted server composition for private durable context such as an
AI-agent transcript or bounded correlation state; do not turn either into a
caller-selected browser payload.

`captureActorAuthorityFence(authContext)` returns the secret-free captured
actor authority plus its `assertCurrentAuthority` callback.
`captureActorAuthorityAssertion(authContext)` returns only that callback. Pass
the callback as the actor start's fifth argument, or as
`mutation.assertCurrentAuthority` on `sendEvent()`, `stop()`/`cancel()`,
`pause()`, or `resume()`. The service invokes the callback inside the final
writer transaction. Event adapters may also carry the returned, server-captured
`actorAuthority`; `systemAuthority` is owned by `sendEventAsSystem()`. App code
must not synthesize either authority object or treat a pre-transaction check as
an equivalent fence.

```typescript
import { trustedSystemServiceDataScope } from '@zero/framework/auth';

// Authenticated app endpoint/middleware integration. The AuthContext has
// already been hydrated by Zero; tenant input is neither accepted nor needed.
await workflows.runAsActor('patient-intake', input, access.requireUser());

// Actor and system starts can pin an already-published immutable version.
await workflows.runAsActor(
  'patient-intake',
  input,
  access.requireUser(),
  { version: 4 },
);

// Trusted scheduled/plugin work. tenantScope must come from trusted server
// control-plane state, never a request body.
const tenantScope = trustedSystemServiceDataScope({
  scopeKind: 'tenant',
  tenantId: tenantRecord.tenantId,
});
await workflows.runAsSystem('daily-rollup', input, {
  principal: 'billing-rollup-plugin',
  reason: 'Nightly tenant usage aggregation',
  scope: tenantScope,
});
```

The context object is frozen. Inputs and outputs must be JSON-safe. An invalid
input or output schema and a non-serializable output fail immediately without
scheduling retries for a deterministic contract error.

Every durable runtime JSON value is capped at 1 MiB. This boundary covers run
input and output, activity input and output, structural/wait output, event
payloads, interaction requests and responses, and fan-out snapshots/results.
Run/step/fan-out input and output, scratch-memory values, interaction
policy/schema/request data, and retained submission/accepted values also share
a transactional 32 MiB aggregate budget per run. These are execution-state
limits, not file-transfer limits; store large documents in Zero Storage and
pass opaque object IDs through the workflow.

## ReactiveDB-Backed Scratch Memory

`ctx.memory` is a private durable scratchpad for values shared across workflow
nodes:

### Scoped service example

```typescript
import type {
  WorkflowExecutionServerServices,
} from '@zero/framework/server';
import type { WorkflowRegistry } from '@zero/framework/workflows';

export function registerWorkflowActivities(registry: WorkflowRegistry) {
  registry.registerActivity<
    { patientId: string },
    WorkflowExecutionServerServices
  >({
    name: 'verify-insurance',
    version: '1',
    handler: async (ctx) => {
      // Managed createApp() supplies this facade. Standalone workflow plugins
      // may leave it null unless they install an executionServices provider.
      if (!ctx.zero) throw new Error('Managed services unavailable');
      const result = await insuranceAPI.verify(ctx.input.patientId);
      return { verified: result.ok, policyNumber: result.policyNumber };
    },
  });
}
```

### Scratch-memory example

```ts
registry.registerActivity({
  name: 'quote.calculate',
  handler: async (ctx) => {
    const quote = await calculateQuote(ctx.input);
    ctx.memory?.set('quote', quote);
    const attempted = ctx.memory?.get('attemptedProviders') ?? [];
    ctx.memory?.set('attemptedProviders', [
      ...(attempted as string[]),
      quote.provider,
    ]);
    return quote;
  },
});
```

The handler API is synchronous: `get`, `has`, `set`, `update`, `delete`,
`entries`, and `toJSON`. Reads come from an attempt-local snapshot. Writes are
staged and commit in the same ReactiveDB transaction as successful node
completion, after rechecking the physical-attempt fence. A thrown error,
timeout, pause, cancellation, stale completion, or failed commit discards the
entire overlay. This prevents a failed attempt from leaking partial memory.

Normal graph nodes use the instance namespace. Every `each` item gets an
isolated namespace, so concurrent items cannot overwrite one another's keys.
Memory entries use optimistic versions and enforce bounded JSON storage. The
managed runtime allows 256-byte UTF-8 keys, 256 entries, 64 KiB per value, and
1 MiB total per namespace.

A trusted graph start can narrow or raise those defaults for that run with
`WorkflowStartOptions.memoryLimits`:

```ts
await workflows.runAsSystem('bounded-import', input, systemAuthority, {
  version: 3,
  memoryLimits: {
    maxValueBytes: 256 * 1024,
    maxEntries: 1_024,
    maxTotalBytes: 8 * 1024 * 1024,
  },
});
```

The override is a partial `WorkflowMemoryLimits` object. Torrent fills omitted
fields from the ordinary defaults, requires positive safe integers, and caps
the normalized policy at 1,024 bytes per key, 1 MiB per value, 4,096 entries,
and 16 MiB total. `maxValueBytes` cannot exceed `maxTotalBytes`. The normalized
policy is immutable for the run, persists with its private runtime state, and
is restored before recovery resumes work. It is a trusted service-only graph
contract: browser/HTTP starts cannot set it, and legacy sequential workflows
reject it.

Scratch memory is execution state, not a general app database. `_workflow_memory`
is private, excluded from HTTP and Sync, and removed with its run. Store app
records in app tables and keep large files in Zero Storage.

Trusted graph starts can seed this namespace with
`WorkflowStartOptions.initialMemory`. Seeding uses the same key, value, entry,
and aggregate policy that later `ctx.memory` writes use and commits in the
graph creation transaction. This contract is what lets integrations such as
durable AI agents begin with private prompts and typed contexts without
exposing them as public workflow input.

## Durable Waits And Interactions

Zero has two related wait primitives.

### Event waits

`waitFor()` consumes the oldest matching unclaimed durable event. `sendEvent()`
writes the durable `workflow_events` audit row and the private delivery-inbox
row in one transaction. Events sent before a wait becomes ready are buffered;
the wait claims one event durably and receives the same ID/payload through
retry and restart. Authorized clients can watch graph-event audit metadata in
real time, but the event payload is redacted at both the HTTP and Sync
projection boundaries.

```ts
waitFor('archive-ready', 'archive.ready', {
  timeoutMs: 10 * 60 * 1_000,
  inputSchema: {
    type: 'object',
    required: ['objectId'],
    properties: { objectId: { type: 'string' } },
  },
});
```

`sendEvent()` returns whether that newly inserted event was claimed before the
call returned. A paused run accepts and buffers the event but returns `false`;
resume may claim it later. Historical audit rows created before the durable
inbox existed are not replayed as new input. A claimed matching event whose
payload fails the wait schema fails that wait and the run; it is not silently
skipped in favor of a later event.

Event names are 1–200 trimmed characters. Each event payload has the 1 MiB
runtime-value limit, and an authenticated responder snapshot is privately
bounded to 32 KiB. Per run, the unconsumed delivery inbox is capped at 1,000
events or 16 MiB of payload/actor data, whichever comes first. Total retained
deliverable history is capped at 10,000 events or 64 MiB. A full pending inbox
returns retryable HTTP `429` `WORKFLOW_EVENT_QUEUE_FULL`; exhausted retained
history returns HTTP `409` `WORKFLOW_EVENT_LIMIT_EXCEEDED`.
Reserve, claim, and consume update a private O(1) usage row and monotonic
revision in the same transaction as delivery state. The revision participates
in the graph pump's lost-wakeup fence, and recovery verifies the counters
against the retained delivery rows.

For sealed events, `actor_bytes` and both event byte quotas include the private
actor JSON, authority JSON, and MAC—not merely the display identity. The
private delivery row records `authority_kind: 'actor' | 'system' |
'legacy-untrusted'`; recovery requires that classification, the optional seal
row, its event/actor binding, and the accounting totals to agree exactly.
Authority kind and seal rows are immutable after insertion. The current seal
format binds the complete canonical command and private envelope: event,
tenant, instance, name, exact payload JSON, sender, timestamp, actor snapshot,
and authority. Database triggers make those command/envelope fields immutable,
so changing any one of them cannot preserve a valid credential.

If a sealed actor/system event nevertheless reaches the runtime with an
invalid MAC or identity binding (for example after out-of-band database
corruption), every consumer fails closed. An ordinary graph or legacy
`waitFor` terminally fails without invoking downstream code; an interaction
response is consumed as a safe rejection. Deliberately unsealed
`legacy-untrusted` events remain accepted only by ordinary waits for
compatibility and are not treated as failed seals.

The authenticated HTTP event route also captures a secret-free Guardian
authority reference and MAC-seals it to the event ID and exact private actor
snapshot. Consumption revalidates the credential, account, active scope,
membership, and RBAC identity, then repeats that assertion at the response
commit fence. At an interaction wait, a mismatched/tampered seal or revoked
actor is consumed as a safe rejection; it cannot answer the interaction.
Trusted server code that must act
without an end-user uses the explicit `sendEventAsSystem()` entry point, whose
sealed system principal is tenant-scope checked. Generic trusted
`WorkflowService.sendEvent()` calls without a seal—and pre-upgrade inbox
rows—remain `legacy-untrusted`: they can drive an ordinary event wait but are
never accepted as `requestAndWait` responses.

Retries from webhooks, schedulers, database triggers, and other durable
system-plane adapters should use `deliverEventAsSystem()` instead. It requires
an idempotency key and returns the original durable acknowledgement on every
replay:

```ts
const delivered = await workflows.deliverEventAsSystem(
  runId,
  'provider.completed',
  { providerEventId },
  {
    principal: 'provider-webhook',
    reason: 'Resume the run after verified provider completion',
    scope: tenantScope,
    idempotencyKey: `provider:${providerEventId}`,
  },
);
// { eventId, instanceId, eventName, createdAt }
```

The key is 1–128 portable characters (`A–Z`, `a–z`, `0–9`, `.`, `_`, `:`,
or `-`, beginning with an alphanumeric character). Its namespace is the exact
system principal plus application/tenant scope. The first call atomically
commits the event audit row, delivery envelope, MAC-sealed authority, capacity
reservation, and immutable receipt. The same canonical command returns that
exact stored acknowledgement without adding capacity; a changed target,
event, payload, or reason inside that namespace fails with HTTP `409`
`WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT`. Object-key order does not change the
canonical payload fingerprint. A different principal or scope selects a
separate receipt namespace rather than revealing or conflicting with another
tenant's delivery.

A successful replay also re-kicks a running frontier. This closes the crash
window where the SQLite commit succeeds but the process stops before dispatch;
replaying after a completed run still returns the original acknowledgement.
The result intentionally contains no `replayed` flag, so retrying transport
code does not branch on delivery history. Receipt keys, fingerprints, payloads,
and reasons are excluded from observability metadata. This trusted method is
available only on the raw server `WorkflowService`, not request/activity-scoped
`zero.workflows` facades.

### Resuming Torrent From ReactiveDB Automations

A durable ReactiveDB function uses the narrower managed
`zero.torrent.deliverEvent(instanceId, eventName, payload, { key? })` bridge.
It targets one exact workflow instance and derives the permanent Torrent
idempotency identity from the source-local outbox delivery plus the optional
bounded discriminator. Zero supplies the system principal and application or
tenant scope from the trusted automation source catalog; the handler cannot
override either value. Retrying the durable function therefore returns the
original event acknowledgement rather than creating another event.

Do not call the raw `WorkflowService.deliverEventAsSystem()` from a database
automation or reconstruct its scope from a changed row. See
[ReactiveDB Database Functions And Triggers](./framework/reactive-database-automations.md#resume-one-exact-torrent-instance)
for the typed definition, trigger registration, versioning, and restart
contract.

### Channel-neutral request and response

`requestAndWait()` persists an interaction before invoking any delivery
activity. Delivery can send email, SMS, an in-app notification, a webhook, or
an agent task; none of those channels own the wait. Any authorized transport
can later submit the response with the same durable interaction ID.
The graph store enforces one durable interaction per `(instance, step)`, and
recovery requires canonical ISO timestamps. Private responder policy, response
schema, and request values are independently capped at 1 MiB and participate
in the run's 32 MiB aggregate budget.

By default, delivery activities receive `{ interactionId, request }` as
`ctx.input` and safe interaction state as `ctx.interaction`; an invocation-level
`input` expression can select or reshape that delivery value. Delivery attempts
use normal retry, idempotency, recovery, and observability rules. Because the
interaction already exists, retries and a concurrently arriving response do
not depend on a successful send. Exhausting a delivery activity's attempts
fails the workflow and closes its open interaction.

Responses can arrive through either:

- `POST /workflows/:id/interactions/:interactionId/responses`, with a stable
  `submissionId`, payload, and optional audit-only `channel`; or
- a matching authenticated workflow event, which the interaction bridge turns
  into an idempotent response submission.

For the event form, the event payload is the proposed response, the authenticated
event sender is the responder, and the durable event ID becomes the submission
identity. A bounded actor snapshot plus its event-and-actor-bound authority
seal travel with the private inbox claim, so restart preserves identity while
consume-time Guardian revalidation still catches later revocation. Unauthorized,
anonymous, legacy-untrusted, or seal-invalid event responses are consumed and
recorded as safe rejection telemetry rather than bypassing responder policy or
blocking a later valid response.

An accepted event response durably binds its private `origin` and exact event
ID while retaining the inbox claim. Exact-claim consumption, queue accounting,
and wait completion then commit together in one ReactiveDB transaction.
Rejected, superseded, forbidden, and externally superseded event responses
release any matching processing reservation and consume their claim atomically.
Recovery reconciles either form before claiming later events, so a restart or
response race cannot apply the same response twice, steal a later wait's event,
or leave queue capacity permanently occupied. Ordinary `waitFor` keeps the
compatibility contract above: it may consume a `legacy-untrusted` inbox row
because the workflow's own sealed execution authority still governs the
downstream node; only interaction-responder identity requires the per-event
actor/system seal.

The event bridge persists a private `origin = 'event'` plus the exact event ID;
cleanup and recovery never infer internal origin from caller-provided strings.
The public response API therefore reserves `channel: 'event'` and every
`submissionId` beginning with `event:` and rejects either with
`WORKFLOW_INTERACTION_INVALID`. External submissions persist as `external`,
while only the private bridge can create a same-instance event response.

Submission IDs are idempotent and bound to both the authenticated actor and
payload hash. Reusing one with the same actor and payload returns the recorded
result; changing either returns a conflict. Schema validation runs first,
followed by the optional validator activity. A validator
can accept a normalized `value` for downstream nodes or reject with a bounded
public code/message. Invalid submissions increment the rejection count without
closing the wait until `maxRejections` is reached. Exactly one valid concurrent
response wins; later valid responses are `superseded`. `maxRejections`
defaults to 10 and is bounded at 1,000. Submitted and normalized accepted
values are each capped at 1 MiB of canonical JSON.

One interaction retains at most 1,024 unique submission reservations and 16
MiB total across submitted payloads plus normalized accepted values. Replaying
an existing submission ID with its original actor and payload remains available
at the cap and consumes no new slot; a new ID beyond either boundary returns
non-retryable HTTP `429` `WORKFLOW_INTERACTION_SUBMISSION_LIMIT`. The
per-interaction byte total also participates in the run's 32 MiB aggregate
budget.

A direct response can be accepted only while the graph run is `running`. If
the run is paused, submission fails before authorization or reservation with
retryable HTTP `409` `WORKFLOW_DRAINING`; retry the same stable submission ID
after resume. No direct submission is queued while paused. Named authenticated
events are different: they remain durable inbox messages while paused and may
be consumed after resume.

A validator receives the submitted value as `ctx.input`, the original run
input as `ctx.workflowInput`, and safe interaction metadata as
`ctx.interaction`. Its idempotency key is stable for that interaction and
payload. Validation is observational: it may read `ctx.memory`, but staged
memory writes are discarded rather than committed as workflow state. Return a
boolean or `{ valid, value?, code?, publicMessage? }`; schema or return-contract
failures are stable workflow errors, not implicit acceptance.

Original request and response payloads, responder policy, validation schema,
normalized accepted value, delivery bodies, and response history stay
server-only. Authorized clients see only interaction progress: label, status,
timestamps, accepted actor, and rejection counts. The public graph projection
clears input, output, and raw error on every instance and step, so an accepted
value cannot leak indirectly when it becomes a downstream activity input or a
terminal workflow result.

## Retries, Deadlines, And Graph Progress

Each activity has one total-attempt budget. `retries` defaults to three and
includes the first invocation. `backoffMs` defaults to 1,000 ms, doubles after
each retryable failure, and caps at five minutes.

`timeoutMs` is one logical-node deadline. It includes handler execution, retry
backoff, and time spent waiting for an event or interaction. The boundary is
inclusive: `now >= timeout_at` is timed out. Exact in-process timers wake graph
retries and deadlines; the owned minute scheduler jobs remain a persisted-state
safety sweep and restart fallback.

The graph planner derives readiness from durable nodes, edges, and decisions:

- A node does not run before all selected predecessors settle.
- A choice records its selected edge once.
- A parallel join waits for all selected branches.
- `each` records the input snapshot and child progress before executing items.
- Different ready branches and different workflow instances can run
  concurrently.
- A non-isolated terminal node failure stops the run and prevents downstream
  execution.

ReactiveDB transitions are durable before a subsequent node is dispatched.
Physical-attempt fences reject late results from an aborted, recovered, timed
out, or superseded invocation.

## Pause, Resume, Cancel, Recovery, And Shutdown

Pause is a durable lifecycle transition. It fences and aborts active physical
attempts and in-flight interaction authorization/validation, marks the run
paused, disarms local timers, and freezes retry, deadline, and open-interaction
expiry time. Resume never overlaps an old physical invocation with a
replacement. If abort-ignoring activity, authorization, or validator work is
still draining, resume fails fast with retryable HTTP `409`
`WORKFLOW_DRAINING`; retry after that invocation settles. A successful resume
shifts persisted clocks by the pause duration and re-drives the graph.

Cancel fences all active work, skips nonterminal nodes, cancels unfinished
fan-out items and open interactions, clears wakes, and makes the instance
terminal. `completed`, `failed`, and `cancelled` instances are immutable.
`stop()` is the service alias for `cancel()`.

Startup recovery validates each nonterminal run's immutable version pin,
canonical graph and fingerprint, activity catalog references, persisted
topology, decisions, item snapshots, interactions, quota counters, attempts,
deadlines, and sealed execution authority. It performs that authority preflight
for the complete running/paused set before the service is published or any
recovered work is dispatched. Invalid, missing, revoked, or corrupt authority
atomically fails the run and drains its event inbox. Counters must exactly match
their private durable rows; recovery fails closed on drift instead of silently
repairing active state. Crash-left
physical attempts return to a runnable state; paused runs remain paused; exact
wakes are rearmed. A run is at-least-once with respect to external systems,
which is why the stable `ctx.idempotencyKey` is required for side effects.

Exactly one live `WorkflowService` generation may own a physical workflow
database. Startup acquires the private `_workflow_runtime_owner_lease` row
before definition publication or recovery. A second service opening the same
database while that lease is live fails retryably with
`503 WORKFLOW_RUNTIME_OWNED`; it does not recover, dispatch, or normalize any
work. The active owner renews the lease by heartbeat. Graceful `dispose()`
drains owned work and releases only its exact generation, while an abrupt exit
becomes recoverable only after the persisted expiry. Takeover always increments
the generation.

The owner/generation check is repeated under ReactiveDB's writer lock before
and after every workflow commit. It fences legacy steps, graph nodes, fan-out
items, event delivery, pause state, interactions and validators, execution
authority invalidation, definition/version publication, and draft mutation.
An expired former owner therefore cannot publish a late activity result,
terminalize a run during recovery, release a replacement attempt, or edit the
definition catalog. It fails retryably with
`503 WORKFLOW_RUNTIME_LEASE_LOST`. This is a database-writer fence, not an
exactly-once guarantee for an external API call already made by an activity;
external side effects must still deduplicate `ctx.idempotencyKey`.

Every terminal transition clears private event-delivery work transactionally
while retaining the public audit rows. Claimed events receive an exact
`consumed:<eventId>` marker and unclaimed events an exact
`discarded:<eventId>` marker; event usage counters return to zero. Any
crash-left external `processing` interaction submission is finalized as
superseded, while a trusted event-origin submission is reconciled through its
persisted event ID. Terminal recovery applies the same cleanup to pre-fix rows.

Shutdown stops scheduler intake, aborts and fences current attempts, waits up
to the configured grace period for physical handler settlement, normalizes
recoverable state, and then allows database teardown.

## Authorization And Privacy

All normal workflow HTTP actions require authentication. Definition access is
declarative:

```ts
import type { WorkflowDefinitionAccessPolicy } from '@zero/framework/workflows';

const access: WorkflowDefinitionAccessPolicy = {
  start: ['operator', 'reviewer'],
  inspect: 'admin',
};
```

Each rule accepts `'authenticated'`, `'admin'`, or a non-empty array of role
names. `start` defaults to `authenticated`; `inspect` defaults to the effective
start rule. A manager of the active application/tenant service-data scope
bypasses these rules. In single mode that preserves the historical
global-admin behavior; in multi-tenant mode a global `users.role=admin` value
alone does not grant access to a customer tenant. A denied or hidden definition
returns the same `404 WORKFLOW_NOT_FOUND` as a missing one, preventing metadata
disclosure.

Definition `access.inspect` controls catalog/discovery of the definition; it is
not the access rule for an already-created run. A starter may monitor the safe
steps, events, interactions, and presentation topology of their own immutable
run even when that definition is discoverable only by an administrator. This
keeps owned-run progress usable without exposing executable definition
content. Managers receive the same sanitized monitoring data scope-wide.

Normal users can monitor or use lifecycle/event controls only on runs whose
immutable `started_by` matches their user ID. A manager can inspect and control
every run only inside the request's active service-data scope. Interaction
submission is a separate authority boundary: the built-in `requestAndWait`
policy accepts the workflow starter, and a custom policy can authorize another
responder without granting run inspection. Inspection authority does not
silently become authority to answer a user's prompt. Inspection and lifecycle
routes make foreign and missing instance IDs indistinguishable. The
request-scoped `zero.workflows` facade owns this actor/scope boundary and adapts
`start()`/`run()` to `runAsActor()`. Raw service callers must choose
`runAsActor()` or `runAsSystem()` explicitly in a managed app; only standalone
compatibility starts accept a caller-supplied `startedBy` without a Guardian
authority provider.

Install an app-specific Guardian/tenant decision at the managed composition
boundary when the starter-only policy is not enough:

```ts
import { defineZeroConfig } from '@zero/framework/server';
import { WorkflowInteractionAuthority } from '@zero/framework/workflows';

const interactionAuthority = new WorkflowInteractionAuthority(async ({
  actor,
  instanceId,
  nodeId,
  signal,
}) => {
  const decision = await loadResponderDecision({
    userId: actor.actorId,
    roles: actor.roles ?? [],
    instanceId,
    nodeId,
    signal,
  });
  if (!decision.allowed) return false;

  return {
    allowed: true,
    revision: decision.revision,
    // This callback must stay synchronous. Read a local monotonic policy
    // revision (for example, from ReactiveDB/SQLite or a fenced local mirror).
    assertCurrent(expectedRevision, current) {
      return readResponderRevisionNow({
        userId: current.actor.actorId,
        instanceId: current.instanceId,
        nodeId: current.nodeId,
      }) === expectedRevision;
    },
  };
});

export default defineZeroConfig({
  // db, tables, auth...
  workflows: {
    interactionAuthority,
    register(registry) {
      // activities and definitions
    },
  },
});
```

The same authority evaluates direct HTTP responses and event-delivered
responses. It receives a private actor snapshot and interaction identity, and
it fails closed when the callback throws or does not explicitly allow the
response. Supplying this adapter replaces the starter-only default, so include
starter logic in the callback if the starter should remain eligible. Resolve
organization membership or application permissions inside the callback rather
than copying them into public workflow rows. Honor its `AbortSignal`; pause,
cancel, and shutdown drain tracked authority/validator work before replacement
work can begin.

Authorization is fenced through the final response write, not only checked
before schema or activity validation. A synchronous policy may return a
boolean or `{ allowed }`; Zero invokes that same synchronous policy again while
the final ReactiveDB writer transaction is open. An asynchronous policy that
allows a response must instead return a `WorkflowInteractionAuthorityLease`
with a synchronous `assertCurrent(expectedRevision, context)` callback. Zero
captures the optional revision at the first decision and runs the assertion in
the final writer transaction. Returning `false` or throwing from the assertion
denies the response. Returning a promise is invalid, and an asynchronous bare
`true` or `{ allowed: true }` fails closed with `WORKFLOW_CONFIG_INVALID` before
the response can commit. Use a local monotonic authorization revision or other
synchronous current-state check; do not start network I/O from the commit
assertion.

For event-delivered responses, Zero reopens the event-and-actor-bound seal and
revalidates the exact Guardian actor before authorization and again before the
accepted response commits. The roles presented to the callback come from that
validated authority. Custom `claims` remain bounded send-time metadata rather
than a live profile store; load any mutable app-specific claim inside
`interactionAuthority` and honor `signal`. An explicitly sealed system event
is a separate trusted-server path; legacy/unsealed events are never interaction
responders.

For every workflow format, the browser receives a status-only projection rather than
executable definition content or private execution state:

- `workflow_instances` omits `steps_json`, `graph_json`, and the private
  storage-row key `definition_version_id`, and projects `input`, `output`, and
  raw `error` as `null`. Its `definition_id`, numeric `definition_version`, and
  `graph_fingerprint` remain public structural metadata for pinned-run display
  and topology caching; they contain no executable graph or payload data.
- `workflow_steps` omits the executable `wait_event` routing key and the
  payload-derived `item_key`/`activation_key`, and projects `input`, `output`,
  and raw `error` as `null`. It includes only safe node/branch,
  parent/item-index identity, status, timing, retry scheduling, and human
  labels. Use durable `step_id` as a rendered row key.
- `workflow_events` exposes audit metadata with its payload
  redacted. The server-side row and private delivery inbox retain the payload
  required for execution.
- `workflow_interactions` exposes progress, not prompts, policies, schemas, or
  response payloads.
- Definition versions, drafts, graph edges/decisions, fan-out snapshots,
  memory, interaction details/responses, event claims, attempt fences, and
  pause records never enter Sync.
- Anonymous Sync sees no workflow rows. Normal users see their own runs. A
  live manager of the active application/tenant service-data scope sees every
  run in that scope, never an implicit cross-tenant set.
- Every workflow table is read-only over direct Sync mutation. Actions go
  through the authenticated HTTP/service boundary.

At the Sync boundary, `createWorkflowSyncPolicyAdapter()` composes app resource
policy with workflow ownership using deny-wins semantics. It preserves the
delegate's readable-table denials, row predicates, projectors, mutation
validator, and delivery-time read-authority validator. Its composite read
authority binds both the delegate fingerprint and the workflow owner/manager
scope, so either side can revoke a previously admitted socket before another
snapshot, catch-up, live row, deferred row, or row-bearing acknowledgement is
delivered.

`resolveManagementAccess` is the advanced-RBAC bridge for peer-run visibility.
For browser Sync it must return synchronously with `{ manageAll,
authorityFingerprint? }`; an async resolver cannot be compared at the
synchronous final-delivery fence, so the filtered/projected socket fails
admission closed. Recompute the decision from live server authority and change
its fingerprint whenever relevant assignments change. Owner-only access needs
no manager grant: a normal user still sees only runs whose `started_by` matches
that user, while `manageAll` applies only inside the coherent active
application/tenant scope. A compatibility `tenantRole` never grants advanced
RBAC management when an assignment revision is present.

Ownership and child-to-instance links are also protected by SQLite integrity
triggers, so direct row edits cannot move a run into another user's scope.

Treat every projected operational identifier as browser-visible data:
workflow names, node IDs/paths and labels, event names, branch keys, fan-out
indexes, and interaction safe labels must be stable and non-sensitive. Use
opaque record IDs when correlation is necessary; do not place secrets,
credentials, PHI, prompt text, or other private content in those fields.

Trusted server code can read full execution values through `WorkflowService`.
If a browser needs a business result, expose a narrow app endpoint with its own
authorization and field-level response contract. Do not restore raw workflow
input/output/error columns to the general Sync projection.

## Server And HTTP APIs

The raw `WorkflowService` is the framework/plugin facade; app-owned request and
managed activity code normally sees its restricted, authority-scoped
`zero.workflows` projection instead. Do not treat those surfaces as
interchangeable:

| Method | Behavior |
| --- | --- |
| Scoped `zero.workflows.run()` / `.start()` | Capture the current actor, enforce definition access, close over the active scope, optionally accept trusted `WorkflowStartOptions`, create durable state, and drive ready nodes. |
| Raw `runAsActor()` / `startAsActor()` | Start under an exact live Guardian session or API-key authority. Signature: `(name, input, authContext, options?, assertCurrentAuthority?)`; the optional fifth callback is reserved for low-level adapters and is asserted in the final writer transaction. |
| Raw `runAsSystem()` / `startAsSystem()` | Start under an explicit `{ principal, reason, scope }` system authority. Accepts `WorkflowStartOptions` as the final argument. |
| Raw `run()` / `start()` | Standalone compatibility only. A managed raw service rejects this path rather than silently granting system authority. |
| `get()` / `getInstance()` | Read one instance in trusted server code. |
| `list()` / `listInstances()` | List instances; HTTP adds owner scope. |
| `getSteps()` / `getEvents()` | Read ordered child state and event audit rows. |
| `getPublicTopology()` | Read the payload-free, immutable presentation topology pinned to one scope-checked run. |
| `sendEvent()` | Persist a durable event and return whether that event was claimed before return. |
| `sendEventAsSystem()` | Persist an explicitly privileged, scope-bound event with a MAC-sealed system principal. |
| `deliverEventAsSystem()` | Atomically persist or exactly replay a principal/scope/idempotency-key-bound system event receipt, re-kicking a running frontier on replay. |
| `stop()` / `cancel()` | Cancel a live instance. |
| `pause()` / `resume()` | Freeze and restore one live instance. |
| `advance()` | Coalesce and drive the current graph frontier. |
| `pollRetries()` / `pollTimeouts()` | Persisted-state safety-sweep entry points. |
| `recoverInFlight()` | Initialization-only validation and crash recovery. |
| `dispose()` | Abort, normalize, and drain active work. |

The raw service also exports `captureActorAuthorityFence()` and
`captureActorAuthorityAssertion()` for framework adapter composition, plus the
`WorkflowActorAuthorityFence` and `WorkflowMutationOptions` types described in
[Actor and system starts](#actor-and-system-starts). They are authority-race
fences, not alternatives to the scoped facade's owner, scope, or RBAC checks.

`WorkflowExecutor`, `WorkflowClock`, and `WorkflowExecutionResult` remain
exported only for low-level Zero 1.3 standalone compatibility.
`WorkflowExecutor` is deprecated for managed applications; use
`WorkflowService`. A directly constructed executor is an unmanaged writer and
fails closed when a managed workflow runtime owns that physical database.

`getWorkflowService()` is `null` until registration and recovery complete and
again after shutdown. Managed apps should let the plugin own recovery, polling,
and disposal.

The authenticated runtime routes are:

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/workflows` | Owner-scoped list with `status`, `name`, and `limit` filters. |
| `GET` | `/workflows/definitions` | Access-filtered names and safe node labels from each exact active immutable version. |
| `POST` | `/workflows` | Start `{ name, input?, version? }`; returns `{ instanceId }`. |
| `GET` | `/workflows/:id` | One authorized public instance. |
| `GET` | `/workflows/:id/steps` | Ordered public node/item rows. |
| `GET` | `/workflows/:id/events` | Ordered public event audit rows. |
| `GET` | `/workflows/:id/topology` | Immutable payload-free presentation topology pinned to the authorized run. |
| `GET` | `/workflows/:id/interactions` | Safe interaction progress. |
| `POST` | `/workflows/:id/interactions/:interactionId/responses` | Submit `{ submissionId, payload, channel? }`; the internal `event` channel/ID namespace is reserved. |
| `POST` | `/workflows/:id/events` | Send `{ eventName, payload? }`; returns `{ ok, matched }`. |
| `POST` | `/workflows/:id/cancel` | Cancel the run. |
| `POST` | `/workflows/:id/pause` | Pause the run. |
| `POST` | `/workflows/:id/resume` | Resume the run. |

Use the typed Eden surface in browser code:

```ts
import { unwrap } from '@zero/framework/react';

const { instanceId } = unwrap(await client.api.workflows.post({
  name: 'patient-intake',
  version: 1,
  input: { intakeId: 'intake_1' },
}));

const interactions = unwrap(
  await client.api.workflows[instanceId].interactions.get(),
);
const interaction = interactions[0];
if (!interaction) throw new Error('The workflow has no open interaction.');

const result = unwrap(
  await client.api.workflows[instanceId]
    .interactions[interaction.interactionId]
    .responses.post({
      submissionId: crypto.randomUUID(),
      channel: 'web',
      payload: { approved: true },
    }),
);
```

`ApiError` preserves the HTTP status, stable Zero code, safe message, and
response body.

## React Hooks And Real-Time Visualization

Workflow hooks subscribe to owner-scoped ReactiveDB state and re-render on
Sync snapshots, catchup, and live changes. They do not poll.

Public lifecycle changes are committed through ReactiveDB: run creation,
step execution/retry/wait state, fan-out and join rows, interactions,
pause/resume/cancel, and terminal status all reach an already-authorized
monitor as tracked changes. The initial `running` instance is committed before
long-running initial activity work settles, so a run-list monitor can show it
while the caller that initiated `start()` is still awaiting that request. A
monitor keyed only by the ID returned from `start()` naturally attaches after
the request resolves.

```tsx
import {
  useWorkflow,
  useWorkflowActions,
  useWorkflowTopology,
} from '@zero/framework/react';

function RunMonitor({ instanceId }: { instanceId: string }) {
  const workflow = useWorkflow(instanceId);
  const topology = useWorkflowTopology(instanceId);
  const actions = useWorkflowActions();

  return (
    <section>
      <p>Status: {workflow.instance?.status}</p>
      {topology.isLoading && <p>Loading workflow map…</p>}

      {workflow.activeSteps.map((node) => (
        <p key={node.step_id}>
          {node.step_name}: {node.status}
        </p>
      ))}

      {workflow.interactions
        .filter((interaction) => interaction.status === 'open')
        .map((interaction) => (
          <button
            key={interaction.interaction_id}
            onClick={() => void actions.submitResponse(
              instanceId,
              interaction.interaction_id,
              { approved: true },
            )}
          >
            Answer {interaction.safe_label}
          </button>
        ))}
    </section>
  );
}
```

`useWorkflow(instanceId)` returns:

- `instance`, ordered `steps`, ordered `events`, `activeSteps`, safe
  `interactions`, and `currentStep`;
- `isRunning`, `isComplete`, `isFailed`, `isPaused`, and `isCancelled`;
- `isWaiting`, `isWaitingForInput`, `isRetrying`, and
  `isRunningInParallel`.

The descriptive flags can overlap. A run remains `running` while it waits for
input or retry time. `isWaiting` is true when any active lane is waiting, even
if another parallel lane is currently running; `currentStep` remains the first
ordered active row for compact single-step displays. `isRunningInParallel` is
true when more than one root graph node is physically active, or when multiple
items under the same `each` parent are running concurrently; an interaction's
parent wait plus its delivery child does not create a false parallel signal.
Event payloads in `events` are always `null` even though their safe name,
sender, and timestamp remain live.

`useWorkflowList({ status?, name? })` returns the current user's live visible
runs. `useWorkflowActions()` exposes `start`, `cancel`, `pause`, `resume`,
`sendEvent`, and `submitResponse`; `start` accepts `{ version? }`, and response
options accept `{ submissionId?, channel? }`. `submitResponse` returns a
privacy-safe `{ outcome, interaction, rejectionCode?, publicMessage? }` result,
so a UI can explain validator rejection without receiving the submitted or
normalized response value. `useWorkflowRun(name,
{ instanceId?, version? })` combines one selected run, those actions, progress,
and mutation state. A response submitted while paused rejects with retryable
`WORKFLOW_DRAINING`; preserve its submission ID and retry after resume. Events
sent while paused remain durably buffered instead.

`useWorkflowRun().progress` keeps definition progress stable as dynamic work is
created. Its existing top-level `totalSteps`, `completedSteps`, `failedSteps`,
`runningSteps`, and `percent` fields describe root definition nodes and are also
available as `progress.rootNodes`. `progress.fanoutItems` reports dynamic
`each` children, while `progress.deliverySteps` reports interaction delivery
work. Adding another fan-out item therefore does not move the root-node
denominator or make the main progress bar move backward.

`useWorkflowTopology(instanceId)` loads the immutable sanitized topology once
through the authenticated run endpoint and returns `{ topology, isLoading,
error, reload }`. The result contains run/name/format, public pinned
version/fingerprint identity, entry path, safe nodes
`{ id, path, kind, label, parentPath, branchKey }`, and presentation edges
`{ id, from, to, branch, order, default }`. It contains no activity references,
expressions, conditions, schemas, event routing names, interaction requests,
retry/timeout policy, fan-out source/key selectors, or payloads. Requests are
fenced to the current authorization scope, so a late response from a previous
account, tenant, selected instance, or same-scope authorization-data generation
is discarded. If live Sync revokes manager visibility without changing account
or tenant identity, the shared authorization-data boundary clears both cached
and in-flight topology before reconnect and reloads only after replacement
authority validates. A current transport failure emits stable
`frontend.workflow.topology_failed` observability with only the safe action and
instance ID metadata; stale failures emit nothing.

These projected fields are enough to render a real-time timeline, node list,
branch lanes, fan-out rows, wait inbox, retry state, or visual graph animation:

- `node_id`, `node_kind`, and `node_path` identify graph nodes;
- `branch_key` identifies a selected parallel/choice lane;
- `parent_step_id` and `item_index` identify delivery/fan-out relationships;
  `step_id` is the unique UI row identity;
- statuses and lifecycle timestamps show transitions;
- `workflow_events` provides an ordered, payload-redacted operational audit;
- `workflow_interactions` shows safe open/accepted/expired/cancelled state.
  Terminal failure, timeout, authority invalidation, and explicit cancellation
  close open interactions through tracked ReactiveDB updates in the same
  cleanup transaction, so a connected monitor does not need to reconnect.

Join `useWorkflowTopology().topology.nodes[].path` to live
`workflow_steps.node_path` for a run monitor. Zero normalizes legacy public
step paths to their durable `step_id`, matching legacy topology nodes, so the
same join works for both formats. Multiple fan-out rows can share one topology
path; use `step_id` as the row key and `item_index` for display order. Delivery
rows are operational children rather than definition nodes, so attach them to
the rendered parent through `parent_step_id`. Child rows remain hidden unless
their authorized parent instance is present. Keep the canonical executable
graph on an authorized server/admin definition surface when building an editor;
the run topology endpoint is deliberately presentation-only. Do not expose
graph JSON, run/step values, raw failures, private memory, prompt content, or
response payloads through the general client state store. Zero supplies safe
topology, the live execution projection, and React composition hooks; it does
not bundle a generic graph canvas or visual editor.

## Observability And Errors

Workflow lifecycle events use the platform observability boundary. Important
stable codes include:

- `workflows.initialized`, `workflows.stopped`, `workflows.startup.failed`,
  `workflows.publication.failed`, `workflows.recovered`,
  `workflows.recovery.failed`, and `workflows.shutdown.grace_exhausted`;
- `workflows.definition.published`, `.activated`, and `.retired`;
- `workflows.instance.started`, `.completed`, `.failed`, `.paused`,
  `.resumed`, and `.cancelled`;
- `workflows.node.completed`, `workflows.step.retry_scheduled`, and
  `workflows.step.timed_out`;
- `workflows.choice.selected`, `workflows.parallel.started`,
  `workflows.parallel.joined`, `workflows.each.expanded`, `.completed`, and
  `.failed`, plus `workflows.each.item_failed`;
- `workflows.handler.missing` for legacy compatibility handlers;
- `workflows.memory.limit_rejected` and `workflows.memory.conflict`;
- `workflows.interaction.opened`, `.accepted`, `.submission_rejected`,
  `.expired`, `.delivery_failed`, and `.authority_evaluation_failed`;
- `workflows.authority.invalidated` when a live execution-authority fence wins
  the durable active-to-invalid transition;
- `workflows.owner.acquired`, `.conflict`, `.heartbeat_failed`, `.lost`, and
  `.released` for durable runtime ownership;
- `workflows.fanout.limit_exceeded` and `workflows.advance.failed`.

The workflow barrel exports `createWorkflowObservability(db?, runtime?)` plus
the `WorkflowObservability` and `WorkflowCodeEmitter` contracts for low-level
standalone/plugin composition. Managed `createApp()` wiring already constructs
the app-local instance and passes it through the complete runtime; app code
should not replace that with the process-global compatibility sink.

Each managed workflow runtime binds its own app-local observability sink; a
later process-global sink change cannot redirect another app's workflow events.
State-derived events use the owning ReactiveDB's `afterCommit` boundary: they
are invisible while the writer transaction is open, are suppressed if an outer
transaction rolls back, and emit once after the winning commit. Operational
failures that do not describe a committed state transition emit immediately.
Direct/standalone composition without an app runtime retains the process-global
sink as an explicit compatibility fallback.

Stable `WorkflowError` codes include:

- readiness/lifecycle: `WORKFLOW_NOT_READY`, `WORKFLOW_DRAINING`,
  `WORKFLOW_STATE_INVALID`, `WORKFLOW_CONFIG_INVALID`,
  `WORKFLOW_STARTUP_FAILED`, `WORKFLOW_RUNTIME_OWNED`, and
  `WORKFLOW_RUNTIME_LEASE_LOST`;
- authority/scope: `WORKFLOW_AUTHORITY_REQUIRED`,
  `WORKFLOW_AUTHORITY_CHANGED`, `WORKFLOW_SCOPE_REQUIRED`, and
  `WORKFLOW_SCOPE_INVALID`;
- lookup/validation: `WORKFLOW_NOT_FOUND`, `WORKFLOW_DEFINITION_NOT_FOUND`,
  `WORKFLOW_INPUT_INVALID`, `WORKFLOW_OUTPUT_INVALID`,
  `WORKFLOW_EVENT_INVALID`, `WORKFLOW_GRAPH_INVALID`;
- definitions/versions: `WORKFLOW_DEFINITION_INVALID`,
  `WORKFLOW_DEFINITION_GRAPH_INVALID`,
  `WORKFLOW_VERSION_NOT_FOUND`, `WORKFLOW_VERSION_CONFLICT`,
  `WORKFLOW_VERSION_SOURCE_CONFLICT`, `WORKFLOW_VERSION_SCOPE_CONFLICT`,
  `WORKFLOW_VERSION_HISTORY_INVALID`, `WORKFLOW_DRAFT_CONFLICT`;
- activities/fan-out: `WORKFLOW_ACTIVITY_NOT_REGISTERED`,
  `WORKFLOW_ACTIVITY_NOT_ALLOWED`, `WORKFLOW_ACTIVITY_INPUT_INVALID`,
  `WORKFLOW_ACTIVITY_OUTPUT_INVALID`, `WORKFLOW_HANDLER_NOT_REGISTERED`,
  `WORKFLOW_FANOUT_LIMIT_EXCEEDED`;
- memory/attempts: `WORKFLOW_ATTEMPT_STALE`,
  `WORKFLOW_MEMORY_KEY_INVALID`, `WORKFLOW_MEMORY_VALUE_INVALID`,
  `WORKFLOW_MEMORY_LIMIT_EXCEEDED`, `WORKFLOW_MEMORY_CONFLICT`;
- runtime capacity: `WORKFLOW_EVENT_QUEUE_FULL`,
  `WORKFLOW_EVENT_LIMIT_EXCEEDED`, and `WORKFLOW_RUNTIME_LIMIT_EXCEEDED`;
- interactions: `WORKFLOW_INTERACTION_NOT_FOUND`,
  `WORKFLOW_INTERACTION_EXPIRED`, `WORKFLOW_INTERACTION_CLOSED`,
  `WORKFLOW_INTERACTION_FORBIDDEN`, `WORKFLOW_INTERACTION_INVALID`,
  `WORKFLOW_INTERACTION_SUBMISSION_CONFLICT`,
  `WORKFLOW_INTERACTION_SUBMISSION_LIMIT`, and
  `WORKFLOW_INTERACTION_REJECTION_LIMIT`;
- HTTP envelopes: `WORKFLOW_REQUEST_INVALID`,
  `WORKFLOW_REQUEST_PARSE_FAILED`, and `WORKFLOW_INTERNAL_ERROR`.

The status and code identify the trust boundary rather than only the text of
the defect:

- invalid code-authored DSL/IR is `422 WORKFLOW_GRAPH_INVALID`;
- malformed authoring payloads are a 4xx definition error, while a graph that
  fails semantic validation after it has been resolved from immutable storage
  is `500 WORKFLOW_DEFINITION_GRAPH_INVALID`;
- corrupt persisted runtime JSON or an impossible durable invariant is
  `500 WORKFLOW_STATE_INVALID`;
- exhausting the engine's transition or aggregate runtime-value ceiling is
  `500 WORKFLOW_RUNTIME_LIMIT_EXCEEDED`;
- a dynamic `each` source, item key, or fail-on-invalid item mismatch is
  `422 WORKFLOW_ACTIVITY_INPUT_INVALID`;
- `WORKFLOW_AUTHORITY_CHANGED` is a non-retryable `409` commit fence. Capture
  fresh authority and begin a new operation rather than replaying a stale
  callback.

Request JSON is validated before persistence and keeps its safe 4xx code.
The same bytes decoded later from a private durable row are framework-owned
state and fail as a 500. HTTP responses expose the stable 4xx message, but
recognized 5xx `WorkflowError`s expose only a generic safe message while
preserving their stable code and an applicable `retryable: true` marker.
Unexpected 5xx failures use `WORKFLOW_INTERNAL_ERROR`. The original error
belongs only in the app-local observability event. Runtime JSON is strict data:
non-finite numbers, nested `undefined`, sparse arrays, cycles, accessors, class
instances, and other lossy `JSON.stringify` values are rejected before
persistence instead of being coerced.

Persisted error strings are bounded before storage. Workflow observability
metadata contains bounded instance/node identifiers rather than graph,
payload, delivery, interaction-body, or scratch-memory fields. An activity's
thrown error remains the event's raw `error`; configured sinks own external
serialization/redaction, so application errors must not embed secrets or
sensitive records in their message, stack, or custom fields.

## Storage And Migrations 030–036

Migration `030_workflow_graph_runtime` adds immutable graph versions, graph
coordination, scratch memory, and interaction state without dropping existing
workflow rows.

Browser-visible, owner-filtered, read-only runtime tables:

- `workflow_instances`
- `workflow_steps`
- `workflow_events`
- `workflow_interactions`

Server-only definition and coordination tables:

- `workflow_definitions` and `workflow_definition_versions`
- `_workflow_definition_drafts`
- `_workflow_graph_edges` and `_workflow_decisions`
- `_workflow_each_items`
- `_workflow_memory`
- `_workflow_interaction_details` and `_workflow_interaction_responses`
- `_workflow_event_delivery`, `_workflow_event_authorities`, `_workflow_event_usage`, and `_workflow_system_event_receipts`
- `_workflow_runtime_usage`, `_workflow_step_attempts`, and `_workflow_pauses`
- `_workflow_runtime_owner_lease`
- `_workflow_execution_authorities` and `_workflow_step_executions`

`_workflow_runtime_owner_lease` is server-only coordination state. It is part
of `WORKFLOW_SERVER_TABLE_NAMES`, is removed from application queryable-table
registration, and is denied by the workflow and platform Sync policies even if
an app delegate attempts to expose it. Do not query or mutate it from app code.

The migration backfills a version only when existing serialized definition
content can be canonicalized and proven to match. It pins compatible legacy
instances and adds stable node metadata to legacy steps. Ambiguous or malformed
legacy history is left on the legacy execution path rather than guessed. DDL
is additive and idempotent; startup also ensures the graph schema for direct
plugin/test composition. Additive-column migration backfills runtime, event,
and interaction usage counters once for existing rows. Active execution and
recovery then require exact counter integrity and never silently rewrite drift.

Migration `030` is the frozen historical release boundary. Its implementation
and transitive schema helpers are byte-pinned; later workflow schema behavior
is never folded back into an already-applied migration.

Migration `031_workflow_graph_tenant_integrity` appends the current boundary. It
transactionally preserves and rebuilds the affected graph tables, derives each
public interaction's nullable `tenant_id` only from its owning instance, and
enforces immutable, parent-matched tenant scope for instances, steps, events,
and interactions. It adds the event authority kind plus the private
`_workflow_event_authorities` relation used to distinguish sealed actor/system
events from legacy-untrusted rows, with full command/envelope identity and
immutability guards. Interaction responses gain an immutable trusted
`origin`/`event_id` relation; released rows upgrade as `external` without
inferring authority from their legacy channel or submission ID, while repair
reruns preserve already trusted event origins.
It also removes the historical workflow `ON DELETE CASCADE` actions. Related
deletes must now travel through explicit ReactiveDB/service mutations, so Sync,
audit, and workflow coordination observe every change.

Migration `036_workflow_system_event_receipts` adds the private immutable
receipt ledger for `deliverEventAsSystem()`. Receipt identity is separated by
exact application/tenant scope and system principal; each row must reference a
complete system-authority event/delivery/seal chain. Its target kind is
explicitly stored as `instance`, leaving a versioned migration path for a
future narrower wait-node target without weakening today's command identity.

Definition names are unique within `(scope_type, scope_id)` rather than across
the whole installation. Application code definitions remain available to
tenant execution unless a tenant-scoped database definition with the same name
shadows one in that tenant. Database-authored application definitions stay in
application scope and are not exposed to tenant management. Definition CRUD,
publish, lookup, and execution resolve the complete scope tuple; a global name
alone is never an authority key.

Migration `032_workflow_runtime_ownership` adds the private singleton ownership
row used for generation takeover and heartbeat fencing. It is additive,
idempotent, and safe; it does not invent an owner during migration. The first
runtime to start after upgrade acquires generation one. Existing `030`
databases advance through `031` and `032` without losing graph, version, draft,
interaction, or run data.

Migration `033_torrent_integrity_hardening` adds database-level definition,
version, retirement, active-version, draft-base/source, and terminal-event
delivery integrity fences. It accepts only exact consumed/discarded markers or
a coherent claimed wait step and adapts the same rule when the 2.0 authority
kind is present. It is topology-independent and byte-identical on the
maintained 1.3 line; it does not import or assume Guardian, Fabric, or the
system/application database split. Fresh runtimes and both supported upgrade
paths converge on the same current integrity contract through `033`.

## Legacy Sequential Compatibility

The original sequential definition remains valid:

```ts
registry.registerHandler('load-account', async (ctx) => loadAccount(ctx.input));
registry.registerHandler('notify-account', async (ctx) => notifyAccount(ctx.input));

registry.create({
  name: 'account-onboarding',
  inputSchema: t.Object({ accountId: t.String() }),
  steps: [
    { name: 'Load account', handler: 'load-account' },
    { name: 'Notify account', handler: 'notify-account', retries: 3 },
  ],
});
```

Legacy runs keep strict sequential-frontier semantics, durable event inboxes,
attempt fencing, total deadlines, pause/resume, owner-scoped Sync, exact local
wakes plus scheduler safety sweeps, and crash recovery. The compiler produces
a canonical compatibility graph for deterministic validation and migration,
while the proven 1.3 executor and its deployed-definition revision tracking
continue to run existing sequential instances. Immutable publication options
(`version` and `activate`) are deliberately accepted only by `flow` and
`graph`; a legacy definition that supplies them is rejected at registration so
no requested pin can be silently ignored. Apps can migrate one definition at a
time by replacing `steps` with `flow`; no all-at-once rewrite is required.
Legacy execution semantics remain compatible, while the generic HTTP and Sync
projection is metadata-only for legacy and graph runs alike: run/step payloads,
raw failures, fan-out keys, and event payloads remain server-side.

## Guardian Tenant Administration

Guardian adds tenant-aware workflow administration without turning the global
identity role into implicit peer-tenant access. Single-tenant mode retains the
historical global-admin compatibility rule. In multi-tenant mode, peer-run
administration requires the active tenant's protected `owner` role,
`allPermissions`, or the framework-declared `workflows:manage` permission.
That same active-scope manager boundary protects tenant-scoped definition
catalog, draft, publication, activation, and retirement operations under
`/workflows/admin/definitions`; the route prefix does not elevate a tenant
manager into a cross-tenant platform administrator. Application-scoped code
and database definitions remain outside tenant management, while a tenant
database definition can shadow an application code definition of the same name
only inside that tenant.
Assign that protected permission through an application role:

```ts
auth: {
  tenancy: 'multi',
  authorization: {
    roles: {
      workflow_manager: {
        label: 'Workflow manager',
        permissions: ['workflows:manage'],
      },
    },
  },
}
```

## Source Map

| Area | Primary files |
| --- | --- |
| DSL, IR, expressions, compilation | `workflow-dsl.ts`, `workflow-ir.ts`, `workflow-expression.ts`, `workflow-dsl-compiler.ts`, `workflow-compiler.ts`, `workflow-ir-validator.ts`, `workflow-ir-expression-validator.ts` |
| Trusted activities | `workflow-activity-catalog.ts`, `workflow-activity-reference-codec.ts`, `workflow-registry.ts` |
| Definition history and drafts | `workflow-definition-canonical.ts`, `workflow-definition-version-validation.ts`, `workflow-definition-version-store.ts`, `workflow-definition-draft-store.ts`, `workflow-definition-manager.ts`, `workflow-definition-query-service.ts`, `workflow-definition-http.plugin.ts` |
| Graph persistence and planning | `workflow-graph-store.ts`, `workflow-graph-records.ts`, `workflow-graph-run-store.ts`, `workflow-graph-topology-store.ts`, `workflow-each-item-store.ts`, `workflow-graph-interaction-reader.ts`, `workflow-graph-node-metadata.ts`, `workflow-graph-planner.ts`, `workflow-graph-persisted-state.ts`, `workflow-graph-state-reader.ts`, `workflow-runtime-json.ts`, `workflow-runtime-budget.ts` |
| Graph execution | `workflow-graph-runtime.ts`, `workflow-graph-runtime-composition.ts`, `workflow-graph-start-coordinator.ts`, `workflow-graph-driver.ts`, `workflow-graph-pump.ts`, `workflow-graph-activity-executor.ts`, `workflow-graph-activity-observability.ts`, `workflow-structural-node-controller.ts`, `workflow-each-controller.ts`, `workflow-each-item-coordinator.ts`, `workflow-wait-controller.ts` |
| Memory, events, and interactions | `workflow-memory-store.ts`, `workflow-memory-context.ts`, `workflow-event-coordinator.ts`, `workflow-event-capacity-store.ts`, `workflow-event-authority-store.ts`, `workflow-event-persisted-state.ts`, `workflow-interaction-authority.ts`, `workflow-interaction-store.ts`, `workflow-interaction-lifecycle-store.ts`, `workflow-interaction-response-store.ts`, `workflow-interaction-service.ts`, `workflow-interaction-submission-processor.ts`, `workflow-interaction-event-bridge.ts`, `workflow-event-actor.ts`, `workflow-graph-interaction-validator.ts` |
| Lifecycle, durable ownership, and exact wakes | `workflow-graph-transitions.ts`, `workflow-graph-instance-controller.ts`, `workflow-graph-wake-scheduler.ts`, `workflow-execution-tracker.ts`, `workflow-runtime-owner-lease.ts`, `workflow-runtime-lease-store.ts`, `workflow-runtime-fence.ts` |
| Legacy compatibility | `workflow-frontier-pump.ts`, `workflow-attempt-coordinator.ts`, `workflow-transition-controller.ts`, `workflow-lifecycle-coordinator.ts`, `workflow-executor.ts` |
| Auth, HTTP, Sync, and observability | `workflow-access.ts`, `workflow-execution-authority.ts`, `auth-workflow-execution-authority.ts`, `workflow-scope-boundary.ts`, `workflow-http.plugin.ts`, `workflow-public-record.ts`, `workflow-sync-policy.ts`, `workflow-observability.ts` |
| Managed server composition | `src/frontend/server/app-factory.ts`, `src/frontend/server/workflow-execution-services.ts` |
| React | `src/frontend/client/workflow-hooks.ts`, `src/frontend/client/workflow-run-hooks.ts`, `src/frontend/client/workflow-topology-hooks.ts` |
| Schema snapshots, storage schema, and migrations | `workflow-schema-snapshot.ts`, `workflow-schema.ts`, `workflow-graph-schema.ts`, `workflow-graph-schema-database.ts`, `workflow-graph-schema-tables.ts`, `workflow-graph-schema-integrity.ts`, `workflow-graph-schema-compatibility.ts`, `workflow-runtime-schema.ts`, `workflow-runtime-lease-schema.ts`, `src/migrations/definitions/030_workflow_graph_runtime.ts`, `src/migrations/definitions/031_workflow_graph_tenant_integrity.ts`, `src/migrations/definitions/032_workflow_runtime_ownership.ts`, `src/migrations/definitions/033_torrent_integrity_hardening.ts` |

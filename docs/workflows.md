# Durable Workflow System

**Location**: `src/workflows/`
**Related client/runtime files**: `src/frontend/client/workflow-hooks.ts`,
`src/frontend/client/workflow-run-hooks.ts`, and
`src/frontend/server/app-factory.ts`
**Purpose**: Multi-step durable workflow engine with SQLite state, in-memory handler registry, automatic retry with exponential backoff, event-based step waiting, condition-based branching, and crash recovery.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Workflow Plugin                        │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │   Registry    │  │   Service    │  │   Executor    │ │
│  │ (handlers +   │  │ (lifecycle   │  │ (single step  │ │
│  │  definitions) │  │  orchestrate)│  │  execution)   │ │
│  └──────────────┘  └──────────────┘  └───────────────┘ │
│                          │                               │
│                    ┌─────┴──────┐                        │
│                    │ ReactiveDB │ (4 tables)             │
│                    └────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

The registry holds handler functions and workflow definitions in memory. The
service orchestrates full lifecycle operations, while the executor runs each
step behind a durable execution-authority gate. State is persisted to SQLite
via ReactiveDB. Private authority seals and in-flight execution leases use
underscore-prefixed, non-Sync tables.
Table names without `_` are only eligible for policy evaluation; they are not
automatically public. Default `createApp()` keeps definitions private from
generic Sync and row-filters execution state to its starter, with the documented
single-tenant global-administrator compatibility rule. In multi-tenant mode,
the global `users.role=admin` value does not grant peer-workflow access inside
an organization.

## Data Flow

### Start Path
1. **`run(name, input)`** — looks up definition by name from registry
2. **Create instance** — inserts `workflow_instances` row with `status=running`
3. **Create steps** — inserts one `workflow_steps` row per step definition, all `status=pending`
4. **Seal execution authority** — stores actor/session/scope generations or an
   explicit audited system principal without storing bearer/refresh tokens
5. **Execute first step** — calls the internal scoped advance path

### Step Execution Path
1. **Look up handler** — resolve handler name from registry
2. **Check waitFor** — if step declares `waitFor` and no matching event exists, set `status=waiting` and return
3. **Check condition** — evaluate expression against workflow input; if false, set `status=skipped` and advance to next step
4. **Revalidate authority and lease** — under a SQLite write transaction,
   re-resolve the original parent/native session, account, tenant,
   membership, role-assignment revision, and server-owned property digest
5. **Build StepContext** — chain I/O plus immutable execution identity and the
   optional request-equivalent `zero` service facade
6. **Execute handler** — call the registered async function outside the database transaction
7. **Commit gate** — under a second write transaction, require the same
   execution lease and revalidate authority again
8. **On success** — accept output only through that commit gate, then advance
9. **On failure** — schedule retry only while authority remains current;
   authority failures are terminal and never retried

### Execution authority and race guarantees

An authenticated HTTP start uses `runAsActor()`. The service captures a
secret-free reference to the already hydrated Zero session and derives the
application/tenant scope entirely from live server authority. Workflow input
never selects a tenant. The private seal includes the parent/native session
identity and security generation, tenant and membership authorization
generations, advanced-role assignment revision, effective roles/permissions,
and a keyed digest of server-owned user properties.

The authority JSON is stored only in `_workflow_execution_authorities` and is
covered by a keyed MAC. It contains no bearer token, refresh token, cookie,
password, signing key, or raw user-property values. `_workflow_step_executions`
stores one replaceable random lease per active attempt. Neither table is
available through generic Sync.

The two validation gates provide the important commit guarantee: if a session
is revoked/expires, an account is suspended, a tenant or membership changes,
an advanced assignment changes, the workflow is paused/cancelled/timed out,
or recovery starts a replacement attempt while a handler is awaiting, the old
handler's output cannot commit. The workflow deterministically ends with
`Workflow execution authority is no longer valid` for an authority failure.

Managed `createApp()` installs Zero's production
`WorkflowExecutionServiceProvider`, so `ctx.zero` contains tenant/actor-scoped
`storage`, `notifications`, `rooms`, `workflows`, `pdf`, `auth`, and
`observability` facades. Synchronous mutations revalidate the workflow lease
and live authority immediately before the underlying call; asynchronous
operations fence before and after, and storage uploads receive the fence at
their internal metadata commit. Raw `db`/SQL, tokens, KV, vector, email, AI,
scheduler, resource-registry, workflow-registry, and `zero.unsafe` access are
not available from a normal managed workflow context.

Handler-owned effects outside Zero cannot be rolled back. Call
`ctx.assertCurrentAuthority()` immediately before an external effect, make the
effect idempotent, and prefer the scoped `ctx.zero` facade. Standalone
`createWorkflowPlugin()` embeddings may install their own
`WorkflowExecutionServiceProvider`; its contract receives the validated scope
and a revalidation callback and must close every exposed service over that
scope.

### I/O Chaining
Each step receives the previous step's output as its input. The first step receives the workflow-level input. This enables pipelines where data flows through transformations:

```
Step 1 (verify) → { verified: true, policyNumber: "ABC123" }
                    ↓ (becomes input to step 2)
Step 2 (approve) → { approved: true }
                    ↓ (becomes input to step 3)
Step 3 (create)  → { recordId: "R-001" }
                    ↓ (becomes workflow output)
```

### Event Path
1. **`sendEvent(instanceId, eventName, payload)`** — inserts into `workflow_events`
2. **Find waiting step** — looks for a step with `status=waiting` and matching `wait_event`
3. **Execute step** — the event payload is available via `ctx.waitEvent` inside the handler

### Retry Path
1. **Step fails** — if `retries < maxRetries`, compute next `retry_at` with exponential backoff
2. **Backoff formula** — `base * 2^attempt`, capped at 5 minutes (300,000ms)
3. **`pollRetries()`** — scheduler finds failed steps with `retry_at <= now`, re-executes them
4. **Exhausted** — if all retries consumed, step and workflow both marked `failed`

### Timeout Path
1. **Step starts** — if `timeoutMs` is set, `timeout_at` is computed and stored
2. **`pollTimeouts()`** — scheduler finds running/waiting steps past their deadline
3. **Expired** — step marked `failed` with timeout error, workflow fails

### Recovery Path (process restart)
1. **`recoverInFlight()`** — finds all steps stuck in `status=running` (indicates mid-execution crash)
2. **Reset to pending** — these steps are set back to `status=pending`
3. **Re-advance** — all workflow instances with `status=running` are re-advanced from their current step

## Database Schema

Four tables use ReactiveDB change tracking. Their lack of an `_` prefix does
not bypass platform policy: direct Sync writes are protected, definitions are
private to generic Sync, and execution rows are owner-filtered.

### workflow_definitions
| Column | Type | Notes |
|--------|------|-------|
| definition_id | TEXT PK | UUID |
| name | TEXT UNIQUE | Workflow name for lookup |
| version | INTEGER | Schema version |
| steps_json | TEXT | JSON array of StepDefinition |
| input_schema | TEXT | Optional JSON schema for input validation |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### workflow_instances
| Column | Type | Notes |
|--------|------|-------|
| instance_id | TEXT PK | UUID |
| tenant_id | TEXT nullable | Server-stamped active tenant; `NULL` is legacy application scope in single mode |
| definition_id | TEXT | FK to definitions |
| name | TEXT | Workflow name (denormalized for queries) |
| status | TEXT | WorkflowStatus enum |
| current_step | INTEGER | Index of current/next step |
| input | TEXT | JSON workflow input |
| output | TEXT | JSON workflow output (set on completion) |
| error | TEXT | Error message (set on failure) |
| started_by | TEXT | Optional caller identifier |
| steps_json | TEXT | Definition snapshot used by this instance |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |
| completed_at | TEXT | Optional completion timestamp |

### workflow_steps
| Column | Type | Notes |
|--------|------|-------|
| step_id | TEXT PK | UUID |
| tenant_id | TEXT nullable | Copied from the owning instance for direct Sync/query filtering |
| instance_id | TEXT | FK to instances |
| step_index | INTEGER | Ordered position |
| step_name | TEXT | Human-readable step name |
| status | TEXT | StepStatus enum |
| input | TEXT | JSON step input (previous step's output) |
| output | TEXT | JSON step output |
| error | TEXT | Error message |
| retries | INTEGER | Current retry count |
| max_retries | INTEGER | Max retries allowed (default 3) |
| retry_at | TEXT | ISO timestamp for next retry |
| wait_event | TEXT | Event name this step waits for |
| timeout_at | TEXT | ISO timestamp for step deadline |
| started_at | TEXT | Optional execution start timestamp |
| completed_at | TEXT | Optional completion timestamp |
| created_at | TEXT | ISO timestamp |

### workflow_events
| Column | Type | Notes |
|--------|------|-------|
| event_id | TEXT PK | UUID |
| tenant_id | TEXT nullable | Copied from the owning instance for direct Sync/query filtering |
| instance_id | TEXT | FK to instances |
| event_name | TEXT | Event identifier |
| payload | TEXT | JSON event payload |
| sent_by | TEXT | Optional sender identifier |
| created_at | TEXT | ISO timestamp |

## Key Types

```typescript
import type { TSchema } from 'elysia';

// Status enums
type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting' | 'skipped';

// Step definition (stored in workflow_definitions.steps_json)
interface StepDefinition {
  name: string;
  handler: string;          // Key into handler registry
  waitFor?: string;         // Event name to wait for
  condition?: string;       // Expression evaluated against workflow input
  timeoutMs?: number;       // Step deadline in milliseconds
  retries?: number;         // Override default retry count (default 3)
  backoffMs?: number;       // Base retry delay (default 1000ms)
}

// Context passed to handler functions
interface StepContext<TServices = unknown> {
  input: unknown;                           // Previous output; workflow input for step 0
  workflowInput: unknown;                   // Original workflow-level input
  waitEvent?: { name: string; payload: unknown };
  instanceId: string;
  stepIndex: number;
  attempt: number;                          // Zero-based retry attempt
  execution: WorkflowExecutionIdentity;     // Frozen actor/system + scope
  zero: TServices | null;                   // Scope-closed managed services
  assertCurrentAuthority(): void;           // Gate external effects
}

// Handler function signature
type StepHandler = (ctx: StepContext) => Promise<unknown>;

// Workflow definition (registered in registry)
interface WorkflowDefinition {
  name: string;
  steps: StepDefinition[];
  inputSchema?: TSchema;                    // Optional Elysia schema
}
```

## Service API

### Lifecycle Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `runAsActor` | `(name, input, authContext) => Promise<instanceId>` | Derive/seal a live request actor and tenant, then execute |
| `runAsSystem` | `(name, input, { principal, reason, scope }) => Promise<instanceId>` | Explicit audited privileged background execution |
| `run` | `(name, input?, startedBy?, scope?) => Promise<instanceId>` | Standalone compatibility only; managed plugins require an actor/system method |
| `advance` | `(instanceId, scope?) => Promise<void>` | Execute next pending step; multi-tenant callers require the validated owning scope |
| `sendEvent` | `(instanceId, eventName, payload?, sentBy?) => Promise<boolean>` | Deliver event to a matching waiting step and report whether one matched |
| `stop` | `(instanceId) => void` | Set workflow and all pending/waiting steps to cancelled |
| `pause` | `(instanceId) => void` | Set workflow to paused, halt advancement |
| `resume` | `(instanceId) => Promise<void>` | Set workflow back to running, re-advance |

Compatibility aliases remain supported: `start()` for `run()`,
`startAsActor()` for `runAsActor()`, `startAsSystem()` for `runAsSystem()`, and
`cancel()` for `stop()`. In a managed Zero app, raw `run()`/`start()` cannot
silently become privileged system execution. Trusted jobs must state their
principal, reason, and scope through `runAsSystem()`.

```typescript
import { trustedSystemServiceDataScope } from '@zero/framework/auth';

// Authenticated app endpoint/middleware integration. The AuthContext has
// already been hydrated by Zero; tenant input is neither accepted nor needed.
await workflows.runAsActor('patient-intake', input, access.requireUser());

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

### Scheduler Methods

| Method | Description |
|--------|-------------|
| `pollRetries()` | Find failed steps with `retry_at <= now`, re-execute them |
| `pollTimeouts()` | Find running/waiting steps past `timeout_at`, fail them |
| `recoverInFlight()` | Startup recovery: reset stuck `running` steps to `pending`, re-advance |

## Server Registration Example

```typescript
import type {
  WorkflowExecutionServerServices,
} from '@zero/framework/server';

const registry = getWorkflowRegistry()!;

registry.registerHandler<
  { patientId: string },
  WorkflowExecutionServerServices
>('verify-insurance', async (ctx) => {
  // Managed createApp() supplies this facade. Standalone workflow plugins may
  // leave it null unless they install an executionServices provider.
  if (!ctx.zero) throw new Error('Managed services unavailable');
  const result = await insuranceAPI.verify(ctx.workflowInput.patientId);
  return { verified: result.ok, policyNumber: result.policyNumber };
});

registry.registerHandler('await-approval', async (ctx) => {
  // waitFor event provides the payload
  return { approved: ctx.waitEvent?.payload?.approved ?? false };
});

registry.registerHandler('create-record', async (ctx) => {
  // Receives output of previous step (await-approval)
  if (!ctx.input.approved) throw new Error('Not approved');
  return await createPatientRecord(ctx.workflowInput);
});

registry.create({
  name: 'patient-intake',
  steps: [
    { name: 'Verify Insurance', handler: 'verify-insurance' },
    { name: 'Await Approval', handler: 'await-approval', waitFor: 'approval', timeoutMs: 86400000 },
    { name: 'Create Record', handler: 'create-record' },
  ],
});
```

`registerWorkflow()` remains supported for existing apps.

## SDK Integration

The typed SDK exposes the workflow routes under `client.api.workflows`, and the
React action hooks wrap that same API. Definitions are shared authenticated
metadata over the purpose-built HTTP API. Instance/step/event reads and
send/cancel/pause/resume actions require the original starter or workflow
administration authority; inaccessible and missing IDs use the same 404
response. Normal instance lists are filtered to `started_by` before applying
limits.

Single-tenant mode preserves the historical `users.role=admin` override.
Multi-tenant mode does not: peer workflow administration requires the active
tenant scope to carry the protected `owner` role, `allPermissions`, or the
framework-declared `workflows:manage` permission. The permission is part of
Zero's immutable multi-tenant authorization registry. Assign it through an
app role rather than redeclaring it:

```typescript
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

| HTTP operation | Typed SDK path | Description |
|----------------|----------------|-------------|
| `GET /workflows/definitions` | `client.api.workflows.definitions.get()` | List registered definitions |
| `GET /workflows` | `client.api.workflows.get({ query })` | List authorized instances |
| `GET /workflows/:id` | `client.api.workflows[id].get()` | Get one instance |
| `GET /workflows/:id/steps` | `client.api.workflows[id].steps.get()` | Get its steps |
| `GET /workflows/:id/events` | `client.api.workflows[id].events.get()` | Get its events |
| `POST /workflows` | `client.api.workflows.post({ name, input })` | Start an instance |
| `POST /workflows/:id/events` | `client.api.workflows[id].events.post(...)` | Send an event |
| `POST /workflows/:id/cancel` | `client.api.workflows[id].cancel.post()` | Cancel an instance |
| `POST /workflows/:id/pause` | `client.api.workflows[id].pause.post()` | Pause an instance |
| `POST /workflows/:id/resume` | `client.api.workflows[id].resume.post()` | Resume an instance |

## React Hooks

**Location**: `src/frontend/client/workflow-hooks.ts`

### useWorkflow(instanceId)
Returns the workflow instance, its steps, and computed status from the
policy-scoped live Sync collections.

### useWorkflowList(filter?)
Returns authorized workflow instances with an optional client-side status/name
filter. Updates arrive through Sync.

### useWorkflowActions()
Returns action dispatchers for workflow control:
- `start(name, input)` — start a new instance
- `cancel(instanceId)` — cancel a running instance
- `pause(instanceId)` — pause a running instance
- `resume(instanceId)` — resume a paused instance
- `sendEvent(instanceId, eventName, payload)` — send an event to a waiting step

## File Map

| File | Purpose |
|------|---------|
| `src/workflows/types.ts` | Status enums, definitions, handler context, persisted records, and platform table metadata |
| `src/workflows/workflow-registry.ts` | In-memory handler and definition registry |
| `src/workflows/workflow-executor.ts` | Single-step wait/condition/retry execution |
| `src/workflows/workflow-service.ts` | Lifecycle, events, pause/resume, polling, and recovery |
| `src/workflows/workflow-execution-authority.ts` | Private seal/lease schema, MAC verification, identity and provider contracts |
| `src/workflows/auth-workflow-execution-authority.ts` | Live Auth/tenancy/RBAC revalidation adapter |
| `src/workflows/workflow-access.ts` | Shared single-/multi-tenant workflow ownership and `workflows:manage` policy |
| `src/workflows/workflow.plugin.ts` | Elysia table lifecycle, authenticated REST routes, and service/registry accessors |
| `src/migrations/definitions/014_workflow_execution_authority.ts` | Durable private authority/lease migration |
| `src/workflows/index.ts` | Public workflow barrel |
| `src/frontend/client/sdk.ts` | Authenticated typed `client.api` transport used by workflow hooks |
| `src/frontend/client/workflow-hooks.ts` | Live instance/list hooks and action dispatchers |
| `src/frontend/client/workflow-run-hooks.ts` | One-run state, progress, and mutation composition |
| `src/frontend/server/app-factory.ts` | Full-platform plugin composition and workflow scheduler registration |
| `src/frontend/server/workflow-execution-services.ts` | Managed request-equivalent `StepContext.zero` provider |

## Scheduler Integration

`createApp()` registers two jobs through the central Scheduler in
`src/frontend/server/app-factory.ts` after composing the workflow plugin:

| Job Name | Interval | Action |
|----------|----------|--------|
| `workflow-retries` | Every minute | Calls `workflowService.pollRetries()` |
| `workflow-timeouts` | Every minute | Calls `workflowService.pollTimeouts()` |

The central `SchedulerService` is backed by `croner`; it also owns jobs
registered by other platform plugins.

Definitions and the in-memory handler registry are deliberately application-global: code
deployed for one Zero application defines the workflows available to all of its tenants.
Instances, steps, and events are tenant-owned. HTTP operations require the live
request scope, and default Sync delivery checks the discriminator on every row.
Retry, timeout, and startup-recovery scans are system-global maintenance scans,
but they do not grant authority: each selected instance must still pass its own
persisted actor/system seal before dispatch and before output commit.

## Crash Recovery

On server restart, `recoverInFlight()` handles two cases:

1. **Steps stuck in `running`** — delete the old in-flight lease and reset the
   step to `pending`; any late completion from the previous process/attempt is stale.
2. **Workflows still `running`** — re-advance from durable state using the same
   sealed authority. Missing, corrupt, revoked, or scope-mismatched seals fail
   closed instead of being upgraded to system authority.

This is called once during plugin `onStart`, before the server begins accepting requests.

## Configuration

- Requires a ReactiveDB instance passed as `createWorkflowPlugin({ db })`
- Tables are created in the plugin's `onStart` hook
- Full `createApp()` composition mounts workflows only when auth is enabled
- Managed composition explicitly awaits the app-local AuthRuntime before
  constructing the workflow authority provider and running recovery
- Managed `createApp()` installs the built-in scope-closed service facade as
  `StepContext.zero`; standalone plugin embeddings can supply `executionServices`
- Full-platform scheduler jobs are registered in
  `src/frontend/server/app-factory.ts`

## Extension Points

- **New step features**: Add fields to `StepDefinition` and handle them in the executor's execution flow
- **New lifecycle states**: Extend `WorkflowStatus` / `StepStatus` enums and add transition logic in the service
- **Custom retry strategies**: Replace the exponential backoff formula in the executor with pluggable retry policies
- **Event-driven triggers**: Use `workflow_events` table to build event-sourced audit trails or trigger cross-workflow coordination
- **Alternative persistence**: not currently an adapter surface; the service
  requires ReactiveDB's table/query/change contract

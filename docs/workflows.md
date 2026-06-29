# Durable Workflow System

**Location**: `src/workflows/`
**Files**: 6 (types, registry, executor, service, plugin, barrel) + SDK + React hooks
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

The registry holds handler functions and workflow definitions in memory. The service orchestrates full lifecycle operations (run/start, advance, stop/cancel, retry polling). The executor runs a single step, handling waitFor/condition/retry logic. All state is persisted to SQLite via ReactiveDB — tables have no `_` prefix, so changes broadcast through the sync layer for real-time observability.

## Data Flow

### Start Path
1. **`run(name, input)`** — looks up definition by name from registry
2. **Create instance** — inserts `workflow_instances` row with `status=running`
3. **Create steps** — inserts one `workflow_steps` row per step definition, all `status=pending`
4. **Execute first step** — calls `advance(instanceId)` to begin execution

### Step Execution Path
1. **Look up handler** — resolve handler name from registry
2. **Check waitFor** — if step declares `waitFor` and no matching event exists, set `status=waiting` and return
3. **Check condition** — evaluate expression against workflow input; if false, set `status=skipped` and advance to next step
4. **Build StepContext** — chain I/O: step receives previous step's output as its input, plus full workflow input and any wait event payload
5. **Execute handler** — call the registered async function with StepContext
6. **On success** — set `status=completed`, store output, advance to next step
7. **On failure** — if retries remaining, schedule retry with exponential backoff; otherwise fail the workflow

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

Four tables, all without `_` prefix so ReactiveDB broadcasts changes through the sync layer.

### workflow_definitions
| Column | Type | Notes |
|--------|------|-------|
| definition_id | TEXT PK | UUID |
| name | TEXT UNIQUE | Workflow name for lookup |
| version | INTEGER | Schema version |
| steps_json | TEXT | JSON array of StepDefinition |
| input_schema | TEXT | Optional JSON schema for input validation |

### workflow_instances
| Column | Type | Notes |
|--------|------|-------|
| instance_id | TEXT PK | UUID |
| definition_id | TEXT | FK to definitions |
| name | TEXT | Workflow name (denormalized for queries) |
| status | TEXT | WorkflowStatus enum |
| current_step | INTEGER | Index of current/next step |
| input | TEXT | JSON workflow input |
| output | TEXT | JSON workflow output (set on completion) |
| error | TEXT | Error message (set on failure) |
| started_by | TEXT | Optional caller identifier |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### workflow_steps
| Column | Type | Notes |
|--------|------|-------|
| step_id | TEXT PK | UUID |
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
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### workflow_events
| Column | Type | Notes |
|--------|------|-------|
| event_id | TEXT PK | UUID |
| instance_id | TEXT | FK to instances |
| event_name | TEXT | Event identifier |
| payload | TEXT | JSON event payload |
| sent_by | TEXT | Optional sender identifier |
| created_at | TEXT | ISO timestamp |

## Key Types

```typescript
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
  maxRetries?: number;      // Override default retry count (default 3)
}

// Context passed to handler functions
interface StepContext {
  input: unknown;                           // Previous step's output (or workflow input for first step)
  workflowInput: Record<string, unknown>;   // Original workflow-level input
  waitEvent?: { payload: unknown };         // Event payload (if step was waiting)
  instanceId: string;
  stepIndex: number;
}

// Handler function signature
type StepHandler = (ctx: StepContext) => Promise<unknown>;

// Workflow definition (registered in registry)
interface WorkflowDefinition {
  name: string;
  steps: StepDefinition[];
  inputSchema?: Record<string, unknown>;    // Optional validation schema
}
```

## Service API

### Lifecycle Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `run` | `(name, input, startedBy?) => instanceId` | Create instance + steps from definition, execute first step |
| `advance` | `(instanceId) => void` | Execute next pending step; complete workflow if all steps done |
| `sendEvent` | `(instanceId, eventName, payload) => void` | Deliver event to waiting step, trigger execution |
| `stop` | `(instanceId) => void` | Set workflow and all pending/waiting steps to cancelled |
| `pause` | `(instanceId) => void` | Set workflow to paused, halt advancement |
| `resume` | `(instanceId) => void` | Set workflow back to running, re-advance |

Compatibility aliases remain supported: `start()` for `run()` and `cancel()`
for `stop()`.

### Scheduler Methods

| Method | Description |
|--------|-------------|
| `pollRetries()` | Find failed steps with `retry_at <= now`, re-execute them |
| `pollTimeouts()` | Find running/waiting steps past `timeout_at`, fail them |
| `recoverInFlight()` | Startup recovery: reset stuck `running` steps to `pending`, re-advance |

## Server Registration Example

```typescript
const registry = getWorkflowRegistry()!;

registry.registerHandler('verify-insurance', async (ctx) => {
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

The SDK provides `client.workflows` for interacting with workflows from the client:

| Method | Description |
|--------|-------------|
| `definitions()` | List all registered workflow definitions |
| `list(filter?)` | List workflow instances with optional status filter |
| `get(instanceId)` | Get a single workflow instance |
| `getSteps(instanceId)` | Get all steps for an instance |
| `getEvents(instanceId)` | Get all events sent to an instance |
| `start(name, input)` | Start a new workflow instance |
| `sendEvent(instanceId, eventName, payload)` | Send an event to a waiting step |
| `cancel(instanceId)` | Cancel a running workflow |
| `pause(instanceId)` | Pause a running workflow |
| `resume(instanceId)` | Resume a paused workflow |

## React Hooks

**Location**: `src/frontend/client/workflow-hooks.ts`

### useWorkflow(instanceId)
Returns the workflow instance, its steps, and computed status. Polls for updates while the workflow is active.

### useWorkflowList(filter?)
Returns a list of workflow instances with optional status filtering. Polls for new entries.

### useWorkflowActions()
Returns action dispatchers for workflow control:
- `start(name, input)` — start a new instance
- `cancel(instanceId)` — cancel a running instance
- `pause(instanceId)` — pause a running instance
- `resume(instanceId)` — resume a paused instance
- `sendEvent(instanceId, eventName, payload)` — send an event to a waiting step

## File Map

| File | Lines | Purpose |
|------|-------|---------|
| `src/workflows/types.ts` | ~120 | Status enums, StepDefinition, WorkflowDefinition, StepContext, StepHandler, persisted record types |
| `src/workflows/workflow-registry.ts` | ~60 | In-memory handler + definition registry |
| `src/workflows/workflow-executor.ts` | ~120 | Single step execution with waitFor/condition/retry logic |
| `src/workflows/workflow-service.ts` | ~300 | Full lifecycle: start, advance, sendEvent, cancel/pause/resume, polling, recovery |
| `src/workflows/workflow.plugin.ts` | ~200 | Elysia plugin: table definitions, REST routes, getWorkflowService/Registry exports |
| `src/workflows/index.ts` | ~15 | Barrel exports |
| `packages/sdk/src/workflow/workflow.ts` | ~100 | SDK Workflow API implementation |
| `src/frontend/client/workflow-hooks.ts` | ~100 | React hooks for real-time workflow UI |

## Scheduler Integration

Two cron jobs registered in `src/server/app.ts`:

| Job Name | Interval | Action |
|----------|----------|--------|
| `workflow-retries` | Every minute | Calls `workflowService.pollRetries()` |
| `workflow-timeouts` | Every minute | Calls `workflowService.pollTimeouts()` |

These run alongside the existing ingestion queue scheduler using `@elysiajs/cron`.

## Crash Recovery

On server restart, `recoverInFlight()` handles two cases:

1. **Steps stuck in `running`** — the process crashed mid-execution. These are reset to `pending` since the handler may not be idempotent and partial results are discarded.
2. **Workflows still `running`** — re-advanced from their `current_step` index, picking up where they left off.

This is called once during plugin `onStart`, before the server begins accepting requests.

## Configuration

- Requires a ReactiveDB instance (passed via `getDB` getter in the plugin)
- Tables are created in the plugin's `onStart` hook
- Degrades gracefully if DB is unavailable (routes return 503)
- Scheduler jobs are registered in `app.ts` before app assembly

## Extension Points

- **New step features**: Add fields to `StepDefinition` and handle them in the executor's execution flow
- **New lifecycle states**: Extend `WorkflowStatus` / `StepStatus` enums and add transition logic in the service
- **Custom retry strategies**: Replace the exponential backoff formula in the executor with pluggable retry policies
- **Event-driven triggers**: Use `workflow_events` table to build event-sourced audit trails or trigger cross-workflow coordination
- **Alternative storage**: The service accepts a DB getter — swap ReactiveDB for any SQLite-compatible store

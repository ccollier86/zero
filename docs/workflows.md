# Durable Workflows

**Source:** `src/workflows/`

Zero workflows are durable, sequential step graphs backed by SQLite. They
support validated input, conditional steps, exponential retry, durable event
waits, total step deadlines, pause/resume, cancellation, crash recovery, live
owner-scoped Sync state, and stable HTTP and observability errors.

Handlers are ordinary server functions. They can call app services, but they
must treat external effects as at-least-once operations and use the supplied
idempotency key where duplication would be unsafe.

## Enable And Register

Workflows are enabled by default when auth is enabled. Set `workflows: false`
to omit the subsystem. Register every handler and definition through the app
configuration callback:

```ts
import { t } from 'elysia';
import { defineZeroConfig } from '@zero/framework/server';
import { tables } from './db/schema';

export default defineZeroConfig({
  db: { mode: 'file', path: './data/app.db' },
  tables,
  auth: true,
  workflows: {
    register(registry) {
      registry.registerHandler('load-account', async (ctx) => {
        // attemptId, idempotencyKey, and signal are present at runtime.
        const account = await loadAccount(
          (ctx.input as { accountId: string }).accountId,
          { signal: ctx.signal },
        );
        return account;
      });

      registry.registerHandler('notify-account', async (ctx) => {
        const account = ctx.input as { id: string; email: string };
        await sendAccountEmail(account, {
          idempotencyKey: ctx.idempotencyKey,
          signal: ctx.signal,
        });
        return { notified: account.id };
      });

      registry.create({
        name: 'account-onboarding',
        inputSchema: t.Object({ accountId: t.String({ minLength: 1 }) }),
        steps: [
          { name: 'Load account', handler: 'load-account' },
          { name: 'Notify account', handler: 'notify-account', retries: 3 },
        ],
      });
    },
  },
});
```

Register a handler before any definition that references it. `create()` is the
canonical definition method; `registerWorkflow()` remains an alias. Handler
names and workflow names must be unique within one registry. Registration
rejects malformed retry/deadline values, empty event names, missing handlers,
and invalid condition syntax before startup recovery can begin.

`createWorkflowPlugin()` constructs and publishes its registry synchronously
during composition, before `listen()`. `getWorkflowRegistry()` therefore
returns that registry while the plugin is composed and running, and returns
`null` only when workflows are absent or stopped. Managed apps should prefer
`workflows.register`; direct plugin composition can use the getter when needed.
The getter's early availability is an integration seam, not a late-registration
window: finish registering handlers and definitions before initialization and
recovery. Do not mutate the registry from request handlers or post-start hooks.

When upgrading a 1.3 app, move any handler/definition registration that ran in
`onStart` or after `listen()` into `workflows.register`. Directly composed apps
may instead register through `getWorkflowRegistry()` after `createApp()` has
finished composition and before `listen()`. Post-listen registration is too
late for deterministic recovery preflight.

## Startup And Shutdown Barrier

Workflow startup is intentionally ordered:

1. Create the registry synchronously.
2. Invoke and await `workflows.register`, including an async callback.
3. Wait for managed auth services.
4. Construct the service and validate every nonterminal persisted run, its
   step topology, and all referenced handlers as one recovery set.
5. Recover in-flight work.
6. Publish `getWorkflowService()` and accept workflow requests.

`createApp()` installs a real readiness barrier around the platform and
app-owned start hooks registered before workflows. Promise-returning hooks must
settle before recovery handlers run, and requests entering during startup await
that same barrier and single-flight initializer. A registration, dependency, or
recovery failure keeps the service unpublished, emits a stable startup/recovery
event, and stops the listener rather than serving a partially recovered
runtime. Recovery preflight does not partially normalize otherwise valid runs
when another run is corrupt or references a missing handler.

Shutdown unregisters the workflow scheduler jobs, fences and aborts active
attempts, waits for physical handler settlement, normalizes recoverable public
state, and only then permits database teardown.

## Definition And Step Contracts

```ts
interface StepDefinition {
  name: string;
  handler: string;
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  waitFor?: string;
  condition?: string;
}

interface WorkflowDefinition {
  name: string;
  steps: StepDefinition[];
  inputSchema?: TSchema;
  access?: {
    start?: 'authenticated' | 'admin' | readonly string[];
    inspect?: 'authenticated' | 'admin' | readonly string[];
  };
}
```

`retries` currently sets the maximum total handler attempts, with a minimum of
one, a default of three, and a registration-time ceiling of 1,000. `backoffMs`
defaults to 1,000 ms; retry delays double from that base and cap at five minutes.
A zero backoff retries through the same frontier pump immediately instead of
waiting for the minute scheduler. A definition must contain at least one step.
Workflow names, handler keys, and `waitFor` event identifiers are canonical
identifiers and cannot contain surrounding whitespace. Unknown definition,
access-policy, and step keys fail registration so misspelled declarative
options cannot silently fall back to a less restrictive/default behavior.

`inputSchema` is checked before an instance or any step rows are created. Input,
event payloads, and handler outputs must be JSON-serializable.

Conditions are trusted server-authored expressions evaluated against the
workflow input as `input`, for example `input.approved === true`. A false
condition skips the step before it can claim a wait event. Syntax is compiled
during registration. If a syntactically valid expression throws for a specific
runtime input, the step and instance fail closed; Zero never treats a broken
condition as permission to execute the guarded handler.

## StepContext

```ts
interface StepContext<TInput = unknown> {
  input: TInput;
  workflowInput: unknown;
  instanceId: string;
  stepIndex: number;
  attempt: number;
  attemptId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  waitEvent?: {
    id: string;
    name: string;
    payload: unknown;
  };
}
```

For compatibility, `attemptId`, `idempotencyKey`, and `signal` remain optional
in the public TypeScript type. Zero always supplies them at runtime:

- `attempt` is the zero-based retry count stored on the step.
- `attemptId` is unique to one physical handler invocation.
- `idempotencyKey` is stable for the logical instance/step across retries and
  recovery: `workflow:<instanceId>:step:<stepIndex>`.
- `signal` is aborted on pause, cancellation, timeout, and runtime shutdown.
  Cancellation is cooperative; a handler may ignore it.
- `waitEvent` identifies the durably claimed event for a `waitFor` step.

For step zero, both `input` and `workflowInput` contain the original workflow
input. For every later step, `input` is the previous step's parsed output while
`workflowInput` remains the original input.

The context object and `waitEvent` object are frozen. Return JSON-safe values;
the last completed step's serialized output becomes the instance output. An
output that cannot produce JSON fails the step immediately rather than
repeating a deterministic serialization failure through the retry budget.

## Strict Frontier Execution

Each instance has exactly one legal frontier: its first step that is not
`completed` or `skipped`. Zero coalesces concurrent advancement requests for
the same instance into one pump, while different instances may execute in
parallel.

A later step cannot pass a frontier that is:

- running;
- waiting for an event;
- waiting for a retry deadline;
- terminally failed.

When a handler returns or throws, its result is committed only if the instance
is still running, the step is still running, and its durable physical-attempt
fence still matches. A late result after pause, cancellation, timeout, recovery,
or a newer attempt is discarded.

## Durable Event Inbox

`sendEvent(instanceId, eventName, payload, sentBy?)` writes two records in one
transaction:

- a public `workflow_events` audit row;
- an internal `_workflow_event_delivery` inbox row.

The legal frontier claims the oldest matching unclaimed inbox item. The claim
is durable and unique to that step, so an event received before the wait step
becomes active is buffered, and a failed event handler receives the same event
ID and payload on every retry and after recovery.

Historical `workflow_events` rows created before durable inbox support have no
internal delivery row. They remain readable audit history and are deliberately
never replayed as new input.

The boolean returned by `sendEvent()` and the HTTP `matched` field answer one
precise question: was that newly inserted event claimed before this call
returned? A paused workflow accepts and buffers the event but returns `false`;
resume may claim it later. A nonmatching event also remains buffered and can be
claimed by a later legal wait step. Terminal workflows reject new events with
`WORKFLOW_STATE_INVALID`.

Internal coordination tables are underscore-prefixed and never enter Sync:

- `_workflow_event_delivery` owns inbox availability and durable claims.
- `_workflow_step_attempts` owns physical-attempt fences.
- `_workflow_pauses` stores the pause boundary used to freeze deadlines.

## Retries And Deadlines

A retryable handler failure leaves the workflow running and stores a failed
frontier step with `retry_at`. The scheduler discovers due frontiers every
minute; normal advancement still respects the exact persisted deadline.

`timeoutMs` is one total logical-step deadline. It starts when the step first
becomes active and includes:

- time waiting for an event;
- handler execution;
- retry backoff;
- later retry attempts.

The deadline boundary is inclusive: `now >= timeout_at` times out the step.
Timeout polling transactionally rereads the current row before failing it and
fences/aborts any physical handler, so stale candidates and late success cannot
overwrite the terminal timeout.

Timeout wins at an exact boundary. That includes a retry becoming due at the
same instant as its logical-step deadline and a pause requested after the
deadline has been reached. The transition commits the timeout once; a competing
cancel, pause, or resume action cannot replace the resulting terminal state.

Pause freezes both `timeout_at` and `retry_at`. Resume waits for any old physical
handler—even one that ignored `AbortSignal`—to settle, shifts those timestamps
by the paused duration, then starts a fresh attempt. It never overlaps the old
and new physical attempts for one step.

## Cancellation And Terminal States

Cancelling a live workflow:

- fences and aborts active attempts;
- sets every nonterminal step to `skipped` with `Workflow cancelled`;
- clears retry and timeout deadlines;
- sets the instance to `cancelled`.

`completed`, `failed`, and `cancelled` instances are terminal and immutable.
Cancel, pause, and resume reject invalid transitions with
`WORKFLOW_STATE_INVALID`. `stop()` is the service alias for `cancel()`.

## Crash Recovery And Idempotency

Recovery validates every nonterminal persisted instance—including paused
instances—as one set. It rejects malformed snapshots, invalid topology or
timestamps, impossible counters/statuses, and unregistered referenced handlers
before mutating public workflow rows. Only instances whose durable status is
`running` are normalized and re-driven; paused work stays paused.

Physical attempts left `running` by a crash are reset and re-driven from the
strict frontier. Durable event claims and logical deadlines survive. This is an
at-least-once execution model: a process can crash after an external effect but
before committing step completion. Use `ctx.idempotencyKey` with email,
payments, webhooks, storage writes, and other nontransactional effects. Do not
use `attemptId` as an external idempotency key because it changes on retry.

## Authorization And Sync

All HTTP workflow routes require authentication.

- Definition access is declarative. `access.start` defaults to
  `authenticated`; `access.inspect` defaults to the effective start rule. Use
  `admin` for the global platform administrator or a role array such as
  `['operator', 'reviewer']`. Global administrators always bypass these rules.
- A definition hidden by `inspect`, or denied by `start`, is indistinguishable
  from a missing definition. The server returns `404 WORKFLOW_NOT_FOUND` and
  does not disclose that the definition exists.
- A normal user can list, read, inspect steps/events, send events, pause,
  resume, and cancel only instances whose `started_by` is that user.
- The stable single-tenant global `admin` role can inspect and control every
  instance.
- Foreign instance IDs return the same `404 WORKFLOW_NOT_FOUND` response as
  missing IDs.
- `GET /workflows/definitions` returns only definitions the caller may inspect,
  with the definition name and human step labels. Handler keys, conditions,
  schemas, and executable topology remain server-only. Definitions never enter
  browser Sync.

The same boundary applies to Sync snapshots and live changes:

- `workflow_instances`, `workflow_steps`, and `workflow_events` are filtered to
  their owner, with global admins allowed to see all runtime rows.
- The immutable `steps_json` execution snapshot is retained in SQLite for
  recovery but is stripped from HTTP lists, HTTP instance reads, Sync
  snapshots, catchup, and live changes. A versioned authorization scope forces
  existing clients to purge any pre-upgrade cached topology.
- Public step rows resolve their human label from that immutable snapshot.
  Legacy 1.3 rows therefore do not leak the handler key formerly stored in
  `step_name`; if no valid snapshot exists, clients receive `Step N`.
- A step's `wait_event` is executable routing topology and is likewise removed
  from HTTP, Sync, and the browser table descriptor. Event-history
  `event_name` values remain owner-visible by design.
- Anonymous Sync sees no workflow runtime rows.
- All public workflow tables are read-only over Sync. Lifecycle changes must
  use the HTTP/service actions.
- Existing app resource-policy denials and row predicates remain authoritative;
  workflow ownership is composed with them using deny-wins behavior.

Trusted server code that starts a run for browser observation must pass that
user's ID as `startedBy` to `run()`/`start()`. A run with `started_by = null`
has no normal-user owner and is visible through HTTP/Sync only to a global
admin. `WorkflowService` is a trusted server API and does not apply the HTTP
definition access policy; server callers remain responsible for their own
authority boundary.

Workflow ownership is immutable after creation. The database rejects changes
to `workflow_instances.started_by`, and rejects moving a step or event to a
different `instance_id`. This keeps owner-derived child authorization stable.
Treat direct workflow-table writes as unsupported; use `WorkflowService` or the
authenticated workflow routes.

## Server API

`WorkflowService` provides:

| Method | Behavior |
| --- | --- |
| `run()` / `start()` | Validate input, create durable rows, and drive the first frontier. |
| `get()` / `getInstance()` | Read one instance in trusted server code. |
| `list()` / `listInstances()` | List instances; HTTP adds owner scoping. |
| `getSteps()` / `getEvents()` | Read ordered child records. |
| `sendEvent()` | Persist a durable inbox event and return whether that event was claimed. |
| `stop()` / `cancel()` | Cancel a nonterminal instance. |
| `pause()` / `resume()` | Freeze and restore one live instance. |
| `advance()` | Drive the current legal frontier; concurrent calls coalesce. |
| `pollRetries()` / `pollTimeouts()` | Scheduler entry points. |
| `recoverInFlight()` | Initialization-only preflight and recovery of crash-left work. |
| `dispose()` | Abort, normalize, and drain active work. |

`getWorkflowService()` returns `null` until registration and recovery complete,
and again after shutdown. App request handlers run after the readiness barrier;
startup code must not assume the service is published early. The workflow
plugin owns `recoverInFlight()` and the two polling methods in normal managed
apps; calling recovery after ordinary service work has begun is rejected.

## HTTP And Browser API

The plugin mounts:

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/workflows` | Owner-scoped list; `status`, `name`, and `limit` filters. |
| `GET` | `/workflows/definitions` | Access-filtered names and human step labels. |
| `POST` | `/workflows` | `{ instanceId }`. |
| `GET` | `/workflows/:id` | One authorized instance. |
| `GET` | `/workflows/:id/steps` | Ordered steps. |
| `GET` | `/workflows/:id/events` | Ordered public audit events. |
| `POST` | `/workflows/:id/events` | `{ ok: true, matched }`. |
| `POST` | `/workflows/:id/cancel` | `{ ok: true }`. |
| `POST` | `/workflows/:id/pause` | `{ ok: true }`. |
| `POST` | `/workflows/:id/resume` | `{ ok: true }`. |

Use the actual Eden surface through `client.api`:

```ts
import { ApiError, unwrap } from '@zero/framework/react';

const { instanceId } = unwrap(await client.api.workflows.post({
  name: 'account-onboarding',
  input: { accountId: 'acct_1' },
}));

const { matched } = unwrap(
  await client.api.workflows[instanceId].events.post({
    eventName: 'approved',
    payload: { reviewerId: 'user_1' },
  }),
);
```

Workflow browser calls are exposed only through `client.api.workflows`.
`ApiError` is a public export and preserves `status`, the stable Zero `code`,
the response `body`, and a safe message when `unwrap()` rejects a call.

## React Hooks

The hooks are Sync-backed; they do not poll.

```tsx
const workflow = useWorkflow(instanceId);
const actions = useWorkflowActions();

const nextId = await actions.start('account-onboarding', {
  accountId: 'acct_1',
});
const matched = await actions.sendEvent(nextId, 'approved', {
  reviewerId: 'user_1',
});
```

`useWorkflow(instanceId)` returns the instance, ordered steps, current frontier,
and these status flags:

- `isRunning`
- `isComplete`
- `isFailed`
- `isPaused`
- `isCancelled`
- `isWaiting`
- `isRetrying`

These flags are descriptive rather than mutually exclusive: an instance stays
`running` while its frontier is waiting for an event or a scheduled retry, so
`isRunning` can be true together with `isWaiting` or `isRetrying`.

`useWorkflowList({ status?, name? })` returns the current user's live visible
instances. `useWorkflowActions()` exposes start/cancel/pause/resume/sendEvent.
`useWorkflowRun(name, { instanceId? })` composes those actions with one selected
run, progress, pending/error state, and the same status flags.

## Scheduler And Observability

The plugin owns two scheduler jobs and unregisters only the jobs it created:

| Job | Schedule | Action |
| --- | --- | --- |
| `workflow-retries` | Every minute | Find due retry frontiers and advance them. |
| `workflow-timeouts` | Every minute | Transactionally expire current deadlines. |

Stable lifecycle codes include:

- `workflows.initialized`, `workflows.stopped`, `workflows.startup.failed`
- `workflows.recovered`, `workflows.recovery.failed`
- `workflows.instance.started`, `.completed`, `.failed`, `.paused`, `.resumed`, `.cancelled`
- `workflows.step.retry_scheduled`, `.timed_out`
- `workflows.handler.missing`
- `workflows.advance.failed`

Stable workflow-domain HTTP/service codes include:

- `WORKFLOW_NOT_READY`
- `WORKFLOW_NOT_FOUND`
- `WORKFLOW_DEFINITION_NOT_FOUND`
- `WORKFLOW_DEFINITION_INVALID`
- `WORKFLOW_HANDLER_NOT_REGISTERED`
- `WORKFLOW_STATE_INVALID`
- `WORKFLOW_INPUT_INVALID`
- `WORKFLOW_EVENT_INVALID`
- `WORKFLOW_REQUEST_INVALID`
- `WORKFLOW_REQUEST_PARSE_FAILED`
- `WORKFLOW_STARTUP_FAILED`
- `WORKFLOW_INTERNAL_ERROR`

HTTP auth failures retain the auth subsystem's stable codes, such as
`UNAUTHORIZED`. Eden `unwrap()` preserves the status, stable code, response
body, and safe message in `ApiError`.

## Storage Layout

Workflow storage tables (only authorized, projected runtime rows enter Sync):

- `workflow_definitions`: persisted server-only definition snapshots; excluded
  from `WORKFLOW_TABLES`, lazy data queries, and every Sync path.
- `workflow_instances`: lifecycle, input/output/error, owner, and a server-only
  immutable step snapshot used for execution/recovery.
- `workflow_steps`: ordered status, output/error, retry, wait, and deadline data.
- `workflow_events`: immutable, owner-visible event/audit payload rows.

Internal tables:

- `_workflow_event_delivery`
- `_workflow_step_attempts`
- `_workflow_pauses`

The hardened runtime keeps the existing 1.3 public workflow-table shape. No
app-owned schema migration is required: composition creates the coordination
tables and installs the added workflow indexes and ownership/parent guards
idempotently. It does not backfill delivery rows for historical audit events,
so an upgrade cannot reinterpret old records as newly delivered input.

Public step rows have no `updated_at` column. An instance stores `updated_at`;
steps use `started_at`, `completed_at`, `retry_at`, and `timeout_at`.

## Source Map

| File | Responsibility |
| --- | --- |
| `types.ts` | Definitions, contexts, statuses, records, and client table descriptors. |
| `workflow-registry.ts` | In-memory handlers and definitions. |
| `workflow-access.ts` | Definition-policy validation and HTTP role evaluation. |
| `workflow-public-record.ts` | Shared HTTP/Sync topology redaction. |
| `workflow-condition.ts` | Trusted condition compilation shared by registration and execution. |
| `workflow-step-definition.ts` | Immutable definition-snapshot parsing and handler resolution. |
| `workflow-persisted-state.ts` | Fail-closed validation of durable run rows and topology. |
| `workflow-runtime-store.ts` | Internal inbox claims, attempt fences, and pause timestamps. |
| `workflow-repository.ts` | Prepared SQL reads/writes and durable transaction helpers. |
| `workflow-instance-factory.ts` | Start-time input validation and atomic instance/step persistence. |
| `workflow-attempt-coordinator.ts` | Transactional prepare/commit, retry/deadline decisions, and attempt fences. |
| `workflow-transition-controller.ts` | Pause, resume, and cancellation transitions. |
| `workflow-lifecycle-coordinator.ts` | Recovery, retry/timeout discovery, and shutdown normalization. |
| `workflow-executor.ts` | One physical handler invocation and cooperative abort/drain behavior. |
| `workflow-service.ts` | Public service facade and coalesced strict-frontier pump. |
| `workflow-schema.ts` | ReactiveDB public-table registration, indexes, and ownership/parent guards. |
| `workflow-sync-policy.ts` | Owner/admin Sync visibility and read-only enforcement. |
| `workflow-scheduler-owner.ts` | Owned retry/timeout job registration and cleanup. |
| `workflow-plugin-runtime.ts` | Registration/recovery barrier and safe service publication. |
| `workflow-http.plugin.ts` | Protected routes, public projections, and stable HTTP errors. |
| `workflow.plugin.ts` | Thin Elysia composition facade. |
| `workflow-error.ts` | Stable workflow errors. |
| `src/frontend/client/workflow-hooks.ts` | Live state and browser actions. |
| `src/frontend/client/workflow-run-hooks.ts` | Start-and-watch composition and progress. |

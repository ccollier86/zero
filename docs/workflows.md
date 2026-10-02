# Torrent Durable Workflows

**Source:** `src/workflows/`

**Torrent** is Zero's durable workflow subsystem: versioned execution graphs
backed by SQLite and ReactiveDB. A workflow can run ordinary activities,
choose a branch, execute parallel branches, fan out over an array, wait for an
event, or pause for a human or external-system response. Runtime progress is
projected through owner-scoped ReactiveDB Sync, so an authorized browser can
render a live run without polling.

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

Torrent is the subsystem name, not a new application API. Existing
`workflows` configuration, `zero.workflows`, HTTP routes, imports, and database
table names remain unchanged.

## Enable And Register

Workflows are enabled by default when auth is enabled. Set `workflows: false`
to omit the subsystem. Register activities and code-authored definitions in
the application configuration callback:

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

Register each activity before definitions that reference it. Registration and
compilation reject malformed graphs, unknown options, missing activities,
unsafe expressions, invalid limits, cycles, ambiguous fan-out, unreachable
nodes, and invalid schemas before execution begins.

`createWorkflowPlugin()` constructs its registry during composition. In a
managed app, prefer `workflows.register`; Zero awaits that callback before
recovery. Direct plugin composition can use `getWorkflowRegistry()` after
composition and before `listen()`. Do not register definitions or activities
from request handlers or after the server starts.

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

## The Code DSL

The DSL builds inert descriptors and compiles them into canonical graph IR:

| Builder | Meaning |
| --- | --- |
| `flow(...nodes)` | Ordered dependency chain. |
| `step(id, activity, options?)` | Invoke one registered activity. |
| `choose(id, when(...), otherwise(...))` | Select the first true branch, otherwise the required fallback. |
| `parallel(id, branches)` | Start named branches together and continue after their generated all-branches join. |
| `each(id, source, body, options?)` | Snapshot an array and invoke one activity for each item with bounded concurrency. |
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

Both code and database definitions use the same append-only version store:

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

Start the active version or pin a version explicitly:

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

Database-authored definition management is a protected platform-admin surface:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/workflows/admin/definitions` | List code and database catalog summaries. |
| `GET` | `/workflows/admin/definitions/activities` | List registered activity versions, schemas, capabilities, defaults, and database-callable status. |
| `GET` | `/workflows/admin/definitions/:definitionId/versions` | List immutable version metadata, newest first. |
| `GET` | `/workflows/admin/definitions/:definitionId/versions/:versionId` | Read one immutable version with its editable graph, schema, and access policy. |
| `POST` | `/workflows/admin/definitions/publish` | Validate and publish canonical graph content. |
| `PUT` | `/workflows/admin/definitions/drafts` | Create or revision-fenced update a mutable draft. |
| `GET` | `/workflows/admin/definitions/drafts/:draftId` | Read one draft with graph, schema, access policy, and editor metadata. |
| `DELETE` | `/workflows/admin/definitions/drafts/:draftId?expectedRevision=N` | Delete a draft, optionally guarded by its current revision. |
| `POST` | `/workflows/admin/definitions/drafts/:draftId/publish` | Publish a validated draft. |
| `POST` | `/workflows/admin/definitions/:definitionId/versions/:versionId/activate` | Make one published version active. |
| `POST` | `/workflows/admin/definitions/:definitionId/versions/:versionId/retire` | Retire one version from future starts. |

Publish requests contain `{ name, graph, inputSchema?, access?, version?,
activate?, expectedActiveVersionId? }`. `expectedActiveVersionId` is a compare
fence that prevents an editor from replacing a newer active version. Draft
writes include `definitionId`, `name`, `graph`, optional schemas/policy/editor
metadata, and `expectedRevision` for optimistic concurrency.

Catalog and version-list responses expose only metadata and fingerprints.
Explicit single-version and draft reads return editable graph content to the
authenticated platform-admin surface. Publication always revalidates graph
shape, schemas, contextual output references, canonical fingerprint, activity
versions, and the `databaseCallable` boundary on the server; an editor's local
validation is never trusted as the authorization boundary.

## Step Context And Idempotency

Activity handlers receive `StepContext`:

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
  memory?: WorkflowMemoryContext;
  item?: { value: unknown; index: number; key: string };
  interaction?: WorkflowInteractionRecord;
  waitEvent?: { id: string; name: string; payload: unknown };
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

Scratch memory is execution state, not a general app database. `_workflow_memory`
is private, excluded from HTTP and Sync, and removed with its run. Store app
records in app tables and keep large files in Zero Storage.

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
identity. A bounded private actor snapshot travels with the durable inbox claim,
so the same responder context is available after restart. Unauthorized or
anonymous event responses are consumed and recorded as safe rejection telemetry
rather than bypassing the responder policy or blocking a later valid response.
The `event` response channel and `event:` submission-ID prefix are reserved for
this trusted internal bridge. Public response submission rejects either form;
applications should use their own audit-only channel label and an ordinary
stable submission ID. An accepted event response retains its exact delivery
claim until claim consumption, inbox accounting, and wait completion commit in
one transaction. Rejected or superseded event responses, forbidden submissions,
and event submissions that lose to an external response release any matching
processing reservation and consume the claim atomically. Recovery refreshes the
durable interaction before claiming another event, so a restart or response
race cannot apply the same response twice, steal a later same-name wait's event,
or leave queue capacity occupied.

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
and deadlines. Counters must exactly match their private durable rows; recovery
fails closed on drift instead of silently repairing active state. Crash-left
physical attempts return to a runnable state; paused runs remain paused; exact
wakes are rearmed. A run is at-least-once with respect to external systems,
which is why the stable `ctx.idempotencyKey` is required for side effects.

Shutdown stops scheduler intake, aborts and fences current attempts, waits up
to the configured grace period for physical handler settlement, normalizes
recoverable state, and then allows database teardown.

## Authorization And Privacy

All normal workflow HTTP actions require authentication. Definition access is
declarative:

```ts
access: {
  start: 'authenticated' | 'admin' | ['operator', 'reviewer'],
  inspect: 'authenticated' | 'admin' | ['operator', 'reviewer'],
}
```

`start` defaults to `authenticated`; `inspect` defaults to the effective start
rule. The stable global platform administrator bypasses these rules. A denied
or hidden definition returns the same `404 WORKFLOW_NOT_FOUND` as a missing
one, preventing metadata disclosure.

Normal users can inspect or use lifecycle/event controls only on runs whose
immutable `started_by` matches their user ID. The global administrator can
inspect and control every run. Interaction submission is a separate authority
boundary: the built-in `requestAndWait` policy accepts the workflow starter,
and a custom policy can authorize another responder without granting run
inspection. Inspection authority does not silently become authority to answer
a user's prompt. Inspection and lifecycle routes make foreign and missing
instance IDs indistinguishable. Trusted server code calling
`WorkflowService` is responsible for its own authority boundary; pass
`startedBy` when a browser user should own and observe a run.

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
}) => canAnswerWorkflowInteraction({
  userId: actor.actorId,
  roles: actor.roles ?? [],
  instanceId,
  nodeId,
  signal,
}));

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

For event-delivered responses, actor roles and claims are authenticated
send-time snapshots retained so restart does not change the submitted identity
context. They are not proof that a revocable role, membership, tenant status,
or account state is still current. A policy that depends on current authority
must load that state inside `interactionAuthority`, reject stale access, and
honor `signal`; do not grant access from snapshotted roles or claims alone.

For graph runs, the browser receives a status-only projection rather than
executable definition content or private execution state:

- Graph `workflow_instances` omits `steps_json`, `graph_json`, and internal
  version identity, and projects `input`, `output`, and raw `error` as `null`.
- Graph `workflow_steps` omits the executable `wait_event` routing key and
  projects `input`, `output`, and raw `error` as `null`. It includes only safe
  node/branch/item identity, status, timing, retry scheduling, and human labels.
- Graph `workflow_events` exposes audit metadata with its payload
  redacted. The server-side row and private delivery inbox retain the payload
  required for execution.
- `workflow_interactions` exposes progress, not prompts, policies, schemas, or
  response payloads.
- Definition versions, drafts, graph edges/decisions, fan-out snapshots,
  memory, interaction details/responses, event claims, attempt fences, and
  pause records never enter Sync.
- Anonymous Sync sees no workflow rows. Normal users see their own runs; the
  global admin sees all runtime rows.
- Every workflow table is read-only over direct Sync mutation. Actions go
  through the authenticated HTTP/service boundary.

At the Sync boundary, app resource policy is composed with workflow ownership
using deny-wins semantics. Ownership and child-to-instance links are protected
by SQLite integrity triggers, so direct row edits cannot move a run into
another user's scope.

Treat every projected operational identifier as browser-visible data:
workflow names, node IDs and labels, event names, branch keys, fan-out item
keys, and interaction safe labels must be stable and non-sensitive. Use opaque
record IDs when correlation is necessary; do not place secrets, credentials,
PHI, prompt text, or other private content in those fields.

Trusted server code can read full execution values through `WorkflowService`.
If a browser needs a business result, expose a narrow app endpoint with its own
authorization and field-level response contract. Do not restore raw workflow
input/output/error columns to the general Sync projection.

## Server And HTTP APIs

`WorkflowService` is the trusted server facade:

| Method | Behavior |
| --- | --- |
| `run()` / `start()` | Validate input, resolve/publish and pin a definition version, create durable graph state, and drive ready nodes. Accepts `{ version? }`. |
| `get()` / `getInstance()` | Read one instance in trusted server code. |
| `list()` / `listInstances()` | List instances; HTTP adds owner scope. |
| `getSteps()` / `getEvents()` | Read ordered child state and event audit rows. |
| `sendEvent()` | Persist a durable event and return whether that event was claimed before return. |
| `stop()` / `cancel()` | Cancel a live instance. |
| `pause()` / `resume()` | Freeze and restore one live instance. |
| `advance()` | Coalesce and drive the current graph frontier. |
| `pollRetries()` / `pollTimeouts()` | Persisted-state safety-sweep entry points. |
| `recoverInFlight()` | Initialization-only validation and crash recovery. |
| `dispose()` | Abort, normalize, and drain active work. |

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
| `GET` | `/workflows/:id/interactions` | Safe interaction progress. |
| `POST` | `/workflows/:id/interactions/:interactionId/responses` | Submit `{ submissionId, payload, channel? }`. |
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

```tsx
function RunMonitor({ instanceId }: { instanceId: string }) {
  const workflow = useWorkflow(instanceId);
  const actions = useWorkflowActions();

  return (
    <section>
      <p>Status: {workflow.instance?.status}</p>

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

- `instance`, ordered `steps`, `activeSteps`, `interactions`, and
  `currentStep`;
- `isRunning`, `isComplete`, `isFailed`, `isPaused`, and `isCancelled`;
- `isWaiting`, `isWaitingForInput`, `isRetrying`, and
  `isRunningInParallel`.

The descriptive flags can overlap. A run remains `running` while it waits for
input or retry time, and more than one node can be active inside a parallel or
fan-out region.

`useWorkflowList({ status?, name? })` returns the current user's live visible
runs. `useWorkflowActions()` exposes `start`, `cancel`, `pause`, `resume`,
`sendEvent`, and `submitResponse`; `start` accepts `{ version? }`, and response
options accept `{ submissionId?, channel? }`. `useWorkflowRun(name,
{ instanceId?, version? })` combines one selected run, those actions, progress,
and mutation state. A response submitted while paused rejects with retryable
`WORKFLOW_DRAINING`; preserve its submission ID and retry after resume. Events
sent while paused remain durably buffered instead.

These projected fields are enough to render a real-time timeline, node list,
branch lanes, fan-out rows, wait inbox, retry state, or visual graph animation:

- `node_id`, `node_kind`, and `node_path` identify graph nodes;
- `branch_key` identifies a selected parallel/choice lane;
- `parent_step_id`, `item_key`, and `item_index` identify delivery and fan-out
  children;
- statuses and lifecycle timestamps show transitions;
- `workflow_interactions` shows safe open/accepted/expired state.

Keep the canonical graph on an authorized server/admin surface and combine it
with these safe live rows when building a full editor or operator console. Do
not expose graph JSON, run/step values, raw failures, private memory, prompt
content, or response payloads through the general client state store.
Zero supplies this safe live execution projection and the React composition
hooks; it does not bundle a generic graph canvas or visual editor. A canvas
must load canonical topology through an appropriately authorized definition
surface, then join it with the safe live rows in application UI.

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
  `.expired`, and `.delivery_failed`;
- `workflows.fanout.limit_exceeded` and `workflows.advance.failed`.

Stable `WorkflowError` codes include:

- readiness/lifecycle: `WORKFLOW_NOT_READY`, `WORKFLOW_DRAINING`,
  `WORKFLOW_STATE_INVALID`, `WORKFLOW_CONFIG_INVALID`,
  `WORKFLOW_STARTUP_FAILED`, `WORKFLOW_RUNTIME_OWNED`, and
  `WORKFLOW_RUNTIME_LEASE_LOST`; `OWNED` rejects a competing live runtime,
  while `LEASE_LOST` fences a generation that was superseded or expired;
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

Persisted error strings are bounded before storage. Workflow observability
metadata contains bounded instance/node identifiers rather than graph,
payload, delivery, interaction-body, or scratch-memory fields. An activity's
thrown error remains the event's raw `error`; configured sinks own external
serialization/redaction, so application errors must not embed secrets or
sensitive records in their message, stack, or custom fields.

## Storage And Migrations 030, 032, And 033

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
- `_workflow_event_delivery` and `_workflow_event_usage`
- `_workflow_runtime_usage`, `_workflow_step_attempts`, and `_workflow_pauses`

The migration backfills a version only when existing serialized definition
content can be canonicalized and proven to match. It pins compatible legacy
instances and adds stable node metadata to legacy steps. Ambiguous or malformed
legacy history is left on the legacy execution path rather than guessed. DDL
is additive and idempotent; startup also ensures the graph schema for direct
plugin/test composition. Additive-column migration backfills runtime, event,
and interaction usage counters once for existing rows. Active execution and
recovery then require exact counter integrity and never silently rewrite drift.

Migration `032_workflow_runtime_ownership` adds one private generation lease
per workflow database. A `WorkflowService` acquires an exact owner/generation,
and every durable mutation rechecks that generation inside its writer
transaction. A stale service cannot commit after takeover. Standalone
low-level stores and `WorkflowExecutor` remain compatible while no managed
service owns the database; once one does, their next mutation fails with
retryable `WORKFLOW_RUNTIME_OWNED`. Injected executor collaborators must belong
to the executor's own ReactiveDB.

Migration `033_torrent_integrity_hardening` adds database-level fences for
definition/source/scope/status values, active-version ownership, version
retirement, draft source/base relationships, and exact `consumed:<event-id>`
or `discarded:<event-id>` terminal markers. It is deliberately neutral to the
database topology: on Zero 1.3 it protects the single-database event-delivery
shape, and on a later multi-tenant release it also preserves event authority.
Both migrations are additive and repair-safe.

### Zero 1.3 compatibility boundary

Zero 1.3.1 includes Torrent's generic correctness and security fixes without
Guardian multi-tenancy, ReactiveDB Fabric, tenant columns, or the
system/application database split. Existing 1.3 applications keep their
single-database auth and data topology; running the normal migrations adds only
Torrent's graph/runtime tables, ownership lease, and integrity triggers.

Zero 1.3.2 preserves that exact compatibility boundary and hardens the
interaction-event recovery race. It adds no Guardian, Fabric, tenant-column,
or database-topology migration.

An eventual upgrade from 1.3.1 or 1.3.2 to the combined 2.0 platform is
supported. The 2.0 migrator applies the missing Guardian/Fabric migrations and
tenant-integrity migration `031`; the already-recorded `032` and `033`
migrations are not rerun. Migration `031` reconstructs the multi-tenant
workflow relations while reinstalling the same final `033` definition, draft,
version, terminal-event, and authority guarantees.

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
wakes plus scheduler safety sweeps, and crash recovery. The compiler also
produces a canonical compatibility graph for version history, while the proven
1.3 executor continues to run existing sequential instances. Apps can migrate
one definition at a time by replacing `steps` with `flow`; no all-at-once
rewrite is required. The new status-only input/output/error redaction is keyed
to graph runs; legacy instances retain the established 1.3 public projection
for client compatibility.

## Source Map

| Area | Primary files |
| --- | --- |
| DSL, IR, expressions, compilation | `workflow-dsl.ts`, `workflow-ir.ts`, `workflow-expression.ts`, `workflow-dsl-compiler.ts`, `workflow-compiler.ts`, `workflow-ir-validator.ts`, `workflow-ir-expression-validator.ts` |
| Trusted activities | `workflow-activity-catalog.ts`, `workflow-activity-reference-codec.ts`, `workflow-registry.ts` |
| Definition history and drafts | `workflow-definition-canonical.ts`, `workflow-definition-version-validation.ts`, `workflow-definition-version-store.ts`, `workflow-definition-draft-store.ts`, `workflow-definition-manager.ts`, `workflow-definition-http.plugin.ts` |
| Graph persistence and planning | `workflow-graph-store.ts`, `workflow-graph-node-metadata.ts`, `workflow-graph-planner.ts`, `workflow-graph-persisted-state.ts`, `workflow-graph-state-reader.ts`, `workflow-runtime-json.ts`, `workflow-runtime-budget.ts` |
| Graph execution | `workflow-graph-runtime.ts`, `workflow-graph-pump.ts`, `workflow-graph-activity-executor.ts`, `workflow-structural-node-controller.ts`, `workflow-each-controller.ts`, `workflow-wait-controller.ts` |
| Memory, events, and interactions | `workflow-memory-store.ts`, `workflow-memory-context.ts`, `workflow-event-capacity-store.ts`, `workflow-event-persisted-state.ts`, `workflow-interaction-authority.ts`, `workflow-interaction-store.ts`, `workflow-interaction-service.ts`, `workflow-interaction-submission-processor.ts`, `workflow-interaction-event-bridge.ts`, `workflow-event-actor.ts`, `workflow-graph-interaction-validator.ts` |
| Lifecycle and exact wakes | `workflow-graph-transitions.ts`, `workflow-graph-instance-controller.ts`, `workflow-graph-wake-scheduler.ts`, `workflow-execution-tracker.ts` |
| Legacy compatibility | `workflow-frontier-pump.ts`, `workflow-attempt-coordinator.ts`, `workflow-transition-controller.ts`, `workflow-lifecycle-coordinator.ts`, `workflow-executor.ts` |
| Auth, HTTP, and Sync | `workflow-access.ts`, `workflow-http.plugin.ts`, `workflow-public-record.ts`, `workflow-sync-policy.ts` |
| React | `src/frontend/client/workflow-hooks.ts`, `src/frontend/client/workflow-run-hooks.ts` |
| Schema snapshots, storage schema, and migrations | `workflow-schema-snapshot.ts`, `workflow-schema.ts`, `workflow-graph-schema.ts`, `workflow-runtime-schema.ts`, `workflow-runtime-lease-schema.ts`, `workflow-runtime-lease-store.ts`, `workflow-runtime-owner-lease.ts`, migrations `030`, `032`, and `033` |

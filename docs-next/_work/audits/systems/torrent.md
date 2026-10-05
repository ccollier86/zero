---
id: zero.inventory.torrent
type: inventory
audience: [maintainer, agent]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: system-inventory
maturity: supported
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["managed authenticated app", "direct workflow plugin composition", "single-database and Fabric application data modes"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Torrent Workflow System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Torrent is Zero's durable workflow engine. This inventory covers authoring,
compilation, persistence, execution, waits/interactions, authority, recovery,
HTTP and Sync projection, React hooks, and the AI/database-automation bridges.
The pinned source baseline is clean `main` commit
`a3a5f726768dac890f241a3899c0a1acb66265d9`, package metadata 2.1.1. The docs
branch at `cd643b5b862f83b4ab40320486e1b89df1154c87` had no source/package delta
from that baseline. This is not package qualification.

## Purpose And Terminology

A workflow definition describes durable work. Legacy definitions are ordered
steps with handlers. Modern definitions compile code DSL or JSON-safe graph
input into canonical versioned graph IR. An activity is trusted server code
registered by identity/version; a graph may reference only activities allowed
for its authoring source. An instance pins a definition version and authority.
Wait events and interactions are durable external inputs. Public topology is a
payload-free execution projection; private state includes memory, attempts,
receipts, event bodies, and internal graph state.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Planned/final guide | Review status |
| --- | --- | --- | --- | --- | --- |
| Managed plugin/service lifecycle | Supported; authenticated managed app/direct plugin | `createWorkflowPlugin`, `WorkflowPluginConfig`, `WorkflowService`, compatibility getters/stop, app `workflows` config | `src/workflows/{workflow.plugin,workflow-service}.ts`, app/lifecycle tests | [backend/torrent/index.md](../../../backend/torrent/index.md) | Detailed guide authored; independent guide review pending |
| Legacy sequential definitions | Supported compatibility; server | `WorkflowDefinition`, `StepDefinition`, `StepHandler`, `StepContext` | executor/service/runtime tests | [backend/torrent/legacy-workflows.md](../../../backend/torrent/legacy-workflows.md) | Detailed guide authored; independent guide review pending |
| Graph DSL | Supported; trusted code authoring | `flow`, `step`, `waitFor`, `requestAndWait`, `when`, `otherwise`, `choose`, `parallel`, `each` and option/node types | `workflow-dsl.ts`, graph/compiler/each tests | [backend/torrent/authoring.md](../../../backend/torrent/authoring.md) | Detailed guide authored; independent guide review pending |
| Canonical graph IR and limits | Supported; code/database/API/agent boundary | IR schema/version/limits/types, validator and canonicalization | `workflow-ir*.ts`, compiler/graph foundation tests | [backend/torrent/graph-ir.md](../../../backend/torrent/graph-ir.md) | Detailed guide authored; independent guide review pending |
| Compiler and fingerprints | Supported; server | `compileFlow`, `compileWorkflowDefinition`, canonical/fingerprint/stable stringify functions and types | `workflow-compiler.ts`, graph foundation/definition tests | [backend/torrent/authoring.md](../../../backend/torrent/authoring.md) | Detailed guide authored; independent guide review pending |
| JSON-safe expressions | Supported; graph branches/inputs | `expr`, evaluator/detection/validation, AST/reference/operator types | `workflow-expression.ts`, graph tests | [backend/torrent/expressions.md](../../../backend/torrent/expressions.md) | Detailed guide authored; independent guide review pending |
| Schema snapshots and validation | Supported; graph definitions | normalize/rehydrate/validate helpers | `workflow-schema-snapshot.ts`, definition tests | [backend/torrent/definitions.md](../../../backend/torrent/definitions.md) | Detailed guide authored; independent guide review pending |
| Activity catalog and capability gating | Supported; trusted server registry | `WorkflowRegistry`, `WorkflowActivityCatalog`, registration/activity types, `databaseCallable` capability | registry/catalog/compiler/runtime tests | [backend/torrent/activities.md](../../../backend/torrent/activities.md) | Detailed guide authored; independent guide review pending |
| Immutable definition versions/drafts | Supported; code and database-authored graphs | definition records/results/query types plus admin routes | definition store/query/graph tests, plugin routes | [backend/torrent/definitions.md](../../../backend/torrent/definitions.md) | Detailed guide authored; independent guide review pending |
| Graph steps, choices, parallel joins, and each fan-out | Supported; graph runtime | DSL/IR types; `each` policies/concurrency/public-private visibility | graph runtime, each, persisted-state tests | [backend/torrent/control-flow.md](../../../backend/torrent/control-flow.md) | Detailed guide authored; independent guide review pending |
| Retry, deadlines, attempts, and exact wake scheduling | Supported; durable runtime | step options, `MAX_WORKFLOW_ATTEMPTS`, `WorkflowWakeTimer` | runtime/limits/wake/deadline tests | [backend/torrent/retries-and-time.md](../../../backend/torrent/retries-and-time.md) | Detailed guide authored; independent guide review pending |
| Durable waits and early event inbox | Supported; runtime/HTTP/service | `waitFor`, service `sendEvent*`, event routes/records | interaction/event/restart tests | [backend/torrent/events.md](../../../backend/torrent/events.md) | Detailed guide authored; independent guide review pending |
| Request-and-wait interactions | Supported; actor response flow | `requestAndWait`, `WorkflowInteractionAuthority`, interaction types/routes | interaction and authority tests | [backend/torrent/interactions.md](../../../backend/torrent/interactions.md) | Detailed guide authored; independent guide review pending |
| Idempotent system-event delivery | Supported privileged service API | max key constant, delivery options/result, `deliverEventAsSystem` | system-event delivery tests | [backend/torrent/events.md](../../../backend/torrent/events.md) | Detailed guide authored; independent guide review pending |
| Private scratch memory | Supported; graph runtime | `WorkflowMemoryContext`, `WorkflowMemoryLimits`, trusted `WorkflowStartOptions.initialMemory`/`memoryLimits` | memory/private-start/capacity tests | [backend/torrent/memory.md](../../../backend/torrent/memory.md) | Detailed guide authored; independent guide review pending |
| Pause, resume, cancel, and shutdown | Supported; service/HTTP/lifecycle | service methods, routes, shutdown constant/config | cancellation/pause/lifecycle tests | [backend/torrent/lifecycle.md](../../../backend/torrent/lifecycle.md) | Detailed guide authored; independent guide review pending |
| Durable ownership, leases, recovery, and fencing | Supported; system DB runtime | public service/executor authority types; runtime internals | ownership/recovery/fence/runtime tests | [backend/torrent/recovery.md](../../../backend/torrent/recovery.md) | Detailed guide authored; independent guide review pending |
| Actor/system execution authority | Supported; trusted server | execution authority types, actor/system start/run APIs, live fence | authority store/factory/integration/race tests | [backend/torrent/authority.md](../../../backend/torrent/authority.md) | Detailed guide authored; independent guide review pending |
| Definition access and management permission | Supported; Guardian multi-tenant | `WORKFLOW_MANAGE_PERMISSION`, access helpers/policy types | access/multi-tenant/API-key tests | [backend/torrent/authority.md](../../../backend/torrent/authority.md) | Detailed guide authored; independent guide review pending |
| HTTP run and administration APIs | Supported; Guardian-authenticated | `/workflows` run/action/query and admin definition routes | `workflow.plugin.ts`, workflow app/multi-tenant tests | [backend/torrent/http-api.md](../../../backend/torrent/http-api.md) | Detailed guide authored; independent guide review pending |
| Read-only Sync projection | Supported; owner/manager scoped | `defineWorkflowTables`, `createWorkflowSyncPolicyAdapter`, public/client records | sync policy/integration tests | [backend/torrent/realtime.md](../../../backend/torrent/realtime.md) | Detailed guide authored; independent guide review pending |
| React workflow hooks | Supported; authenticated frontend | `useWorkflow`, `useWorkflowList`, `useWorkflowActions`, `useWorkflowRun`, `useWorkflowTopology` and result types | `src/frontend/client/workflow-hooks.ts`, focused tests | [frontend/torrent/hooks.md](../../../frontend/torrent/hooks.md) | Detailed guide authored; independent guide review pending |
| Public topology | Supported payload-free projection | `WorkflowPublicTopology*`, topology route/hook | topology/wake/runtime tests | [frontend/torrent/visualization.md](../../../frontend/torrent/visualization.md) | Detailed guide authored; independent guide review pending |
| AI durable-agent bridge | Supported; AI + Torrent | AI durable runtime/service and private execution state | `src/ai/durable/`, durable/app registration tests | [backend/ai/durable-agents.md](../../../backend/ai/durable-agents.md) | Detailed guide authored; independent guide review pending |
| Database-automation event bridge | Supported; durable function context | `zero.torrent.deliverEvent(...)` through automation scoped services | automation execution-service/dispatcher tests | [backend/database-automations/torrent.md](../../../backend/database-automations/torrent.md) | Detailed guide authored; independent guide review pending |
| Errors and observability | Supported; server | `WorkflowError`, codes/helper; observability factory/emitter/types | error/observability/lifecycle tests | [backend/torrent/operations.md](../../../backend/torrent/operations.md) | Detailed guide authored; independent guide review pending |

## Public Surface Map

### Packages, services, and authoring

- `@zero/framework/workflows` exports plugin/service/registry APIs; activity
  catalog; compiler, graph DSL, expression, IR and schema contracts; access and
  authority contracts; event/interaction/memory/topology types; errors,
  observability, Sync policy, schema tables, constants, and legacy workflow
  types. See [`src/workflows/index.ts`](../../../../src/workflows/index.ts).
- `@zero/framework/server` exposes the managed plugin/service subset and
  execution identity/service types. `getWorkflowService()` and
  `getWorkflowRegistry()` remain compatibility getters; app-local composition
  should bind through managed registration/service seams.
- `@zero/framework`/React client exports five workflow hooks and their public
  results/actions. Hooks combine authenticated action transport with live Sync
  tables and fence/clear state when authorization scope changes.
- `WorkflowService` is the trusted server facade for actor/system start/run,
  advancing, event delivery, pause/resume/cancel, recovery/timeout/retry work,
  disposal, and read/list/topology queries. `WorkflowExecutor` is also public
  for explicit lower-level composition.

### HTTP surface

The plugin mounts the following authenticated routes under `/workflows` by
default:

- `GET /`, `POST /`, and `GET /definitions` for instance lists, starts, and
  accessible definitions.
- `GET /:id`, `/:id/steps`, `/:id/events`, `/:id/topology`, and
  `/:id/interactions` for scoped reads.
- `POST /:id/events`, `/:id/cancel`, `/:id/pause`, `/:id/resume`, and
  `/:id/interactions/:interactionId/responses` for actions.
- Administration definition endpoints under `/admin/definitions` list
  activities/definitions/versions/drafts; read versions/drafts; publish,
  activate, and retire versions; and create/update/delete/publish drafts.

Routes enforce live ownership/tenant/definition authority; UI visibility is not
the boundary. The exact route schemas and response envelopes belong in the HTTP
reference, not a generated inference from these paths.

### Persistence and Sync surface

`WORKFLOW_TABLES` names four public tables: instances, steps, events, and
interactions. `WORKFLOW_SERVER_TABLE_NAMES` additionally covers definition
versions/drafts, graph decisions/edges/each state, private memory, response and
event-delivery details, attempts, pause/runtime ownership/usage, receipts, and
execution authority. Only the bounded client records and public topology cross
Sync; private underscore state, raw event bodies, graph internals, authority
seals, and durable-agent context do not.

## Integration Map

- Managed Torrent requires Guardian. `workflows: false` disables it; otherwise
  authenticated apps default it on. Auth-disabled apps cannot enable managed
  workflows. Instances and private runtime state live in the system database,
  including when application data is Fabric-isolated.
- `workflows.register(registry, { ai })` runs and is awaited before recovery and
  route publication. `onServiceCreated(service)` is the managed app-local
  publication seam. The Scheduler supplies exact wake jobs and safety sweeps;
  plugin shutdown stops intake, aborts/fences attempts, drains to the configured
  grace limit, then releases Guardian/Fabric dependencies.
- Definition versions pin canonical graph, schemas, access policy, activity
  versions, and fingerprints. Changing a registry default affects later starts,
  not already pinned instances.
- Actor authority is captured/sealed and then revalidated at execution and
  commit fences. Audited system principals are explicit. Request-equivalent
  `ctx.zero` services are scoped to the execution identity; unsafe services are
  not projected as tenant-safe capabilities.
- Per-attempt scratch-memory changes commit with the step transition and are
  discarded on failure or stale ownership. `initialMemory` and custom
  `memoryLimits` are trusted service-only graph start options, unavailable over
  HTTP and for legacy workflows; their immutable limits persist through restart.
- Current `each` admits one activity body; arbitrary nested graphs are not
  executable merely because the DSL accepts a flow-shaped descriptor. Private
  visibility keeps fan-out payloads in private state. Independently, ordinary
  public HTTP/Sync redacts run/step/event payloads for every legacy/graph format.
- Early ordinary events are durably retained for later waits. System delivery
  adds a permanent idempotency key/digest contract, enabling database
  automations to resume one exact instance without broadcast behavior.
- AI durable agents use private Torrent receipts for logical once lifecycle
  transitions. Database automations call the narrow event-delivery service,
  while activities can receive other explicitly scoped server services.
- Stable workflow errors/events go through Zero observability. Some metadata
  includes bounded run/step/node identities: those must not become metric labels.
  Public failures and projections remain secret-safe.

## Configuration Inventory

| Configuration | Values/defaults and effect observed | Security/lifecycle notes | Planned section |
| --- | --- | --- | --- |
| `AppConfig.workflows` | `false` disables; `AppWorkflowsConfig` enables/configures; authenticated apps otherwise default enabled | Managed workflows are rejected without Guardian | [configuration.md](../../../backend/torrent/configuration.md#managed-registration) |
| `workflows.register` | Async `(registry, { ai })` app-local registration callback | Completes before recovery/publication; trusted code registers handlers/activities | [configuration.md](../../../backend/torrent/configuration.md#managed-registration) |
| `workflows.onServiceCreated` | Synchronous service publication callback | Use for app-local service binding; not a replacement for registration readiness | [configuration.md](../../../backend/torrent/configuration.md#managed-registration) |
| `workflows.shutdownGraceMs` | Defaults to `DEFAULT_WORKFLOW_SHUTDOWN_GRACE_MS` (30 seconds in inspected source) | Bounds cooperative drain before shutdown continues | [configuration.md](../../../backend/torrent/configuration.md#defaults-and-runtime-phase) |
| `workflows.interactionAuthority` | Optional `WorkflowInteractionAuthority` | Controls actor validation/commit assertions for interaction responses | [configuration.md](../../../backend/torrent/configuration.md#defaults-and-runtime-phase) |
| Direct `WorkflowPluginConfig` | Database, registry/runtime/scheduler, auth/execution services, readiness/lifecycle hooks and advanced dependencies | Lower-level trusted composition; managed `createApp` is preferred | `configuration.md#standalone-plugin` |
| `WorkflowStartOptions.version` | Optional exact definition version selection | Instance remains pinned after start | [definitions.md](../../../backend/torrent/definitions.md#publication-and-activation) |
| `WorkflowStartOptions.initialMemory` | Trusted graph service-only private seed | Atomic with start; not HTTP or legacy; never public Sync | [memory.md](../../../backend/torrent/memory.md#trusted-start-seeding-and-limits) |
| `WorkflowStartOptions.memoryLimits` | Immutable per run; ordinary defaults 256-B key/64-KiB value/256 entries/1 MiB total; hard caps 1,024 B/1 MiB/4,096/16 MiB | Service-only, restart-persistent, graph-only | [memory.md](../../../backend/torrent/memory.md#trusted-start-seeding-and-limits) |
| DSL step/wait/each/parallel options | Versioned JSON-safe graph behavior, retries/timeouts/concurrency/visibility/policies | Compilation and hard graph limits reject invalid definitions before activation | authoring/control-flow guides |

There is no general environment-variable control plane for workflow definitions.
Definition drafts and immutable versions are database records, while executable
activities remain trusted code. No workflow-specific Doctor subsystem was found
in this source pass. Configuration import is trusted module execution; it was
not executed for this inventory.

## Evidence And Verification

Implementation observed in `src/workflows/index.ts`, plugin/service/registry,
DSL/compiler/IR/expression/schema, graph runtime/transitions/stores, authority,
interaction/event delivery, Sync policy/schema, repository, and observability
modules. Managed wiring was traced in `src/frontend/server/app-factory.ts`,
app workflow composition, and public React client exports.

Tests present: 42 direct workflow test files cover access, API-key authority,
app integration, definitions, graph/each/expression/schema behavior, error and
cancellation matrices, execution authority, interactions, lifecycle/live
monitoring, memory/private state, multi-tenant access, pause/deadline, pinned
runtime, repository/recovery, ownership/limits, service facade/start races,
Sync, system event delivery, wake/topology, observability, and plugin lifecycle.
Additional frontend hook, app lifecycle, Fabric recovery, AI registration,
package export, and server capability-topology tests exercise integrations.

Example present: `examples/guardian-fabric-proof/server/torrent-proof.ts` and
its page/test exercise a Guardian/Fabric/Torrent path. It is proof/reference
material, not evidence that every workflow mode was release-qualified.

Checks run for this inventory: source/file searches and static inspection only.
No workflow service, configuration module, app, database, migration, test,
build, or package artifact was executed. Existing `docs/workflows.md` and
related guides were research evidence, not accepted as current contract merely
because they exist.

## Findings

| Category | Finding | Evidence/impact | Disposition |
| --- | --- | --- | --- |
| Documentation architecture | Legacy sequential workflows, modern graph authoring, database definitions, runtime operations, and frontend monitoring are materially different contracts | broad `src/workflows/index.ts` surface and 42 direct tests | Separate guides under one Torrent index; give legacy its own compatibility page |
| Public/private boundary | Public tables/topology are intentionally bounded; private graph, input/event, memory, receipt, and authority state must not leak into examples | schema/Sync policy/client record types | Add an explicit data-projection/security page and cross-links |
| Composition | Managed registration is ordered before recovery and receives AI; global getters are compatibility paths | app integration and plugin source | Lead with `workflows.register`/app-local binding in examples |
| Diagnostics | No dedicated Torrent Doctor audit was found | source search | Decide whether runtime/schema/readiness diagnostics need Doctor coverage; do not imply it exists |
| Product scope | No generic visual graph canvas/editor is bundled | workflow source/package/components inspection; old guide states boundary | Document the backend/editor contracts without presenting a UI as shipped |
| Release evidence | Source/tests/example presence does not qualify a release artifact or restart behavior in deployment | no artifact/runtime checks performed | Separate release and operational qualification |

## Known Future Plans

The current workflow guide describes canonical IR, stable node identities,
definition drafts/editor metadata, admin APIs, and public topology as boundaries
for a **future visual editor**, while explicitly stating that no generic graph
canvas/editor is bundled. That is an architectural extension point, not a
shipped UI or dated commitment. Provenance:
[`docs/workflows.md`](../../../../docs/workflows.md). Consolidate any approved
future Torrent work in `docs-next/backend/torrent/roadmap.md`; do not turn old
implementation-history prose into a second backlog.

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned public system home:
`docs-next/backend/torrent/index.md`, with configuration, authoring, graph IR,
expressions, activities, definitions, control flow, memory, events,
interactions, retries/time, lifecycle, authority, recovery, HTTP API, realtime,
operations, migration, and roadmap pages. Frontend hooks/visualization belong
under `docs-next/frontend/torrent/`. Cross-link Guardian, Scheduler, Fabric and
system DB placement, ReactiveDB automations, AI durable agents, Sync,
observability, deployment/restart, and schema/migration operations.

## Independent Inventory Review

Root checked public plugin/service/DSL/compiler/IR and memory contracts against
the canonical package barrel, graph start options and managed lifecycle. The
four-table public projection, graph-only private seed/limits and activity-versus-
definition distinction agree with source. A concrete scratch-memory result
defect was found: deleting a newly staged key removed it but incorrectly returned
false. The working correction returns whether it existed in the attempt overlay;
three focused memory checks pass with no filesystem fixtures or app config.
This supplemental dirty-source evidence is not a release/recovery claim.

## Completion Review

The twenty-page [backend Torrent manual](../../../backend/torrent/index.md) and
three-page [frontend family](../../../frontend/torrent/index.md) now cover every
inventoried feature group, with actual index/backlinks and adjacent AI/database
automation links. Detailed guide review/package qualification remain separate.
The source checks corrected the inventoried interaction route to `/responses`,
removed a nonexistent plugin prefix option and established payload redaction
for every format. The memory page explicitly identifies its uncommitted
scratch-delete correction; other production contracts retain the clean baseline.

Actual Markdown qualification on 2026-10-05 compiled fifteen complete Torrent/
automation examples against public source APIs in memory: 1 test, 16 assertions
passed. The first check exposed missing required `AppConfig.db`/`tables` in two
examples; those declarations were corrected before the passing run. No config
module, workflow activity, existing DB, listener or provider was executed by
this compiler. This is not an installed-package or deployment qualification.

Focused graph-foundation and memory tests also ran against synthetic state:
36 passed, 190 assertions, including the suite's disposable file-backed memory
restart case. No existing app database or provider was used. This is development
test evidence, not a complete packaged deployment/recovery qualification.

- [x] Discovered authoring, runtime, service, HTTP, Sync, and React surfaces recorded.
- [x] Guardian, Scheduler, system DB, Fabric, AI, automation, and observability integrations traced.
- [x] Tests present, example present, and checks actually run distinguished.
- [x] Current visual-editor boundary separated from future UI direction.
- [ ] Route/request/response schemas enumerated field-by-field in final reference.
- [ ] Operational restart/lease/shutdown behavior implementation-verified on a committed fixture.
- [ ] Whole-platform independent review completed.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory verified or beginning detailed feature rewriting.

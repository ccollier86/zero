---
id: zero.inventory.database-automations
type: inventory
audience: [maintainer, agent]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: system-inventory
maturity: supported
applies_to: ["Zero 2.1.1 source baseline; not a release qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# ReactiveDB Database Automations System Inventory

[Systems inventory index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

This inventory covers ReactiveDB database functions and AFTER triggers,
registry/manifest validation, same-transaction execution, durable outbox
delivery, Fabric source routing, Torrent event delivery, Doctor inspection, and
the public authoring package. The clean source baseline is `main` commit
`a3a5f726768dac890f241a3899c0a1acb66265d9`, package metadata 2.1.1. The docs
branch commit `cd643b5b862f83b4ab40320486e1b89df1154c87` did not change source or
package files relative to that baseline. No runtime database or release artifact
was inspected.

## Purpose And Terminology

A database automation registry contains immutable versioned function and
trigger definitions. A transaction function executes synchronously inside the
originating ReactiveDB transaction; its writes commit or roll back with that
transaction. A durable function is captured into a source-local SQL outbox in
the same commit, then delivered asynchronously at least once. A trigger matches
a logical tracked-table `insert`, `update`, or `delete` after mutation. These are
ReactiveDB interception semantics, not SQLite `CREATE TRIGGER` objects, and
writes that bypass ReactiveDB are not observed.

## Features And Documentation Coverage

| Feature | Maturity and modes | Public surfaces | Evidence | Planned/final guide | Review status |
| --- | --- | --- | --- | --- | --- |
| Versioned database function definitions | Supported; pinned/Fabric | `defineDatabaseFunction`, type guard, definition/mode/options/handler/context/invocation types and kind constant | `src/database-automations/database-function.ts`, definition/registry tests | [functions.md](../../../backend/database-automations/functions.md) | Detailed guide authored; independent guide review pending |
| Transaction functions | Supported; synchronous origin transaction | transaction definition/options/handler/context and `DatabaseTransactionFunctionCapability` | transaction runtime/capability modules and tests | [transaction-functions.md](../../../backend/database-automations/transaction-functions.md) | Detailed guide authored; independent guide review pending |
| Durable functions | Supported; durable sources only | durable definition/options/handler/context and invocation types | function/runtime/outbox/worker modules and tests | [durable-functions.md](../../../backend/database-automations/durable-functions.md) | Detailed guide authored; independent guide review pending |
| AFTER trigger definitions | Supported; tracked ReactiveDB mutations | `defineDatabaseTrigger`, type guard, event/operation/update/options/definition types and kind constant | `database-trigger.ts`, definition tests | [triggers.md](../../../backend/database-automations/triggers.md) | Detailed guide authored; independent guide review pending |
| Exact versioned function references | Supported; trigger chains | `databaseFunctionReference`, reference/target types | trigger/registry/validation source and tests | [triggers.md#function-chains](../../../backend/database-automations/triggers.md#function-chains) | Detailed guide authored; independent guide review pending |
| Update-column and row matching | Supported; update triggers | `deriveChangedColumns`, `matchesDatabaseTrigger`, change type | `database-trigger-matcher.ts`, tests | [Trigger matching](../../../backend/database-automations/triggers.md#events-and-matching) | Detailed guide authored; independent guide review pending |
| Immutable trigger input snapshot | Supported; transaction/durable handlers | `DatabaseTriggerChangeInput`, `DatabaseTriggerFunctionInput` | `database-trigger-input.ts`, runtime tests | [inputs.md](../../../backend/database-automations/inputs.md) | Detailed guide authored; independent guide review pending |
| Registry composition | Supported; app/Fabric startup | `DatabaseAutomationRegistry`, `defineDatabaseAutomations`, definitions/options | `database-automations.ts`, registry tests | [configuration.md](../../../backend/database-automations/configuration.md) | Detailed guide authored; independent guide review pending |
| Canonical manifest/fingerprint | Supported; readiness/version identity | manifest version/creator and manifest entry/types | `automation-manifest.ts`, registry/admission tests | [versioning.md](../../../backend/database-automations/versioning.md) | Detailed guide authored; independent guide review pending |
| Definition/schema validation | Supported; startup/admission | `validateDatabaseAutomations`, validation input/hooks/issue/code types | `automation-validation.ts`, definition/realm/Doctor tests | [validation.md](../../../backend/database-automations/validation.md) | Detailed guide authored; independent guide review pending |
| Deterministic transaction cascades and budgets | Supported; same database transaction | public transaction capability; runtime limits internal | `database-transaction-automation-runtime.ts` and tests | [transaction-functions.md#cascades-and-budgets](../../../backend/database-automations/transaction-functions.md#cascades-and-budgets) | Detailed guide authored; independent guide review pending |
| Transactional durable outbox | Supported; durable file/system sources | managed internal runtime; no public outbox mutation API | outbox schema/store/row/contracts and recovery tests | [delivery.md](../../../backend/database-automations/delivery.md) | Detailed guide authored; independent guide review pending |
| At-least-once lease-fenced delivery | Supported; server lifecycle | durable context receives abort signal/scoped services; worker/dispatcher internal | delivery worker/execution/lease/dispatcher tests | [delivery.md#delivery-semantics](../../../backend/database-automations/delivery.md#delivery-semantics) | Detailed guide authored; independent guide review pending |
| Pinned application DB registration | Supported; single app DB | `AppConfig.databaseAutomations` registry | frontend server config/app integration test | [configuration.md#pinned-database](../../../backend/database-automations/configuration.md#pinned-database) | Detailed guide authored; independent guide review pending |
| Fabric realm registration and routing | Supported; per-realm actor DB | `defineDatabaseRealm({ automations })` | realm admission/actor/manager/Fabric integration tests | [configuration.md#fabric-realms](../../../backend/database-automations/configuration.md#fabric-realms) | Detailed guide authored; independent guide review pending |
| Scoped Zero services in durable handlers | Supported; machine principal | `DatabaseDurableFunctionContext.zero`; execution service types at server boundary | app execution services, delivery execution, authority tests | [services-and-authority.md](../../../backend/database-automations/services-and-authority.md) | Detailed guide authored; independent guide review pending |
| Exact Torrent instance resume/delivery | Supported; durable function | scoped `zero.torrent.deliverEvent(instanceId, event, payload, { key })` | automation execution-service and system-event delivery tests | [torrent.md](../../../backend/database-automations/torrent.md) | Detailed guide authored; independent guide review pending |
| Errors and observability | Supported; authoring/runtime | `AUTOMATION_ERROR_CODES`, `AutomationError`, guards/code/detail/options types | error/runtime/dispatcher modules and tests | [operations.md](../../../backend/database-automations/operations.md) | Detailed guide authored; independent guide review pending |
| Doctor inspection | Supported; project diagnostics | Doctor findings, not package authoring import | `src/doctor/platform-doctor-database-automation-*.ts` and tests | [operations.md#doctor](../../../backend/database-automations/operations.md#doctor) | Detailed guide authored; independent guide review pending |

## Public Surface Map

### Authoring package

`@zero/framework/database-automations` exports the supported authoring and
validation boundary:

- stable `AutomationError` codes, safe detail types, and guards;
- transaction/durable function builders, type guards, kind constant, handlers,
  contexts, invocations, and JSON-compatible value types;
- trigger builder, type guard, kind constant, operation/event/update contracts,
  and exact function references;
- trigger changed-column derivation and matching;
- canonical manifest version/creator and function/trigger manifest types;
- definition/schema validation hooks and issue types;
- immutable registry/composition builder and definition options;
- immutable trigger input contracts and the narrow transaction capability.

See [`src/database-automations/index.ts`](../../../../src/database-automations/index.ts).
The delivery worker, outbox store/schema, dispatcher, source catalog, mutation
interceptor, and managed lifecycle are framework internals, not a public queue
administration SDK. `@zero/framework/server` exposes the execution-service and
Torrent-service integration types needed by managed trusted composition; it
does not re-export the authoring barrel as a replacement for the subpath.

### Configuration and runtime boundary

- `createApp({ databaseAutomations: registry })` attaches automations to the
  pinned application database.
- `defineDatabaseRealm({ automations: registry })` embeds an admitted manifest
  and executable registry into each matching Fabric actor source. Executable
  handlers do not cross the actor protocol.
- No HTTP route, browser hook, management UI, CLI mutation command, or direct
  public outbox API was found. The public contract is declarative authoring plus
  managed execution and diagnostics.

## Integration Map

- ReactiveDB's same-commit mutation interceptor owns visibility of logical
  tracked changes. Matching triggers run in admitted registry order; each
  trigger's referenced functions run in declaration order. Transaction
  function writes can enqueue further matching changes deterministically.
- Transaction handlers receive a revocable narrow database capability. They
  are synchronous: returning a promise is rejected. Canonical system tables are
  outside this capability; pinned projection anchors are unregistered, whereas
  required Fabric anchors are registered and explicitly read-only. This is not
  a blanket raw-SQL/table-name fence. Failures or budget breaches abort the origin
  transaction.
- Durable commands are inserted into a private outbox in the source database in
  the same transaction. A registry with durable functions therefore requires a
  crash-durable source; hot mode needs its persistence guarantees satisfied.
- The system database catalogs pinned and Fabric physical sources for restart
  recovery. The dispatcher scans bounded catalog pages, drains distinct sources
  in parallel, and permits only one sequential worker per source. Claims renew
  lease fences; timeout, shutdown, or lost authority aborts the execution
  context, and stale completion cannot commit delivery state.
- Durable handlers execute under a server-owned application/tenant binding,
  not a fabricated browser session or inherited human identity. Their `zero`
  services are authority-scoped and rechecked around awaited work.
- Torrent delivery takes an exact `instanceId`, event, payload, and permanent
  idempotency key. This resumes one intended workflow instance rather than all
  workflows waiting on an event name.
- Manifest/fingerprint and source catalog state let startup, Fabric actors, and
  Doctor compare executable definitions with admitted storage state. Old
  durable function versions must remain registered until their backlog drains.
- Errors use stable automation/database codes and observability uses bounded,
  low-cardinality metadata; row payloads, credentials, and handler inputs must
  not be logged.

## Configuration Inventory

| Configuration | Type/default and observed behavior | Security/startup effect | Planned section |
| --- | --- | --- | --- |
| `AppConfig.databaseAutomations` | Optional admitted `DatabaseAutomationRegistry` | Binds only to pinned app DB; copied/revalidated against tables at startup | `docs-next/backend/database-automations/configuration.md#pinned-database` |
| `DatabaseRealm.automations` | Optional admitted registry in `defineDatabaseRealm` | Runs actor-local in each Fabric source; fingerprint/manifest are part of realm admission | `configuration.md#fabric-realms` |
| `defineDatabaseAutomations({ functions, triggers, include? })` | Immutable composition; identities unique; trigger targets exact and present | Invalid/colliding definitions fail startup/admission | `configuration.md#registry-composition` |
| Function `name`, `version`, `mode`, handler | Versioned identity; mode is `transaction` or `durable` | Changing behavior requires a new version; handler is trusted server code | `functions.md#public-declaration` |
| Trigger `name`, `version`, `table`, `after`, `run` | AFTER insert/update/delete; update can select columns; run is nonempty ordered exact references | Table/columns and targets validated against admitted schema/registry | `triggers.md#events-and-matching` |
| Transaction budgets | Internal managed defaults: cascade depth 16, changes 256, invoked functions 256, durable effects 256 | Breach fails closed and rolls back; no app config knob was found | `transaction-functions.md#cascades-and-budgets` |
| Delivery runtime | Internal defaults: one worker/source; catalog source concurrency 8 (max 64); scan 1 second (max 300 seconds); lease 30 seconds; handler timeout 5 minutes (max 24 hours) | Framework-managed recovery/throughput, not public definition config | `delivery.md#managed-defaults` |
| Outbox limits/retry | Fixed schema/runtime bounds include 1-MiB payload and max 100 attempts; retention/record ceilings are internal constants | Protect source DB and fail/dead-letter boundedly | `delivery.md#capacity-and-retention` |

There are no automation-specific environment variables in the inspected public
contract. Registry definition is ordinary trusted TypeScript config and executes
as part of app configuration loading; it is not a static manifest-only read.
Doctor inspects identities, targets, schema/fingerprints, realm admission and
abstract infrastructure readiness. Supplied actor fingerprints/aggregate health
can extend this evidence; the checker does not itself inspect live source
catalog/outbox items or run handlers. No app configuration module or Doctor
command was executed here.

## Evidence And Verification

Implementation observed in the public barrel/builders/registry/manifest/
validation modules; ReactiveDB transaction runtime/interceptor; outbox schema,
store, delivery worker, execution fence, dispatcher and source catalog; pinned
and Fabric app composition; and Doctor automation modules.

Tests present: nine direct files under `src/database-automations/` cover errors,
definitions/registry, transaction execution/cascades, runtime/restart, outbox
store, source catalog, worker and dispatcher. Additional database actor,
coordinator, manager, realm admission, pinned/Fabric createApp integration,
execution-service, migration, Doctor, system-runtime and package-export tests
exercise cross-system behavior. No dedicated example app using automations was
found in `examples/`.

Checks run: repository searches and static source inspection only. No tests,
build, config import, app, migration, database, handler, provider, or package
artifact was executed. `docs/framework/reactive-database-automations.md`,
platform configuration, SDK reference, workflows, and roadmap content were
used as research evidence only.

## Findings

| Category | Finding | Evidence/impact | Disposition |
| --- | --- | --- | --- |
| Documentation | The current feature needs separate transaction and durable semantics; calling both “functions” without the commit/delivery distinction is unsafe | function types and transaction/outbox runtimes | Make the distinction the first decision in the system guide |
| Scope | Automation runtime/queue control is intentionally managed and internal; no route/UI/CLI/outbox SDK exists | public barrel versus internal runtime modules | Do not invent management APIs; document operational visibility through Doctor/observability |
| Example coverage | No current example app was found for pinned and Fabric automation authoring | `examples/` search | Add a synthetic reference fixture before calling examples verified |
| Configuration | Runtime budgets and dispatcher/outbox tuning are internal fixed policy, not public app options | managed app/runtime constructors | Reference observable limits without showing unsupported config keys |
| Delivery contract | Durable delivery is at least once; external side effects require the stable invocation plus exact function identity for idempotency | invocation/outbox/worker contracts | Give idempotency a dedicated task section |
| Release evidence | Source/test presence does not establish packaged or crash/restart qualification | no package/runtime execution in this audit | Run disposable committed-fixture qualification separately |

## Known Future Plans

The current platform roadmap's schema-declared AI idea may build on database
automation but is research, not an automation API. No separately approved
database-automation expansion was established by this inventory. Historical
requests for broader SQL-style functions/triggers or database branching must not
be presented as shipped or committed work without a canonical roadmap entry.
Keep approved future work in
`docs-next/backend/database-automations/roadmap.md` and link rather than repeat
it. Roadmap provenance:
[`docs/platform-roadmap.md`](../../../../docs/platform-roadmap.md).

## Navigation And Cross-Link Plan

Parent: `docs-next/_work/audits/systems/index.md`. Planned public home:
`docs-next/backend/database-automations/index.md`, with configuration, functions,
transaction functions, durable functions, triggers, inputs, validation,
versioning, delivery, services/authority, Torrent integration, operations,
testing, and roadmap pages. Cross-link ReactiveDB/schema/mutations, Fabric and
database modes, system DB/migrations, Torrent events, Guardian machine
authority, Doctor, observability, and deployment/recovery.

## Independent Inventory Review

Root checked the exact authoring barrel/builders, immutable references, function
context types, managed pinned/Fabric wiring and durable execution-service
projection. The transaction/durable split, narrow Torrent delivery and managed
private outbox claims agree with source. This does not qualify outbox recovery
or a deployed handler; final examples and error-code references remain separate
work, not accepted defects or bypasses.

## Detailed Guide Closeout And Synthetic Evidence

The fifteen-page [Database Automations manual](../../../backend/database-automations/index.md)
now maps all nineteen inventoried feature groups to actual guides, including
configuration, capability/authority, exact Torrent correlation, errors, Doctor,
delivery and testing. Source contracts are still pinned to the original clean
production baseline; no automation production source changed in this pass.
Independent detailed-guide review and package qualification remain pending.
The actual Markdown declaration examples later joined the Torrent example
check: fifteen total complete examples compiled, 1 test/16 assertions passed.
The initial compile exposed omitted required AppConfig fields in two examples;
those docs were corrected before the passing run. No config or activity was
executed by this authoring compiler.

Focused checks actually executed on 2026-10-05:

- Definitions, registry and safe errors: 11 passed, 57 assertions.
- Transaction runtime and fake-service delivery worker: 14 passed, 62 assertions.
- New synthetic pinned identity-boundary test: 4 passed, 28 assertions.

The pinned candidate was disproven: genuine ephemeral runtimes plus a declared
Guardian FK and actual managed projection leave anchors unregistered for app
CRUD. Create/update/delete/nested-delete through the narrow function capability
fail and roll back origin data; anchors and canonical system identities stay
unchanged. The initial synthetic fixture wrongly registered the FK app table
before projection and failed startup; it was corrected to managed ordering.
The new regression is uncommitted development evidence, not a released artifact.
No existing app data, file database, provider, envfile or Doctor execution was
used. Trusted raw SQL was never asserted to be read-only or an auth bypass.

## Completion Review

- [x] Public authoring symbols and managed pinned/Fabric integrations recorded.
- [x] Transaction, durable outbox, authority, recovery, errors, and Doctor boundaries traced.
- [x] Tests present, missing example, and checks actually run distinguished.
- [x] Current capabilities separated from speculative SQL/AI extensions.
- [ ] Add and verify a disposable pinned/Fabric automation reference example.
- [ ] Reconcile every validation code and error outcome in the final reference.
- [ ] Whole-platform independent review completed.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory verified or beginning detailed feature rewriting.

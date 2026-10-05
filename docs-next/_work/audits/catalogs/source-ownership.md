---
id: zero.inventory.catalog.source-ownership
type: inventory
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# Source Ownership And Runtime Activation

[Catalog index](./index.md) · [Documentation index](../../../index.md)

This map reconciles source discovery with the [system registry](../systems/index.md)
and [package exports](./package-exports.md). Counts are an inspection snapshot
including explicitly approved uncommitted regression files; they are not
a passing-test count. Shared directories deliberately name complementary owners.
Every source directory has a destination; that does not claim that every
behavior is already verified or documented.

## Source Ownership

| Source directory | Files | Test/spec files present | Primary inventory and complementary scope |
| --- | ---: | ---: | --- |
| `src/*` | 5 | 5 | [cli-tooling](../systems/cli-tooling.md): Package export/distribution/build checks; tests are not app APIs. |
| `src/add` | 4 | 1 | [cli-tooling](../systems/cli-tooling.md): Source-copy CLI and registry. |
| `src/ai` | 143 | 39 | [ai](../systems/ai.md): Provider/method/media/tool/agent/durable services. |
| `src/auth` | 460 | 119 | [guardian](../systems/guardian.md): Identity, tenancy/authority and OIDC server protocol; native-client companion recorded separately. |
| `src/cli` | 1 | 0 | [cli-tooling](../systems/cli-tooling.md): Command dispatch. |
| `src/components` | 604 | 85 | [frontend-components](../systems/frontend-components.md): Data-controls/forms/design-system/modal and Guardian/Studio presentation are complementary inventory owners. |
| `src/create-zero` | 11 | 3 | [cli-tooling](../systems/cli-tooling.md): Scaffolding and install safety. |
| `src/data-studio` | 51 | 11 | [data-studio](../systems/data-studio.md): Logical table codecs, service, realm and thin routes. |
| `src/database-automations` | 46 | 9 | [database-automations](../systems/database-automations.md): Trigger/function runtime and durable effects. |
| `src/databases` | 195 | 50 | [fabric](../systems/fabric.md): Realm registry, subprocess executors, projections and persistence placement; no /databases package route. |
| `src/doctor` | 43 | 8 | [doctor](../systems/doctor.md): Config/source/infra diagnostics with actual import/read trust boundary. |
| `src/email` | 11 | 1 | [email](../systems/email.md): Delivery providers/runtime. |
| `src/frontend` | 327 | 126 | [platform-runtime](../systems/platform-runtime.md): Server composition/config plus frontend-runtime/sdk/router; symbols mapped individually in frontend catalogs. |
| `src/hooks` | 31 | 3 | [frontend-forms](../systems/frontend-forms.md): Forms plus generic UI hooks owned frontend-components/design-system/modal-manager; individually cataloged. |
| `src/kv` | 28 | 6 | [kv](../systems/kv.md): Atomic memory-first KV/durability/limiters. |
| `src/lib` | 2 | 0 | [design-system](../systems/design-system.md): Utilities and strict React context; not a separate end-user system. |
| `src/local-tools` | 4 | 1 | [cli-tooling](../systems/cli-tooling.md): Committed-package provenance launchers/releases. |
| `src/migrations` | 111 | 39 | [migrations](../systems/migrations.md): Ledger/artifact/SQL plans and system migration definitions. |
| `src/modals` | 8 | 1 | [modal-manager](../systems/modal-manager.md): Dialog store/manager/confirmation primitives. |
| `src/native` | 76 | 19 | [native-auth-sdks](../systems/native-auth-sdks.md): Public native client/broker; server OIDC lives auth. |
| `src/notifications` | 7 | 2 | [notifications](../systems/notifications.md): Persisted notification operations and plugin. |
| `src/observability` | 11 | 2 | [observability](../systems/observability.md): Structured events/runtimes/sinks/endpoints. |
| `src/pages` | 4 | 0 | [storage](../systems/storage.md): Storage page composition; public frontend organism contract has complementary frontend-data-controls home. |
| `src/pdf` | 22 | 8 | [pdf](../systems/pdf.md): Rendering queue/policy/browser/storage integration. |
| `src/persistence` | 13 | 1 | [persistence](../systems/persistence.md): SQLite connection/snapshot/transaction/cache primitives. |
| `src/resources` | 48 | 14 | [resources](../systems/resources.md): Declarative exposure/policy/scoped CRUD. |
| `src/rooms` | 7 | 1 | [rooms](../systems/rooms.md): Membership/presence/room authority. |
| `src/runtime` | 7 | 2 | [platform-runtime](../systems/platform-runtime.md): App-local service registry and compatibility binding. |
| `src/scheduler` | 6 | 2 | [scheduler](../systems/scheduler.md): Cron jobs and lifecycle. |
| `src/schema` | 9 | 2 | [schema](../systems/schema.md): Declarations/codecs/Guardian references. |
| `src/storage` | 104 | 29 | [storage](../systems/storage.md): Byte/drive/ACL/capability/Studio domains and upload hooks. |
| `src/sync` | 136 | 42 | [sync](../systems/sync.md): ReactiveDB, durable change log, client transport and state; ReactiveDB and frontend-sdk own complementary contracts. |
| `src/test-support` | 1 | 0 | [cli-tooling](../systems/cli-tooling.md): Internal isolated browser verification support; not a published app API. |
| `src/tokens` | 8 | 2 | [tokens](../systems/tokens.md): Application reusable tokens distinct from access JWT. |
| `src/update` | 7 | 4 | [cli-tooling](../systems/cli-tooling.md): Dependency/archive updater and rollback. |
| `src/vector` | 18 | 6 | [vector](../systems/vector.md): Native local index service/filter/AI composition. |
| `src/workflows` | 185 | 42 | [torrent](../systems/torrent.md): Durable definitions/runs/nodes/activities/HTTP. |

Source enumeration used Bun.Glob with read-only file names; no imports, tests,
configuration, environment files or databases were evaluated.

## Managed Composition Cross-Check

[createApp](../../../../src/frontend/server/app-factory.ts) owns config/path
admission, independent system/application planes, resources, frontend build,
database realms/projection and lifecycle. Service activation is traceable through
[app-platform-services.ts](../../../../src/frontend/server/app-platform-services.ts):

| Service | Managed activation | Data/lifecycle owner |
| --- | --- | --- |
| Application tokens | Always mounted | System DB; application token inventory. |
| Guardian | auth enabled | System DB and app-local auth runtime; tenant/application live authority. |
| Observability | Config-resolved enabled/disabled behavior | App-local runtime/store/sink; explicit endpoint policy. |
| AI/vector/PDF | Resolved subsystem option not false | Optional service/runtime; separate provider/native/browser dependencies. |
| KV | Enabled by default, false disables | Dedicated memory+journal/checkpoint service and lifecycle. |
| Scheduler | Managed service mounted | App-local Cron jobs; not a durable workflow engine. |
| Notifications/rooms/storage | Auth enabled | System metadata, own service policy and cleanup; storage bytes separate. |
| Torrent | Auth enabled and workflows not false | System workflow records, trusted activities, bounded run executor and drain. |
| Sync/resources | Resolved app/data/sync profile | Application and classified system/tenant logs; shared resource/live authority policy. |
| Fabric/projection | Resolved topology and declared identity refs | Subprocess per-realm DB actors, system authority and shallow identity anchors. |
| Database automations | Explicit app/realm automation declarations | Transaction functions plus durable source outbox/effect dispatcher. |
| Email | Optional config; disabled runtime otherwise | Provider runtime used by Guardian intent/outbox, not an implicit durable generic queue. |
| Data Studio | Complete official feature fragments + required profile | Explicit tenant realm contribution, logical-table service/router and client resources. |

The [configuration inventory](../systems/platform-configuration.md) owns exact
top-level options; each subsystem owns its nested defaults and behavior. Routing,
request-service projection and standalone low-level plugins are separate contracts.

## CLI, Package And Independent Repositories

- [CLI tooling](../systems/cli-tooling.md) owns two package bins, six dispatch
  subcommands, source-copy/updater and four external saved-release launchers.
- [Doctor](../systems/doctor.md), [migrations](../systems/migrations.md) and
  [PDF](../systems/pdf.md) own their actual command behavior and trust boundaries.
- [Native SDKs](../systems/native-auth-sdks.md) separates framework TypeScript
  protocol/client from ignored independent Rust/Tauri and Chrome extension repos.
- [Agent tooling](../systems/agent-tooling.md) distinguishes existing instructions,
  bundles/scripts from proposed capabilities; parent-machine policy is not a
  package-provided feature.
- [Frontend components](./frontend-components.md), [hooks](./frontend-hooks.md),
  [support](./frontend-support.md), [SDK members](./frontend-sdk-members.md) and
  [unpublished bindings](./frontend-internal-bindings.md) cover source-local and
  public presentation separately.

## Remaining Gates

- [ ] Independent review reconciles shared-directory ownership and all public features.
- [ ] Final guide map replaces planned destinations with actual canonical links.
- [ ] Installed artifact/import/example/mode checks qualify support.

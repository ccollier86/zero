---
id: zero.inventory.systems
type: index
audience: [agent, maintainer]
owner: zero-documentation
status: in-review
visibility: internal
---

# System Inventory Registry

[Audit index](../index.md) · [Documentation index](../../../index.md)

This registry reconciles public exports, runtime composition, frontend
components/hooks, CLI dispatch and separately maintained SDKs. An inventory
destination is not a completed feature guide or release qualification.

## Source Baseline

Framework `2.1.1`, clean source commit
`a3a5f726768dac890f241a3899c0a1acb66265d9`, inspected 2026-10-04.
The clean baseline is retained for audit provenance. The user subsequently
authorized correction of all confirmed defects, so owning inventories record
supplemental working-tree runtime/package fixes separately. See the
[findings ledger](../findings.md); no release qualification follows from them.

## Systems

| System | Responsibility | Inventory |
| --- | --- | --- |
| Platform runtime | Application composition, Elysia extensions, request services and shutdown. | [Source/contract inventory](./platform-runtime.md) |
| Platform configuration | App options, defaults, service activation and trusted configuration loading. | [Source/contract inventory](./platform-configuration.md) |
| Guardian | Identity, account flows, sessions, authorization, tenants, API keys and auditing. | [Source/contract inventory](./guardian.md) |
| Native auth SDKs | Framework public client protocol and independently versioned Rust/Tauri and extension clients. | [Source/contract inventory](./native-auth-sdks.md) |
| Schema | Table/field declarations, identity metadata, inference and client projections. | [Source/contract inventory](./schema.md) |
| ReactiveDB | Tracked CRUD, transactions, commit notifications and durable change logs. | [Source/contract inventory](./reactive-db.md) |
| SQLite persistence | Storage modes, connection defaults, snapshots and ownership. | [Source/contract inventory](./persistence.md) |
| ReactiveDB Fabric | Database realms, subprocess actors, tenant databases and placement. | [Source/contract inventory](./fabric.md) |
| Migrations | Immutable migration history, plans, backups, targeting and rollback. | [Source/contract inventory](./migrations.md) |
| Resources | Declarative exposure, field policies, CRUD and sync authorization. | [Source/contract inventory](./resources.md) |
| Realtime and state | Socket lifecycle, snapshots/change streams, state slices and ephemeral topics. | [Source/contract inventory](./sync.md) |
| Database automations | Declarative triggers/functions, durable effects and workflow resume correlation. | [Source/contract inventory](./database-automations.md) |
| Torrent | Versioned workflow definitions, scratch memory, waits, retries and branches. | [Source/contract inventory](./torrent.md) |
| AI | Providers, generation/embedding/media/tools/agents, durable integration and telemetry. | [Source/contract inventory](./ai.md) |
| Scheduler | Registered task lifecycle, schedules and runtime error behavior. | [Source/contract inventory](./scheduler.md) |
| Storage | Drives, files, ACLs, signed capabilities and Storage Studio control plane. | [Source/contract inventory](./storage.md) |
| Data Studio | Logical tenant tables, schemas, rows, queries and ownership. | [Source/contract inventory](./data-studio.md) |
| Vector | Local indexes, safe metadata filters, scopes and embedding bridge. | [Source/contract inventory](./vector.md) |
| KV | Durability, atomic mutation, expiry, limiters and helpers. | [Source/contract inventory](./kv.md) |
| Email | Provider configuration, rendering, sending and account delivery boundaries. | [Source/contract inventory](./email.md) |
| Notifications | Persisted notification records, delivery and realtime client surfaces. | [Source/contract inventory](./notifications.md) |
| Rooms | Membership and permissioned room lifecycle. | [Source/contract inventory](./rooms.md) |
| Application tokens | Scoped reusable application tokens, distinct from Guardian access tokens. | [Source/contract inventory](./tokens.md) |
| PDF | Optional generation/rendering service and provider integration. | [Source/contract inventory](./pdf.md) |
| Observability | Codes, errors, adapters/sinks, bounded buffers and app-local lifecycle. | [Source/contract inventory](./observability.md) |
| Frontend runtime | Client/provider composition, hydration and authorization scope. | [Source/contract inventory](./frontend-runtime.md) |
| Frontend SDK | Authenticated transport, services, facade methods and data caches. | [Source/contract inventory](./frontend-sdk.md) |
| Frontend routing | Pages/layouts, auth navigation, metadata and client/server routing. | [Source/contract inventory](./frontend-router.md) |
| Frontend components | Individual public component families and composition. | [Source/contract inventory](./frontend-components.md) |
| Frontend data controls | Tables, master/detail, control planes, server queries and async edits. | [Source/contract inventory](./frontend-data-controls.md) |
| Frontend forms | Schema-aware form utilities, submission, hooks and validation. | [Source/contract inventory](./frontend-forms.md) |
| Modal manager | Dialog orchestration, presentation and modal hooks. | [Source/contract inventory](./modal-manager.md) |
| Design system | Tokens, themes, icons, animation, accessibility and styling. | [Source/contract inventory](./design-system.md) |
| CLI tooling | Scaffolding, update/add/migration/local tooling and command side effects. | [Source/contract inventory](./cli-tooling.md) |
| Doctor | Public checks, report contracts, trusted config imports and read-only data inspection. | [Source/contract inventory](./doctor.md) |
| Agent tooling | Existing agent files, onboarding artifacts and future discovery tools. | [Source/contract inventory](./agent-tooling.md) |
| Optional documentation plugin | Admitted Markdown manifests, reader/search/projections and native build artifacts; supplemental 2.5.0 working feature. | [Source/package inventory](./docs-plugin.md) |

## Completeness Gates

The [package export catalog](../catalogs/package-exports.md) records every
concrete route, including wildcard expansion. Frontend catalogs individually
record components, hooks, support exports and SDK members, not only their
umbrella barrels. The source ownership map must additionally account for
runtime modules and CLI-only/internal surfaces.

- [x] All inventories independently reviewed against actual code.
- [x] Source directories, exports, runtime activation and CLI surfaces reconciled.
- [x] Each discovered public feature assigned a planned canonical guide/config/integration destination; actual detailed pages remain next-stage work.
- [ ] Findings have evidence and a deliberate disposition.
- [ ] Final detailed guides/examples/package qualification completed.

No claim that all systems are secure, operationally verified or shipped follows
from a static inventory.

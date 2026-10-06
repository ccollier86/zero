---
id: zero.torrent.index
type: index
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: index
maturity: supported
applies_to: ["2.4.2 source update; focused release checks recorded separately"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.2"
  commit: "5cf3009f63767c4052065aa211734f2ebffb2c9f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Torrent Durable Workflows

[Backend systems](../index.md) · [Documentation index](../../index.md)

Torrent is Zero's server-side durable workflow engine. It combines versioned
code/database-authored graphs, trusted activities, retries, waits, interactions,
bounded parallel/item execution, private scratch memory, live progress and
Guardian authority. The public package remains @zero/framework/workflows;
the product name does not rename APIs.

A workflow instance is one run with a stable instanceId. The server executes
it; a browser editor or agent can author a declarative graph without keeping a
tab connected. Functions/activity implementations still belong to trusted
server code, not arbitrary JavaScript stored in a database.

## Start Here

- [Configuration](./configuration.md): managed registration, system DB and
  publication/recovery ordering.
- [Authoring](./authoring.md): minimal registry/flow, compiler and exact versions.
- [Activities](./activities.md): typed handlers, context, schemas and the
  databaseCallable trust boundary.
- [Graph IR](./graph-ir.md): persisted serializable graph, limits and validation.
- [Expressions](./expressions.md): safe input/memory/output references and
  conditional expressions without eval.
- [Control flow](./control-flow.md): choice, parallel joins and bounded each.
- [Definitions](./definitions.md): immutable versions, activation, drafts and
  database editor integration.
- [Events](./events.md): durable inbox, exact run targeting and system receipts.
- [Retry-safe system starts](./system-starts.md): one durable run per logical
  background command, including lost acknowledgements and restart.
- [Interactions](./interactions.md): request-and-wait, delivery, validation and
  response authority across web/email/SMS.
- [Memory](./memory.md): attempt-local staged private scratch data.
- [Retries and time](./retries-and-time.md): attempts, deadlines and wake timers.
- [Authority](./authority.md): owner/manager access, tenant boundaries and sealed
  actor/system execution.
- [Lifecycle](./lifecycle.md): pause/resume/cancel and awaited shutdown.
- [Recovery](./recovery.md): single-owner lease, restart and stale attempts.
- [HTTP API](./http-api.md): authenticated run and definition administration.
- [Realtime](./realtime.md): read-only payload-safe Sync projection.
- [Legacy workflows](./legacy-workflows.md): sequential compatibility and upgrade.
- [Operations](./operations.md): errors, safe observability and tests.
- [Roadmap](./roadmap.md): established behavior versus future expansion.

[Frontend hooks and visualization](../../frontend/torrent/index.md) document
the five integrated hooks and safe topology/status composition.
The [AI durable-agent guide](../ai/durable-agents.md) and
[database automation bridge](../database-automations/torrent.md) cover adjacent
integrations; neither replaces the general workflow engine.

## Mental Model And Design

An activity executes one bounded attempt. Its successful output/step transition
and staged memory commit together. A wait stores its need for input; incoming
events remain durable until an eligible frontier can claim them. A definition
version pins graph, schemas/access and exact activity references.

The source supports an inferred philosophy of simple declarative authoring over
one canonical graph, trusted versioned code separated from untrusted definition
data, explicit durable ownership, live authorization at security-sensitive
commits, and privacy-safe progress rather than exposing private execution state.

External effects are not exactly once. Use context.idempotencyKey and downstream
business/provider idempotency. Abort/fencing protects local state, not rollback
of already accepted remote I/O.

## Data Planes And Review Status

Managed Torrent state lives in system.db, including when application business
data is isolated by Fabric. Activities use scope-closed services/data; system
workflow persistence is not moved into every tenant file.

These are source-backed internal drafts, not released-package or full
production qualification. [Memory](./memory.md) identifies its reviewed
uncommitted correction separately from the clean baseline.

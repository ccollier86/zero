---
id: zero.sync.overview
type: index
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: overview
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Realtime Sync

[Backend index](../index.md) · [Documentation index](../../index.md)

Sync connects tracked server changes to reactive client stores. It delivers
policy-filtered snapshots, reconnect catch-up, live changes and exact mutation
acknowledgments. Durable user state and ephemeral collaboration share the
transport but have different ownership and persistence rules.

## How The Pieces Fit

ReactiveDB owns commits and retained history. Resources and Guardian determine
which data a connection may see or change. Fabric supplies isolated tenant data
planes. Sync transports the admitted result; the client uses XState stores and
Zero hooks to update affected UI without treating a browser cache as authority.

## Feature Guides

- [Authentication](./authentication.md): handshake, current authority and revocation.
- [Snapshots](./snapshots.md): subscriptions, loading modes and baseline assembly.
- [Reconnect](./reconnect.md): sequence/epoch replay and reset behavior.
- [Mutations](./mutations.md): optimistic writes and authoritative receipts.
- [Policies](./policies.md): deny-wins table and resource access.
- [Lazy data](./lazy-data.md): authenticated server queries and page membership.
- [Data planes](./data-planes.md): independent default/system/tenant streams.
- [Tenant Sync](./tenant-sync.md): actor-backed delivery and authority fences.
- [Durable user state](./user-state.md): persisted scoped preferences and JSON values.
- [Ephemeral topics](./ephemeral.md): bounded presence, typing and collaboration.
- [Topic policies](./ephemeral-policy.md): server-derived namespaces and ownership.
- [Clients](./clients.md): low-level transport/store APIs versus the managed SDK.
- [Lifecycle](./lifecycle.md): close, drain, background work and observability.
- [Configuration](./configuration.md): managed and standalone options and limits.
- [Roadmap](./roadmap.md): separately identified future work.

## Philosophy And Integration

Realtime delivery is a consequence of admitted data changes, not an alternative
authorization system. Loading mode is not permission. A new tenant or login
scope requires a new authoritative baseline; displaying stale data briefly is
not an acceptable shortcut.

For app construction prefer [managed runtime composition](../runtime/index.md)
and the [client SDK](../../frontend/sdk/index.md). Low-level composition is useful
for a deliberately custom transport but does not inherit managed defaults.

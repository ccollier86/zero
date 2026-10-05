---
id: zero.sync.ephemeral
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: ephemeral
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

# Ephemeral Collaboration Topics

[Sync index](./index.md) · [Documentation index](../../index.md)

Ephemeral topics hold process-local, nonpersistent JSON values. Use them for
presence, typing and cursors; use durable records for anything that must survive
a server restart.

## Protocol And Ownership

Clients subscribe/unsubscribe and set/delete topic keys. EphemeralClient exposes
those operations, local get/getEntries, subscriptions, throttled sets and
onError. Writes are fire-and-forget, not a transactional persistence receipt.
The server applies [topic policy](./ephemeral-policy.md), namespace isolation and
key ownership before fanout.

A TTL is in milliseconds, from 1 through 300000 when supplied. Expiry cleanup
runs every 5000ms by default. Disconnect removes the socket's applicable
ephemeral ownership/subscriptions. Namespace identity is server-side; a
client-readable topic string is not a storage or permission boundary by itself.

## Fixed Process-Local Bounds

| Limit | Value |
| --- | --- |
| Topic/key/namespace length | 256 / 256 / 512 characters |
| JSON value | 65536 UTF-8 bytes |
| Subscribed topics per socket | 64 |
| Entries / bytes per actor | 256 / 8MiB |
| Entries / bytes per namespace | 1024 / 16MiB |
| Entries / bytes total | 4096 / 64MiB |

These include writes from an actor that has not subscribed. They bound retained
values, not every aspect of process RSS.

## Client Lifecycle

Observe stable ephemeral.error messages rather than assuming a send was
accepted. During authorization changes the SDK purges old values, stops writes
and reproves retained subscriptions in the new scope. Unsubscribe functions must
be called when UI leaves a topic.

There is no external multi-host pubsub guarantee. Replica SQLite polling does
not replicate this RAM-only store.

See [Rooms](../rooms/index.md), [frontend Rooms](../../frontend/rooms/index.md),
[durable state](./user-state.md), [client bindings](./clients.md) and
[configuration](./configuration.md).

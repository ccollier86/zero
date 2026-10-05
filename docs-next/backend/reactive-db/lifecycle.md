---
id: zero.reactive-db.lifecycle
type: operations
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: lifecycle
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-Bun, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Own The Instance And Its Diagnostics

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

Each ReactiveDB belongs to one concrete data plane. Fabric can own
many instances/actors; an ambient app-global raw handle is not a tenant-safe
selection mechanism.

## Ownership

Without injection, construction creates/starts a platform SQLite service and
the engine owns its close. An injected `sqlite` service remains caller-owned.
An injected raw Bun `database` defaults caller-owned unless ownsDatabase:true.

Injected raw handles require the caller to configure appropriate PRAGMAs and
persistence behavior. Managed createApp does not accept bypassing its SQL-service
ownership invariants with a raw system handle.

Constructor failure closes resources it owns, not an unrelated caller's service.

## Disposal

`dispose()` is synchronous and idempotent after success. It rejects disposal
inside a transaction/read snapshot or during change delivery. It seals mutation
interceptor registration, stops polling, finalizes statements, retires local
subscriptions/queues and closes only owned underlying resources.

If durability close fails after release, the instance stays sealed; a later
dispose retries underlying close without double-finalizing released statements.
Normal data methods cannot continue against that partially released instance.

Managed app services dispose through their owner. Extensions should unsubscribe
their own listeners, not independently close the shared framework data plane.

## Errors And Events

Invalid setup/constraints can throw ordinary engine Errors. The public API/domain
boundary must convert those into safe outcomes; raw SQLite/application messages
are not automatically client-safe.

Listener contract failures emit SYNC_CHANGE_LISTENER_FAILED without row payload,
identifiers or application exception text. afterCommit failures use
SYNC_POST_COMMIT_NOTIFICATION_FAILED and can carry a raw error to the configured
sink. Custom sink serialization/redaction remains its responsibility.

`emitCode` takes precedence over an injected observability runtime; direct
standalone construction otherwise retains the compatibility emitter. Prefer
app-local injection for multiple apps.

## Verify

Test injected ownership, partial construction failure, polling/subscription
retirement, failed close retry and prohibited disposal during active boundaries.
No lifecycle test should delete an existing application database.

## Related Guides And Next Steps

- [Runtime shutdown](../runtime/shutdown.md) drains dependants before providers.
- [Configuration](./configuration.md) lists ownership/diagnostic inputs.
- [Subscriptions](./subscriptions.md) owns listener cleanup.

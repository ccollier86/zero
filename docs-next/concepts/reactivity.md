---
id: zero.concepts.reactivity
type: architecture
audience: [developer, agent]
owner: sync
status: draft
visibility: internal
system: sync
feature: reactivity
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [full-sync, lazy-query, server, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# From A Commit To A Reactive UI

[Concepts index](./index.md) · [Documentation index](../index.md)

ReactiveDB records managed committed mutations. Sync carries authorized
snapshots/changes to clients. The browser SDK keeps reactive collections and
query results; hooks subscribe to those state slices so affected UI rerenders.
These are cooperating layers, not one unrestricted database subscription.

```text
managed database mutation + durable change record
                    │ commit
                    ▼
            ReactiveDB change delivery
                    │ scope/resource policy
                    ▼
              Sync / query updates
                    │ accepted client result
                    ▼
        reactive record cache + query membership
                    │ subscribed hooks/state slices
                    ▼
                affected UI
```

The browser state layer uses Zero's API/hooks over reactive stores, including
XState store integration. Apps normally consume the supported SDK hooks rather
than rebuilding that store or opening an independent unauthenticated socket.

## Commit Comes Before Publication

Managed row changes and their change-log records share a transaction.
Subscribers receive committed change data, not a successful-looking message
from a transaction that will later roll back. A rollback must not create a
durable event that clients treat as an accepted mutation.

Optimistic client writes can temporarily update local state before a receipt.
For a success toast, modal close or completed edit, await the acknowledged
mutation operation. That acknowledgment and optimistic rendering serve
different purposes.

## Full Collections And Queried Results

A full collection can filter, sort and paginate loaded rows locally. A lazy or
server-paginated query owns its accepted ordered result IDs separately from the
shared record cache. A row cached by another screen must not automatically
appear in this query's results.

For a server-driven table, controls describe a query to the source. The UI must
not apply a second browser filter or pagination pass to an already filtered
server page. Live changes can update visible records or trigger a scoped
refetch when membership/order needs reconsidering.

## Identity And Authorization Boundaries

Natural identity and primary keys identify records; Guardian/resource policy
decides who sees them. [Data placement](./data-planes.md) chooses a physical plane
from trusted authority before data operations and fanout. A tenant ID in an
untrusted subscription does not authorize a different database.

The SDK's authorization scope boundary protects cached state and callbacks.
Restoration/readiness, tenant switches, logout and revocation are not merely
changes to a badge in the header. Old rows and results must be cleared/fenced;
late requests must not replace newer accepted state.

## Server Participation

ReactiveDB also exposes local committed change subscriptions. Synchronous
transaction functions can derive changes while rollback is still possible;
durable database functions capture external work into an outbox for later
delivery. An ordinary after-commit callback is not a durable job queue.

Raw SQL that bypasses managed mutation operations is not automatically a
tracked change/trigger promise. Use the appropriate managed database/service
method when clients or downstream automations must observe the change.

Fabric preserves the change boundary per physical database. Independent files
can operate concurrently, while each database still has its own commit order
and cursor. A global client cache must not merge those domains just because
their row IDs match.

## Verification

Exercise two clients: an accepted change should reach the authorized subscriber;
a rejected/rolled-back mutation must not become accepted state. Then test a
query-membership change, superseded response, scope switch and live revocation.
One fast demonstration is not proof of every transport/profile combination.

## Related Guides And Next Steps

- [Service boundaries](./service-boundaries.md) places server authorization.
- [Data planes](./data-planes.md) distinguishes per-file ownership/order.
- [Natural identity](../backend/schema/natural-identity.md) defines record IDs,
  not permission or physical routing.
- [Codecs](../backend/schema/codecs.md) translates logical and wire values.

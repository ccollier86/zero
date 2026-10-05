---
id: zero.torrent.events
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: events
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Durable Events And Exact Run Delivery

[Torrent](./index.md) · [Interactions](./interactions.md) · [Documentation index](../../index.md)

A wait is durable server state, not a promise tied to a browser connection.
Events target one exact instanceId and event name. Incoming inputs can arrive
before that node starts waiting; the private inbox retains them until an
eligible frontier claims them.

## Ordinary Events

waitFor(id, eventName, { label?, timeoutMs?, inputSchema? }) creates a wait whose
accepted event payload becomes node output. A matching event must satisfy the
wait contract and live authority; another instance's identically named wait
does not share its inbox.

WorkflowService.sendEvent(...) persists the event then advances an eligible
running frontier; its boolean reports whether that event was claimed at that
time. false is not automatically delivery failure: an early/paused event may
remain durable for later admission. The browser useWorkflowActions sendEvent
and HTTP POST /:id/events expose that matched boolean.

Events may be stored while paused but cannot execute paused/cancelled handlers.
Terminal instances reject ordinary new events. Event delivery is not a bypass
for a requestAndWait responder policy.

## Trusted System Delivery

sendEventAsSystem(instanceId, eventName, payload, { principal, reason, scope? })
seals a trusted system responder but does not itself add permanent command
idempotency. For retryable transports use deliverEventAsSystem with the same
system fields plus idempotencyKey.

The public result is { eventId, instanceId, eventName, createdAt }.
It acknowledges durable event identity, not completed workflow execution.
A replay of the same principal/scope/key returns the original acknowledgement
and re-kicks a running frontier; it does not append another event.

The key is 1–128 characters matching alphanumeric first, then alphanumeric,
dot/underscore/colon/hyphen. Changing target, event, payload or provenance for
the same key produces WORKFLOW_EVENT_IDEMPOTENCY_CONFLICT, not redirect.

Only trusted server code may create a system principal. Its scope must come
from server-owned authority, not an untrusted organization selector. The
database-automation helper derives a scoped stable key:
[exact automation resume](../database-automations/torrent.md).

## Bounds And Privacy

Event names are at most 200 characters. Serialized payloads are at most 1 MiB.
Per-run pending inbox bounds are 1,000 events / 16 MiB; lifetime event bounds
are 10,000 / 64 MiB. These runtime accounting limits are not a public AppConfig
queue setter or a total process-memory limit.

Ordinary public HTTP/Sync event rows redact payloads for all workflow formats.
Private inbox payload/authority/receipts do not become frontend collections.
Do not place sensitive reply bodies in standard metrics/log metadata.

## Correlation Acceptance

Start three runs and associate three external request IDs with their exact run
IDs. Authenticate the webhook, resolve its server-owned record and send only
the associated event. Retry with a stable idempotency key and verify one event.
Test early delivery, paused delivery, wrong tenant/instance, invalid schema,
capacity rejection and authority changing before final commit.

Related: [HTTP](./http-api.md), [authority](./authority.md),
[lifecycle](./lifecycle.md), [retries/time](./retries-and-time.md).

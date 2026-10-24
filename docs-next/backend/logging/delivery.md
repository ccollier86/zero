---
id: zero.logging.delivery
type: architecture
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: managed-delivery-preview
maturity: preview
applies_to: ["Unreleased feature/core-logging source only"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Logging Delivery And Lifecycle

[Logging index](./index.md) · [Backend index](../index.md)

Managed startup opens and probes separate audit and operational files through
the fixed logging realm before publishing its private runtime. Fabric owns
per-file writer ordering and read-only WAL workers; the files use FULL SQLite
commit synchronization. Partial construction closes acquired writers/readers
and releases root ownership before returning an error.

## Diagnostic Capture

The app-local observability adapter snapshots a backend diagnostic before an
existing custom sink can mutate it. It retains event ID, code, severity, time
and category, with system/runtime attribution. Free-form messages, raw errors,
arbitrary metadata and untrusted frontend reports are not copied into the new
store. A confirmed diagnostic means the server emitted that event, not that an
action described in its text necessarily committed.

Each app lifetime has a distinct source identity, so restarting observability's
counter at `obs_1` does not collide with retained prior events. The log plane's
own database diagnostics use the pre-adapter sink, preventing log-of-log
recursion. Existing console/custom/recent-event behavior remains independent.

## Admission And Recovery

The private structured capture boundary detaches/freeze-validates attribution,
target and approved scalar metadata before any await. A returned receipt follows
the actor commit; a policy-filtered event returns no receipt. Outstanding event
and byte budgets include in-flight batches. Pressure rejects new admissions
rather than silently asserting successful retention.

Source/event identity survives regrouping and restart. Exact replay returns the
existing ordinal; conflicting content under that identity rejects the entire
batch. Unknown dispatched outcomes remain unknown, allowing a durable producer
to retry the exact original event identity. The batching owner itself is not a
durable originating outbox and does not automatically retry unknown writes.

Managed source capture supplies that separate durability boundary: small private
outboxes in the application and Guardian source databases join the originating
transaction. A rollback leaves neither the change nor its queued success event.
Those queues are delivery state, not the permanent logging store. They retain
stable source identities, exclude row bodies and keep exact events until the
dedicated log actor acknowledges a commit.

After-commit wakeups run outside the source transaction and authority lease.
Delivery submits bounded concurrent admissions so the log writer can batch them,
then acknowledges only confirmed records in a short source transaction.
Lost acknowledgments replay against permanent event proofs. An idle source is
not continuously polled. Outages retain source evidence and back off from one
to thirty seconds. Capture cannot silently return a successful application
commit when its required origin queue is full.

Operational forwarding remains best-effort. A delivery failure is reported to
the previous sink with a safe code, once per failure burst, without recursively
trying to persist that failure through the same store. Diagnostic loss cannot
block an application action. This differs deliberately from required source
capture, whose admission failure rolls back a captured mutation.

## Shutdown And Queries

App extensions drain while their services remain available. Logging then
detaches its adapter, closes new intake, joins admitted batches across both
streams, releases capabilities and closes the actor coordinator. Repeated close
calls join the same task. Failure in one batch does not skip remaining drains
or other owners' cleanup. No application authority lease is held while waiting
for logging IPC or disk synchronization.

Internal investigation reads use bound scope predicates and source-local
high-water/keyset pagination. New arrivals do not move an older page's boundary.
Store response validation checks retained envelope scope and cursor order.
The request, SSE and export facades derive and revalidate live Guardian
authority. The raw store and its platform query scope remain private.

## Related Guides And Next Steps

- [Configuration](./configuration.md) records the current exact limits and
  default-off behavior.
- [Server APIs](./api.md) describes authorized query/stream release.
- [Evidence lifecycle](./evidence.md) describes retained replay proofs after pruning.
- [Roadmap](./roadmap.md) tracks complete tenant/service capture and strict-profile gates.
- [Fabric consistency](../fabric/consistency.md) explains why ordinals from
  different physical databases do not form one global sequence.

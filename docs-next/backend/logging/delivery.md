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
  commit: "cc3b54383fc11497dda0b5c3a6cc04c09a936c8e"
  snapshot: dirty
  date: "2026-10-24"
  evidence_level: source-observed
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

Operational forwarding remains best-effort. A delivery failure is reported to
the previous sink with a safe code, once per failure burst, without recursively
trying to persist that failure through the same store. Diagnostic loss cannot
block an application action; this is not the future required-audit policy.

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
This does not authorize exposing raw store access: future request, stream and
export facades must derive and revalidate live Guardian authority.

## Related Guides And Next Steps

- [Configuration](./configuration.md) records the current exact limits and
  default-off behavior.
- [Roadmap](./roadmap.md) tracks atomic source capture, public scoped APIs,
  browser observations and evidence lifecycle controls.
- [Fabric consistency](../fabric/consistency.md) explains why ordinals from
  different physical databases do not form one global sequence.

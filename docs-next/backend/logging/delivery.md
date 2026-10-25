---
id: zero.logging.delivery
type: architecture
audience: [developer, agent, operator, maintainer]
owner: observability
status: draft
visibility: internal
system: logging
feature: managed-delivery-preview
maturity: preview
applies_to: ["Unreleased logging/AI completion branch based on 2.6.0"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "fc61dcc4cd107c6467bff498d3a772e8f5bdea9d"
  snapshot: dirty
  date: "2026-10-25"
  evidence_level: source-observed
---

# Logging Delivery And Lifecycle

[Logging index](./index.md) · [Backend index](../index.md)

Managed startup opens and probes separate audit and operational files through
the fixed logging realm before publishing its private runtime. Fabric owns
per-file writer ordering and read-only WAL workers; the files use FULL SQLite
commit synchronization. Partial construction closes acquired writers/readers
and releases root ownership before returning an error.

The delivery coordinator is also a dedicated subprocess. It owns event batching,
source fairness, retry timers and backlog draining; these loops do not run on
the application event loop. Database validation, hashing, event/proof writes,
retention and integrity operations execute in the separate Fabric actors.

| Owner | Work |
| --- | --- |
| Origin database | Small same-transaction metadata capture and durable source queue. |
| Application facade and private broker | Live authorization, bounded immutable admissions, source-catalog ownership, fixed source/sink capabilities, commit hints and worker supervision. |
| Delivery subprocess | Batching, up to three active source pages, fair draining, per-source retry backoff and source acknowledgment requests. |
| Fabric log writers and read-only WAL actors | Actual log commits, indexed bounded investigation queries, integrity work and retention. |
| Built-in custody owner | Parent-owned signing key; signed checkpoints commit in a third private Fabric file. No key is passed to child environment variables. |
| Private export pool | At most four materializations, each capped at 1000 records / 8 MiB; bounded serialization and Storage orchestration stay on the application side, while queries/transitions use the logging actors. |

The broker does not accept SQL, physical paths or user-selected scope from the
delivery process. Before removing a source entry, it requires an exact matching
committed sink receipt. Sink batches can contain only exact envelopes admitted
by the application or exposed by a registered source. At most three source
pages can hold these grants at once, even if a child violates its scheduler.

Investigation pages continue to use the log plane's read-only WAL workers;
opening a viewer does not move a full log scan onto the application database.
Response validation and transport remain bounded application work. Process
isolation does not remove shared CPU/disk contention or the cost of durable
source capture; qualify the application's actual read/write workload.
The export scheduler visits the entire bounded set of 128 live reservations;
repeated failure of older artifacts cannot starve later jobs.

Strict publication verifies that source capture, custody, private Storage exports
and delivery workers exist. Storage initializes before managed publication and
its startup/stop boundaries are idempotent, including failed app construction.
Source availability failure invalidates strict grants. Recovery requires a fresh
durable acknowledgment; restoring connectivity alone does not resurrect an old
grant.

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

The same contribution is installed locally in each managed tenant/named Fabric
writer. Request attribution travels through the private actor envelope and is
checked against the binding's immutable scope. It lasts for one synchronous
operation; unrelated work falls back to an honest system actor. Read-only
actors do not install mutation capture or accept source acknowledgments.

A private system-database catalog records a manager-proven source before its
file can be created. Startup recovery opens only existing cataloged files;
it never provisions missing tenant databases. Tenant scope must match the
manager's physical binding derivation. Changing the canonical Fabric root or
realm owner requires explicit recovery, not silent reassignment of queued data.
The source catalog is currently bounded to 10000 entries.

Source pages contain at most 256 events and 256 KiB of normalized envelope
data. Three source deliveries may progress independently, leaving room in the
default sink queue for other admissions. Per-source retry backoff prevents one
unavailable source from delaying otherwise-ready sources. Commit/startup hints
wake delivery; there is no continuous idle-source polling.

The private worker channel is nonce-fenced, bounds message size and outstanding
requests, and exposes only fixed operations. The child environment comes only
from the explicit actor allowlist, without parent/dotenv inheritance. The
delivery child starts in an owned empty directory,
including compiled deployments, and exits when its parent disconnects.

Worker death fails unresolved direct admissions with an unknown outcome; it
does not automatically repeat application actions. Origin queues remain intact.
The supervisor restarts the worker with bounded backoff and reconciles all
registered sources using their original event identities. A lost receipt or a
crash after sink commit but before source acknowledgment may replay safely.

Source storage shares repeated attribution between events, without changing
the public envelope or including row contents. Older full-envelope queue rows
remain readable without a destructive rewrite. Unreferenced attribution is
reclaimed with acknowledgment. Capacity accounting still uses full normalized
event bytes, not the smaller private encoding.

After-commit wakeups run outside the source transaction and authority lease.
Delivery submits bounded concurrent admissions so the log writer can batch them,
then acknowledges only confirmed records in a short source transaction.
Lost acknowledgments replay against permanent event proofs. An idle source is
not continuously polled. Outages retain source evidence and back off from one
to thirty seconds. Capture cannot silently return a successful application
commit when its required origin queue is full.

Hot source acknowledgments do not force a complete database image per page.
Their deletions are included in the next ordinary business/close snapshot.
After a crash an already-delivered event may replay; retained sink proofs
deduplicate it. Business-write snapshot guarantees are unchanged.

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
or other owners' cleanup. Source shutdown joins in-flight work, then spends up
to five seconds starting additional drain passes, with a finite pass cap.
Already-dispatched actor operations retain their own bounded deadlines; this
is not a five-second cancellation of an unresolved commit. Remaining source
evidence stays durable for restart. No application authority lease is held
while waiting for delivery IPC or logging disk synchronization.

Source capabilities stay alive until their admitted broker operations have
settled. The delivery process then drains admitted direct events and exits
before Fabric log owners close. An unresponsive child is terminated with
bounded escalation. This path must not silently switch to an in-app batching
or delivery loop.

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

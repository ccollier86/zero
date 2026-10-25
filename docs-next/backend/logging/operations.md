---
id: zero.logging.operations
type: operations
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: operations-and-upgrade
maturity: preview
applies_to: ["2.6.0 main builds containing the opt-in logging preview"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7f1383a7ea7483abab04d57aebbde8b0f9fe2d8d"
  snapshot: clean
  date: "2026-10-25"
  evidence_level: implementation-verified
---

# Logging Operations and Adoption

[Logging index](./index.md) · [Documentation index](../../index.md)

Logging is an opt-in preview in main's saved update package. Do not interpret
the unchanged framework version number as proof that an installed package
includes it: check the selected release commit and archive checksum. The
normal updater installs framework files, not application feature configuration.

## Readiness and Failure Signals

Use `client.logging.health()` under platform-administrator, application-control
and configured manage authority, and run the normal Zero
Doctor against the app's explicit configuration. Doctor shares path admission,
reports missing actors, auth-disabled API access, indefinite retention, declared
instrumentation gaps and weak hot-source durability. It neither starts log
workers nor deletes evidence, and it cannot certify legal compliance.

Source queue capacity defaults to 50000 events or 64 MiB per originating
database and is explicitly configurable through `logging.sourceQueue`.
A captured source transaction rejects when its durable queue cannot admit the
evidence. It must not return success while omitting required change evidence.
This can affect large bulk transactions; qualify import batch sizes explicitly.
Source discovery/reconciliation can temporarily make an exact pending-event
total unknown. `sourceDiscoveryPending` reports those sources separately; a
zero known-event count does not mean discovery has completed.

When the supervised delivery process is unavailable, authorized health reports
`state: 'recovering'` instead of a misleading ready state. Source delivery
failures include worker failures. Direct admissions can reject with
`LOGGING_NOT_READY`; unknown dispatched outcomes retain their original identity
for reconciliation. Durable source capture remains active during recovery and
can eventually apply backpressure at the configured origin budget.

Healthy source delivery wakes after commit rather than continuously polling an
idle database. It submits bounded batches and acknowledges only confirmed sink
commits. Outages use bounded retry backoff from one to thirty seconds and report
safe failure signals. A required source backlog can eventually stop further
captured mutations; investigate storage/worker availability rather than disabling
audit or wiping queues.

Operational diagnostics remain best effort and preserve the preexisting sink.
Do not treat their in-memory batching queue as an origin durability guarantee.
Source queues require durable originating databases for crash recovery;
ephemeral application/system DBs are intentionally not crash-persistent.

## Recovery and Shutdown

An unresolved dispatched outcome must be reconciled using the original
source/event identity. Never edit queued envelopes, reset source identities,
delete files, or clear replay proofs to make a health counter turn green.

On orderly stop, app-owned work drains before source capture detaches. Logging
joins in-flight transfers and bounded additional source-drain passes, then its
independent stream writers and Fabric owners. A large backlog or a sink outage
can leave source evidence for the next startup. In-flight work is not falsely
declared canceled; see [delivery deadlines](./delivery.md#shutdown-and-queries).
Capture installation and dependent database closure remain ordered;
an actor cleanup failure does not skip the other owners.

The private source catalog and per-source queues are required recovery state,
even though permanent audit storage is separate. Back them up alongside their
owning system/application/Fabric databases. Never copy a tenant file into a
different scope, reset source identities, or wipe the catalog to bypass a
binding mismatch. Replaying an unpersisted hot acknowledgment is safe; deleting
unacknowledged evidence is not.

Protect the complete logging directory with the same deployment custody,
backup and access controls required for its evidence. It must not overlap
application/control DB paths, public assets, application Fabric, generated
output or Zero Storage-owned paths. One process owns a root; this is not a
distributed multi-server logging cluster.

## Upgrade Procedure

1. Keep the app's current release pinned and back up its application, system,
   Storage and logging state through approved deployment procedures.
2. Create an application feature branch, inspect the saved main release, and
   apply the normal saved-package update. Record its commit and archive SHA-256.
3. Enable `logging` explicitly in a disposable preview first. Existing Guardian
   audit remains intact; no historical backfill or source-data deletion occurs.
4. Declare Guardian permissions and explicit semantic-read/raw/service capture.
   Review Doctor's actual coverage findings rather than hiding warnings.
5. Mount `LoggingWorkspace`, test ordinary users and investigators separately,
   then test tenant replacement/revocation and stream cancellation.
6. Verify rollback, source/sink restart and outages, source queue capacity,
   retention/holds, bounded exports and package actor launch for that app mode.
7. Review [remaining strict-profile gates](./roadmap.md) before making compliance
   claims or enabling any required-delivery workflow.

Do not remove older audit APIs, compatibility documentation or app theme files
as part of adopting logging. There is no migration that moves application
business records into the logging databases.

For managed archive apps using the installed workstation launchers:

```sh
zero-release --status
zero-update /path/to/example-app --dry-run
zero-update /path/to/example-app
```

`zero-release --status` must identify the intended main commit; it does not
refresh or publish a release. `zero-update` is the saved-archive launcher for
the same engine exposed by `zero update`. The package CLI's ordinary registry
mode does not install a locally saved archive; see the
[updater modes](../../cli/tooling/update.md) before mixing workflows.

After installation, add the `logging` configuration from the
[configuration guide](./configuration.md), declare the intended Guardian
permissions and mount [LoggingWorkspace](../../frontend/components/logging.md).
Rebuild/restart the app so managed workers and browser styles use the same
package. Source/compiled custom actor entries must call the public logging
bootstrap before ordinary app startup. Existing apps without logging enabled
do not acquire new log files or workers merely by updating.

## Verification

Focused regression suites cover real managed createApp, Guardian compatibility,
scoped query/stream release and revocation, outbox rollback/retry, physical
stream isolation, retained replay proofs, holds/review atomicity, browser signal
semantics and actual Chromium rendering. Installed-package smoke tests exercise
the packaged source actor, not just in-repository imports. See the sanitized
[branch review](../../_work/logging-foundation-review.md) for exact commands,
runs and known gates.

The compiled shared-entry regression builds a real Bun executable that launches
its dedicated log actors, commits an event, and is then killed with SIGKILL.
A replacement owner opens the same disposable files, verifies the hash chain
and confirms that exact event replay is a duplicate rather than another row.
This proves that tested owner-crash path; it does not establish arbitrary
custom launchers, every child-death timing, cross-platform behavior, storage
restore procedures or independent checkpoint custody.

Separate fault tests kill the delivery subprocess after a sink commit but
before the source acknowledgment, then verify automatic restart and deduplicated
reconciliation. Burst tests check batched delivery, bounded intake and
commit-before-ack. Adversarial protocol tests reject manufactured envelopes,
uncommitted acknowledgments and stale/nonmatching transport responses.

## Related Guides and Next Steps

- [Delivery](./delivery.md) explains physical worker ownership and source order.
- [Browser requirements](./browser.md) covers blocked delivery and strict gating.
- [Evidence lifecycle](./evidence.md) explains holds, retained proofs and exports.
- [Workspace manual](../../frontend/components/logging.md) covers UI adoption.

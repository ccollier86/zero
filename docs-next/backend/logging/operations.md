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
applies_to: ["Unreleased feature/core-logging source only"]
modes: [managed-server, browser, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Logging Operations and Branch Adoption

[Logging index](./index.md) · [Documentation index](../../index.md)

This implementation remains on `feature/core-logging`. Do not interpret the
unchanged framework version number as proof that an installed package includes
it. Main and the saved upgrade release are deliberately independent.

## Readiness and Failure Signals

Use `client.logging.health()` under log-read authority and run the normal Zero
Doctor against the app's explicit configuration. Doctor shares path admission,
reports missing actors, auth-disabled API access, indefinite retention, declared
instrumentation gaps and missing tenant-Fabric capture. It neither starts log
workers nor deletes evidence, and it cannot certify legal compliance.

Source queue capacity is 10000 events or 16 MiB per originating database.
A captured source transaction rejects when its durable queue cannot admit the
evidence. It must not return success while omitting required change evidence.
This can affect large bulk transactions; qualify import batch sizes explicitly.

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
drains its finite admitted backlog, then its independent stream writers and
Fabric owners. A sink outage may leave durably queued source evidence for the
next startup. Capture installation and dependent database closure remain ordered;
an actor cleanup failure does not skip the other owners.

Protect the complete logging directory with the same deployment custody,
backup and access controls required for its evidence. It must not overlap
application/control DB paths, public assets, application Fabric, generated
output or Zero Storage-owned paths. One process owns a root; this is not a
distributed multi-server logging cluster.

## Upgrade Procedure

1. Keep the app's current release pinned and back up its application, system,
   Storage and logging state through approved deployment procedures.
2. Create an application feature branch and install an archive built from the
   intended Zero feature commit. Record commit and archive SHA-256.
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

## Verification

Focused regression suites cover real managed createApp, Guardian compatibility,
scoped query/stream release and revocation, outbox rollback/retry, physical
stream isolation, retained replay proofs, holds/review atomicity, browser signal
semantics and actual Chromium rendering. Installed-package smoke tests exercise
the packaged source actor, not just in-repository imports. See the sanitized
[branch review](../../_work/logging-foundation-review.md) for exact commands,
runs and known gates.

## Related Guides and Next Steps

- [Delivery](./delivery.md) explains physical worker ownership and source order.
- [Browser requirements](./browser.md) covers blocked delivery and strict gating.
- [Evidence lifecycle](./evidence.md) explains holds, retained proofs and exports.
- [Workspace manual](../../frontend/components/logging.md) covers UI adoption.

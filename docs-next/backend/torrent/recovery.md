---
id: zero.torrent.recovery
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: recovery
maturity: supported
applies_to: ["2.4.2 source update; focused release checks recorded separately"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.4.2"
  commit: "5cf3009f63767c4052065aa211734f2ebffb2c9f"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Runtime Ownership, Restart And Stale-Attempt Fences

[Torrent](./index.md) · [Lifecycle](./lifecycle.md) · [Documentation index](../../index.md)

Durable state does not mean every process sharing SQLite may execute it.
One WorkflowService owns a lease generation for that workflow runtime.
A conflicting live owner fails; expired ownership must be replaced through
the fenced recovery path, not by running duplicate consumers.

## Lease Defaults

The inspected runtime owner lease defaults to 30 seconds with a 10-second
heartbeat. Owner identity/generation/expiry live in private system DB state.
Shutdown releases only the exact owned generation. Losing ownership withdraws
service publication/jobs and fences future work.

Lower-level WorkflowServiceOptions.runtimeOwnership exposes clock/timer/test
seams and policy options. These are not public AppWorkflowsConfig keys.
Disable heartbeats only for a deliberate deterministic crash simulation, not
an ordinary production scaling strategy.

## Startup Ordering

Managed startup completes Guardian readiness and workflow activity/definition
registration before recovery. Recovery preflights persisted nonterminal run
authority and exact registered code, normalizes crash-left work, prepares graph
state and publishes only after readiness. An empty handler registry must not
start historical runs.

recoverInFlight is initialization work, not a routine request that arbitrarily
reinitializes an already-active service. Existing immutable graph/run snapshots
and persisted memory limits remain authoritative after restart.

[Idempotent system starts](./system-starts.md) atomically retain creation receipts
with run/steps/authority/memory. Recovery validates nonterminal receipts before
advancing a start interrupted after commit. A repeated start returns the same
instance; it does not resolve the current definition head or reopen a terminal run.

## Attempts And Private State

Physical attempt tokens, lease generation, current run/step status and live
authority are checked before successful persistence. Late callbacks from an old
attempt/runtime cannot commit output/memory or recreate waiting state.
Retries use the same logical-step idempotencyKey with a new attemptId.

Stale private graph/edge/item/schema/accounting state fails closed.
Recovery is not a tool for repairing corrupt private rows by inventing missing
handler names or grants. Use backups and deliberate authorized reconciliation.

## Durable Does Not Mean Exactly Once

A remote request can succeed before local completion commits. After restart,
the recovered attempt may repeat it. Keep old exact activity versions and
provider/business idempotency. A local ownership lease does not make arbitrary
external networks transactional.

Code changes, definition activation, schema migrations and deployed package
updates are separate operations. Validate each without deleting current run
history to make startup easier.

## Verification And Integration

Use a fake clock to expire one owner while its handler is held. Open replacement
only through supported lease admission, release the old promise and verify no
late commit. Then qualify a packaged server restart with actual SQLite
persistence and retained old versions.

Read [operations](./operations.md), [definitions](./definitions.md),
[memory](./memory.md), [runtime lifecycle](../runtime/lifecycle.md) and
[ReactiveDB](../reactive-db/index.md).

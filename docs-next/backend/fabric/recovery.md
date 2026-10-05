---
id: zero.fabric.recovery
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: recovery
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Actor Recovery And Ordered Shutdown

[Fabric index](./index.md) · [Documentation index](../../index.md)

Fabric owns a child **generation**, not merely an IPC connection. A transport
disconnect does not prove that a process can no longer commit. Generation
retirement waits for exact exit/settlement evidence.

## Failure And Replacement

Startup has a bounded handshake timeout. Operation timeout or malformed IPC
fails the channel and rejects pending work with outcome-aware errors. Shutdown
first drains work, sends the cooperative IPC shutdown request and waits for
acknowledgment and process exit.

If cooperation fails, termination escalates SIGTERM then SIGKILL with bounded
deadlines. A generation with no observed exit remains quarantined, rather than
allowing an overlapping replacement writer to assume ownership.
An explicit later close can retry unsettled termination.

Replacement uses bounded exponential delay and a circuit breaker. Defaults:
`initialDelayMs: 10`, `maxDelayMs: 1000`, `circuitFailureThreshold: 5`,
`circuitCooldownMs: 5000`.
Threshold must be at least 2; initial delay may not exceed max; cooldown must
be at least max. Configuration admission rejects invalid timer ranges.

## Parent Lifecycle

Managed extension drains occur before dependent Guardian/Fabric services
disappear. Applications should await their owned runtime disposal, not
fire-and-forget actor close promises or indiscriminately signal child groups.

Default actors are detached from the parent's terminal signal group so parent
shutdown can coordinate IPC drain. Deployment service managers should target the
parent's lifecycle correctly; process-group details are not a backup policy.

Bundle launch-directory cleanup follows settlement, never premature recursive
deletion. Cleanup failure is safely classified and close rejects. See
[actor launch](./actors.md).

## Data Recovery

File WAL and hot recovery images have different durability boundaries.
Placement is pinned across replacement generations; a replacement cannot
silently turn a periodic hot image into file mode.

Use the same operation key to recover an
[uncertain write](./idempotency.md). Successful transport reconnection alone
does not prove a previously dispatched command failed or authorize replay.

See [persistence](../persistence/index.md),
[placement](./placement.md), [capacity](./capacity.md) and
[runtime shutdown](../runtime/shutdown.md).

---
id: zero.audit.trigger-production-update
type: operations
audience: [agent, maintainer]
owner: reactive-db
status: in-review
visibility: internal
---

# Array Policy And Trigger Production Update

[Audit ledger](./index.md) · [Documentation index](../../index.md)

This is focused evidence for the 2.4.2 update, not a whole-platform security
certification or documentation-site qualification. The isolated worktree
started at committed 2.4.1 `5cf3009f63767c4052065aa211734f2ebffb2c9f` and retains
that release's complete array-policy correction. The documentation website,
CodeBlock redesign and saved search follow-up remain separate work.

## Corrected Contracts

- Enabling triggers no longer limits unrelated origin transactions to 256
  tracked writes. Matched origins and all handler-generated tracked writes
  remain bounded. Function/effect/depth bounds and whole-root rollback remain.
- Durable `zero.torrent.start` derives one effect identity per outbox delivery
  and discriminator. `startAsSystemOnce` atomically commits run, initial steps,
  authority, memory and a permanent MAC-sealed system receipt. Retry/restart
  retains the original run and pinned definition; changed commands conflict.
- Ordinary app functions use a registered durable adapter and app-owned
  dispatcher, without Torrent or a duplicate Zero function registry. Captured
  parameter/version mapping, live scope, cancellation and destination
  idempotency are explicit.

Independent review reproduced and corrected three new start edge cases:
execution before an enclosing root transaction committed, command mutation by
a late trusted fence/listener, and unobserved rejected async-fence promises.
Nested async starts/replays now reject before mutation; pinned receipt
integrity is checked before execution; invalid native promises are consumed
without reading an authored `then` accessor. Recovery uses indexed live
instances and streamed receipt lookups rather than scanning permanent history.
Immutable parent protection and FK constraints prevent receipt orphaning.

## Focused Verification

- Main combined source gate: 172 tests, 1,223 assertions, zero failures across
  21 files. Includes automation runtime/actor budgets, host delivery, scoped
  services, generic Guardian/Fabric invocation, Torrent starts/events/memory/
  recovery, graph compatibility and inherited array Resource/Fabric/Sync behavior.
- Final frozen start/migration gate: 19 tests, 107 assertions, zero failures.
  Includes migration 038/runtime DDL parity and pinned migration immutability.
- Actual workflow/automation Markdown examples: one passing typecheck with
  22 assertions, including new start and generic function adapter declarations.
- Generic adapter's actual Markdown runtime/type checks and full managed E2E:
  eight passing focused regressions, 124 assertions.
- Full TypeScript check and whitespace/error checks pass. New documentation
  files have unique IDs, parent-index coverage, backlinks and valid targets.

Fresh consumer checks install a packed public package in disposable scratch
directories, then exercise Resource/Guardian/Fabric array policies and
triggered Torrent starts with a forced accepted-effect retry. They assert
packaged new guides and normal agent entrances. Both final consumer tests
passed, with seven test assertions plus the fixture's runtime assertions.
Release identity/archive
checksum is maintained by the normal `zero-release main` manifest; working
source evidence above does not invent an artifact SHA or widen support to
unverified mode combinations.

No live Pantheon database, framework installation, credentials, deployment or
application source was changed. All examples/providers use synthetic values.

## Reader Contracts

- [Array policy](../../backend/resources/array-overlap.md): exact matching,
  bounds, invalid retained data, scope changes and authorization enforcement.
- [Trigger budgets](../../backend/database-automations/transaction-functions.md):
  matched-origin versus generated-write accounting and rollback.
- [App functions](../../backend/database-automations/app-functions.md): exact
  target/parameters, scope, retry and cancellation responsibilities.
- [Automation Torrent bridge](../../backend/database-automations/torrent.md):
  source-bound starts and exact existing-run events.
- [System starts](../../backend/torrent/system-starts.md): public trusted API,
  permanent receipts, integrity, recovery and migration.

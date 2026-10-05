---
id: zero.database-automations.testing
type: how-to
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: testing
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["pinned application database", "Fabric realm database"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Test Database Automations Without Live Application Data

[Database automations](./index.md) · [Operations](./operations.md) · [Documentation index](../../index.md)

Test a synthetic physical source and fake external adapters before enabling
automations in an existing application. Do not prove correctness by mutating a
live organization or sending real provider traffic.

## Layered Acceptance

1. Pure authoring: duplicate identities, missing exact versions, update-column
   filters, manifest canonicalization and safe errors.
2. Same-commit execution: atomic rollup, chain/cascade order, synchronous-only
   handlers, retained closed capability, failure rollback and budgets.
3. Durable source: outbox commits with origin, limits reject origin atomically,
   lease transitions reject stale attempts, restart/retention accounting.
4. Host worker: exact version, lost renewal, retry/exhaustion, independent
   physical sources, controlled abort and safe telemetry.
5. Integration: authorized source selection, Guardian/Fabric fences, exact
   Torrent delivery and real deployment shutdown/restart.

Use controlled promise barriers and a manual clock rather than relying only on
OS scheduling to expose overlap. Capture external requests in a fake adapter,
then intentionally lose completion recording to test business idempotency.

## Existing Focused Checks

Run from the framework checkout; these selected suites use synthetic
definitions, ephemeral databases or fake delivery services:

```sh
bun --no-env-file test src/database-automations/database-definitions.test.ts src/database-automations/database-automations.test.ts src/database-automations/automation-error.test.ts
bun --no-env-file test src/database-automations/database-transaction-automation-runtime.test.ts src/database-automations/database-automation-delivery-worker.test.ts
bun --no-env-file test src/frontend/server/pinned-automation-identity-boundary.test.ts
```

For this audit the first command passed 11 tests/57 assertions, the second
14/62, and the pinned boundary check 4/28. Those are development source checks,
not an installed package, provider or deployed actor qualification.

The pinned boundary creates real ephemeral system/application runtimes,
declares field.guardianUser(), installs the managed projection and only then
registers the app FK table. It proves create/update/delete/nested-delete via
the automation capability cannot alter the unregistered anchor, and that
origin/canonical data remain unchanged. It does not fabricate a registration,
claim a generic raw-SQL fence or imply an authentication bypass.

## App-Level Example Acceptance

Create two synthetic organizations and runs. Store each run ID in its own
business record. Update one record through the normal authenticated API and
assert its rollup/live UI changes only in the expected scope. Deliver its
webhook twice, verifying one durable Torrent event and no change in the other
run. Revoke source authority at an await barrier and verify late service use/
terminal recording fail closed.

Then restart the actual packaged deployment with pending work and verify old
exact handler versions recover. Unit tests alone cannot establish package
exports, actor cwd/env isolation or external idempotency.

## No Bypass For Convenience

Do not use raw handles, untrusted tenant selectors, dummy platform permissions
or edited private outbox rows to make a test pass. A supported integration
should fail closed when its scope/storage prerequistes are absent.

Related: [services](./services-and-authority.md), [Torrent delivery](./torrent.md),
[versioning](./versioning.md), [runtime shutdown](../runtime/shutdown.md).

---
id: zero.database-automations.versioning
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: database-automations
feature: versioning
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

# Function Versions And Canonical Manifests

[Database automations](./index.md) · [Configuration](./configuration.md) · [Documentation index](../../index.md)

Function and trigger identities include explicit positive integer versions.
The automation manifest is handler-free and canonical; its fingerprint proves
declarative admission consistency, not equivalence of executable handler code.

## Manifest API

DATABASE_AUTOMATION_MANIFEST_VERSION is 1.
createDatabaseAutomationManifest({ functions, triggers }) creates the canonical
manifest/fingerprint boundary used by the registry. Entries contain names,
versions, identities, function modes, trigger tables/events/columns and ordered
target references. They contain no handler implementation or serialized closure.

Functions/triggers are canonically sorted by identity; normalized column lists
are stable. Trigger target run order remains meaningful.
fingerprint is sha256:<64 hexadecimal characters>, calculated with Bun's hasher.

A reordered registry can have the same declarative fingerprint. Managed
admission therefore also canonicalizes execution order. Bare public registry
listing/matching preserves its composition order; do not assume that order is
the installed managed trigger order.

## Upgrade A Durable Handler

1. Register a new function version for changed behavior.
2. Publish a new trigger version/reference selecting it for new mutations.
3. Keep old exact function definitions while old durable commands may remain.
4. Drain/reconcile backlog and verify live actor/realm fingerprints.
5. Remove old versions only when no retained work needs them.

A delivery stores its exact functionIdentity and source/manifest fingerprints.
Manifest drift is observable, but a still-registered exact durable version can
execute. Missing or non-durable target versions become terminal
AUTOMATION_FUNCTION_UNAVAILABLE; the dispatcher does not substitute latest.

Changing only a handler body without bumping a version is not detected by the
manifest fingerprint. Fabric realm executable behavior/version must also be
updated deliberately. Deployment artifacts must align parent and actor realm
modules; a source manifest hash alone does not prove that alignment.

## Data And Compatibility

Automation definition changes and app SQL schema migrations are separate.
Queued input snapshots reflect the prior data shape. Keep compatible old
handlers or deliberately reconcile affected business actions before removing
fields. There is no public automatic outbox replay/redrive/migration command.

No current-doc release guide is rewritten by this documentation draft.
Qualify the committed package and targeted restart/queue acceptance before
using it to upgrade an existing application.

Related: [validation](./validation.md), [delivery](./delivery.md),
[operations](./operations.md), [runtime shutdown](../runtime/shutdown.md).

---
id: zero.configuration.resolution
type: architecture
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: resolution
maturity: supported
applies_to: ["2.1.1 baseline with unreleased Schema corrections"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Resolution Is Not Service Readiness

[Configuration index](./index.md) · [Documentation index](../../index.md)

`resolveConfig(config, env?)` returns a `ResolvedConfig` before app
composition. It normalizes switches, table wrappers, modes, directories,
auth/navigation settings and cross-feature admission. It does not start the
listener, actors or provider requests.

## Read Stages

| Stage | Examples | What it proves |
| --- | --- | --- |
| module evaluation | app imports/config constants | trusted code ran; not safe static inspection |
| resolution | Guardian constraints, topology, paths, table modes | normalized/admitted declarations |
| service construction/startup | captured provider credentials, migrations, table counts, registries | concrete service readiness |
| request/commit | live credential/membership and policy fences | current authority for that operation |

Changing a process environment value after construction does not universally
reconfigure an existing provider. Recreate/restart according to the owning
service contract. There is no general persisted runtime settings table.

## Precedence Is Feature-Specific

Top-level explicit values usually replace their omitted defaults, but provider,
storage and feature resolvers own environment bindings. For example,
`ZERO_VECTOR_DATA_DIR` has precedence over vector config's data directory.
AI has its own environment/provider rules; email captures its configured
adapter credentials during runtime construction.

The optional `env` argument is forwarded to selected resolvers (AI, vector,
PDF and storage). It is not a sandbox for arbitrary imported app modules, nor
does it replace every later ambient environment read by service construction.

In corrected development source, table loading precedence is explicit
`syncDefaults.tables[name].mode`, then shared declaration intent, then the
global default. Raw `schema().serverTables` now retains declaration intent.
That correction is not asserted for the original published 2.1.1 artifact.

## What Changes During Startup

`declaredSyncModes` can include auto. Runtime row-count/tenant placement
resolution then fills full/lazy decisions and the related sets. The initially
empty `resolvedSyncModes` object is not a final browser snapshot.

Table wrappers are normalized to server SQL definitions and executable mutation
validators. Do not JSON-serialize a declaration or `ResolvedConfig` as an app
configuration clone: symbols, functions, Maps/Sets and services have deliberate
server semantics.

## Fail Closed, Not Partially Ready

Invalid combinations such as authless required Sync, stateSync without auth,
tenant-file isolation without multi-tenancy, or durable automations with an
ephemeral system plane reject before normal publication.

Domain errors retain their own contracts; some general config errors are
ordinary setup Errors, not HTTP responses. Do not display raw server
configuration or secrets while reporting admission failure.

## Related Guides And Next Steps

- [Feature switches](./feature-switches.md) lists supported forms.
- [Data access](./data-access.md) explains auto decisions and authority separately.
- [Lifecycle](../runtime/lifecycle.md) owns resource acquisition and failed startup cleanup.
- [AI configuration](../ai/configuration.md) owns AI environment precedence.

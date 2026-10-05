---
id: zero.reactive-db.configuration
type: reference
audience: [developer, agent, operator]
owner: reactive-db
status: draft
visibility: internal
system: reactive-db
feature: configuration
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-Bun, Fabric-actor]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# ReactiveDB Configuration

[ReactiveDB index](./index.md) · [Documentation index](../../index.md)

`ReactiveDBConfig` extends the platform's SQLiteStorageConfig. Import
it from `@zero/framework/sync`. These are server construction settings, not
editable client metadata.

## Engine-Specific Options

| Option | Omitted/default behavior | Contract |
| --- | --- | --- |
| sqlite | no injection | preferred platform SQL service; caller owns lifecycle |
| database | no injection | raw Bun Database; caller owns PRAGMAs and default close |
| ownsDatabase | false | close injected raw Database; ignored for sqlite |
| ringBufferDepth | 1000 | positive safe integer retained change budget |
| clearChangesOnStart | false | destructive stop-all history prune; cursor never reused |
| emitCode | no override | app-local event callback; highest diagnostic precedence |
| observability | no injection | event runtime; otherwise compatibility emitter |
| mode | persistence default hot | file/hot/ephemeral and legacy aliases/path compatibility |

`sqlite` wins over raw database injection in standalone construction.
`memory` and `:memory:` mean ephemeral, not durable RAM-active hot storage.
Do not confuse standalone injection support with managed createApp's stricter
ownership rules.

## Delegated Persistence

[SQLiteStorageConfig](../persistence/configuration.md) is the authoritative
reference for the inherited options; [storage modes](../persistence/modes.md)
explains their active/recovery boundaries.

Path/snapshot/durability tuning, PRAGMAs, statement cache and buffer-pool settings
belong to SQLiteStorageConfig. They are resolved when the service is constructed;
they do not give a browser user a database selector.

File mode uses SQLite file durability; hot mode is RAM-active with its
configured snapshot behavior; ephemeral is deliberately nonpersistent.
Fabric's actor placement has independent per-file/hot bounds and recovery.

## Interactions

The configured retention budget limits reconnect history, not table row count.
Auto-lazy table loading is an [app configuration rule](../configuration/data-access.md),
not ring-buffer sizing. Increasing retention does not restore already pruned
records.

Do not enable clearChangesOnStart to work around migration/auth issues. It is a
maintenance action requiring stopped competing writers and deliberate recovery
planning, not an action performed by this documentation rebuild.

External polling uses its own interval/gap options in
[replica delivery](./replica-delivery.md). No automatic environment binding is
introduced for these engine options; app modules may explicitly read trusted
server settings.

## Verification

Test engine option admission with synthetic config and disposable stores.
For injected ownership, explicitly assert that the caller's service stays open
after engine disposal. Never use a production database to validate a sample
construction path.

## Related Guides And Next Steps

- [Schema admission](./schema-admission.md) creates managed table definitions.
- [Change history](./change-history.md) explains retention and cursor gaps.
- [Lifecycle](./lifecycle.md) owns injected close semantics.
- [Data modes](../configuration/data-modes.md) composes system/app/Fabric storage.

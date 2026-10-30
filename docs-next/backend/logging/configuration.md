---
id: zero.logging.configuration
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: managed-configuration-preview
maturity: supported
applies_to: ["2.8.0 activity auditing replacement; verify the qualified release commit"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.7.0"
  commit: "06cd2719ddce6680480845ab46f88eec1b1e0c76"
  snapshot: clean
  date: "2026-10-29"
  evidence_level: implementation-verified
---

# Logging Configuration Preview

[Logging index](./index.md) · [Backend index](../index.md)

Use `createApp({ logging })`; no plugin installation is required. The existing
Guardian audit is preserved. The authenticated AppProvider collector follows
the configured browser families. Configuration is read at resolution/startup
and requires restart; there are no separate logging environment variables or
runtime database settings.

Configuration fragment using the normal server entry after updating Zero:

```ts
import { createApp } from '@zero/framework/server';

const app = await createApp({
  db: { mode: 'file', path: './data/application.db' },
  tables: {},
  logging: { rootDirectory: './data/zero.logs', minimumLevel: 'info' },
});
```

This opens dedicated storage, attaches backend diagnostics and installs the
configured managed source contributions, including managed tenant/named
Fabric ReactiveDB writers. It does not promise every raw SQL, semantic read
or external service outcome is automatically audited.
Managed logging implements `compliance` as a distinct strict policy, not
an alias for `detailed`. It requires managed Guardian, durable source commits,
signed checkpoints, protected delivery admission and private export storage.
Review [coverage](./events-and-coverage.md) for the operations an app must declare.
Use the final qualified archive identified in the release handoff and normal
updater status, not an older preview or intermediate source pack.

| Option | Default and behavior |
| --- | --- |
| `logging` | Omitted/`false`: no new files or workers. `true`: default policy/storage. Object: explicit policy/storage. `null` and unknown fields are invalid. |
| `logging.rootDirectory` | `data/zero.logs`, resolved from immutable `projectRoot`. Dedicated private Fabric ownership; never a browser value. |
| `logging.preset` | `basic`; alternatives `activity`, `detailed`, `compliance`. Strict startup verifies source durability and required owners; it does not silently downgrade on failure. |
| `logging.minimumLevel` | `info`; `debug`, `info`, `warn`, `error`, `fatal`. Filters diagnostics, not required audit events. |
| `logging.capture` | Granular boolean family overrides. Automatic Guardian/application capture and browser collection follow enabled families; uncovered services still require declared instrumentation. |
| `logging.resources` | Table labels and per-field `omit`, `redact`, or finite `{ values }` policies. Changes default to redaction; approved result values only use declared finite vocabularies. See [activity auditing](./activity-auditing.md). |
| `logging.pages` | Static registered route-pattern labels. Never actual dynamic URLs, IDs, query strings or fragments. |
| `logging.diagnostics.http` | `false`. Explicit technical successful HTTP capture; routine successful transport stages never become grouped user activities. Failures/interruption retain evidence without this opt-in. |
| `logging.browser.observationsPerMinute` | 2048 per current session/scope; integer 1–10000. Allows interval/change pairs and view heartbeats; independent from source queue/writer admission. |
| `logging.browser.selectionsPerMinute` | 512 opaque result selections per current session/scope; integer 1–10000. Separate from observation admission to prevent preparatory-work overload. |
| `logging.access` | Optional Guardian permission codes for `read`, `export`, `hold`, `review`, `manage`. Omitted codes require a platform administrator. Codes must already be declared in Guardian; export and review additionally require read. |
| `logging.metadataKeys` | Empty by default. Up to 32 explicitly approved scalar metadata keys for trusted `record()` calls. Secret/content keys remain prohibited. |
| `logging.retention.auditDays` | `null`: indefinite retention. Otherwise an integer 1–36500; explicit bounded pruning respects audit holds. |
| `logging.retention.operationalDays` | `null`: indefinite retention. Otherwise an integer 1–36500. Diagnostic retention is not compliance audit policy. |
| `logging.queue.maxEvents` | 1024 outstanding events per stream, including in-flight work; integer 1–100000. |
| `logging.queue.maxBytes` | 8 MiB event-payload budget per stream; integer 16384–67108864. This is not a total JavaScript heap bound. |
| `logging.queue.batchSize` | `min(256, maxEvents)`; integer 1–`min(256, maxEvents)`. The unchanged 512 KiB actor-batch byte limit can split it further. Sparse events flush on a microtask without waiting to fill a batch. |
| `logging.sourceQueue.maxEvents` | 50000 admitted events per originating database; integer 1–100000. Independent of the in-memory writer queue. |
| `logging.sourceQueue.maxBytes` | 64 MiB per originating database; integer 16384–268435456. Counts normalized event bytes, not an exact SQLite file or heap size. |
| `logging.actors` | Default packaged source entry and empty child environment. The validated launch also starts the dedicated delivery subprocess through a distinct private marker. Explicit `launch`, `env` and `executor` configure the Fabric actors; delivery IPC has its own bounded deadlines. Nothing implicitly inherits the parent's secrets or dotenv files. |
| `logging.custody` | Omitted on lower presets: no signing identity or checkpoint database. Omitted on `compliance`: built-in private Fabric checkpoint ledger and parent-owned signing identity (`{ kind: 'local' }`). An external service is not required. Explicit custom `LoggingCustodyConfig` selects an operator-supplied signer/store instead. |
| `logging.custody.adoptExisting` | `false`. An existing unsigned trail requires explicit, verified adoption. This is not permission to regenerate missing keys, rewrite signed history or accept a conflicting checkpoint. |
| `logging.custody.maxAdoptionProofs` | 100000; integer 100–10000000. Maximum existing unsigned proof count admitted for the one-time adoption scan. |
| `logging.custody.maxVerificationProofs` | 1000000; integer 100–10000000. Full startup verification scans bounded 100-proof pages before publication. Exceeding the declared proof budget fails closed; it never skips old pages and calls the trail verified. |
| `logging.custody.keyId` | Local owner only. Omission preserves the existing generated key. Setting a new stable opaque ID rotates the private key at restart and retains previous public keys. IDs cannot be reused; the built-in ring retains at most 32 keys and rejects rotation beyond that bound. |

## Self contained signing and checkpoints

This optional fragment enables built-in custody without another account:

```ts
logging: {
  preset: 'activity',
  custody: { kind: 'local' },
}
```

The first startup generates an Ed25519 signing identity in the private logging
root's `identity/signing.json` with file mode 0600. The private key never enters
Fabric actor payloads, browser configuration or logging events. The separate
`logging:checkpoints` Fabric database retains signed checkpoint versions through
append-only commands. The root remains exclusively owned by the normal Fabric
coordinator; no second service or network listener is introduced.

To rotate, set a new stable `keyId`, restart, verify readiness, and keep that ID
in configuration. Earlier public verification keys remain in the identity file;
their private counterparts are not needed to verify older checkpoints. A missing
identity or established checkpoint database requires recovery of the original
state, not automatic key generation. Preserve the complete private directory
through existing deployment backup procedures. Zero's own nightly-backup and
older-log archive/import services are deferred, not prerequisites supplied by
this change.

Local custody detects event-database rollback and verified history changes while
the corresponding checkpoint/identity state survives. It is not an off-host
write-once service and does not promise detection if an attacker replaces all
local evidence and trusted state together. A configured independent custodian
can provide a separate security/failure domain. Its deployment guarantees must
be established by the operator, not inferred from the adapter's name.

## Capture and delivery policy

`basic` enables operational/security families. `activity` additionally enables
records, transfers, workflow, communications, AI, investigations, navigation and
owned record/list viewing. `compliance` includes those viewing facts but does
not implicitly enable copy/print collection. `detailed` enables every family,
including browser views/copy/print. Explicit `capture.views: false` remains an
override. The managed collector has no generic page-duration heartbeat. Granular
overrides remain available. They do not implement uncovered instrumentation.

Required browser-delivery enforcement is reserved for the explicit strict
compliance profile. Enabling more optional capture in `basic`, `activity` or
`detailed` must not lock users out when a browser upload fails. The preview
reports delivery failures; it does not silently promote those presets to strict
mode. See [required delivery](./browser.md#strict-compliance-delivery-requirement)
for fail-closed enforcement and recovery boundaries.

## Strict source durability

The supported strict managed configuration uses **file mode with `FULL` or
`EXTRA` synchronization for both `db` and `systemDb`**. Set this explicitly;
ordinary file mode defaults to `NORMAL`. Hot/ephemeral control sources are
rejected before managed files are opened. This is not a tenant-mode change:
the application can remain single-tenant with separate application, system
and private logging files.

```ts
const app = await createApp({
  db: { mode: 'file', path: './data/application.db', synchronous: 'FULL' },
  systemDb: { mode: 'file', path: './data/zero.system.db', synchronous: 'FULL' },
  tables,
  auth: authConfig,
  logging: {
    preset: 'compliance',
    rootDirectory: './data/zero.logs',
    metadataKeys: ['operation', 'documentKind', 'rowCount'],
    retention: { auditDays: null, operationalDays: null },
  },
});
```

Actor-backed application Fabric files additionally require `sqlite.synchronous`
of `FULL`/`EXTRA`. Any configured hot placement must use `durability: 'on-write'`,
not periodic/final snapshots. These requirements do not alter the source files'
identities, copy application tables into logging, or serialize unrelated
databases. A source which cannot be recovered remains visibly unavailable;
it is not silently reported as an empty, fully delivered queue.

Explicit `read()` admission, investigation-access windows, hold changes and
review changes retain their required evidence even if optional family capture
is reduced. Ordinary `record()` calls still return null when filtered. Events
from managed source/scoped integrations carry a fingerprint of their resolved
capture/metadata/retention policy; queued events retain the policy under which
they were originally admitted.

Source queue settings are server-only, detached at startup and included in
that policy fingerprint. Lowering a budget does not delete previously admitted
evidence or prevent its delivery; it can block new captured mutations until the
backlog drops below the new limit. Size bulk transactions explicitly. A queue
capacity failure rolls back the source change rather than silently losing audit.

Actor-local capture is installed before managed Fabric admission. The child
must prove that it installed the supplied audit policy before its binding is
published. Use actors built with the matching Zero source; an older/custom
actor cannot silently ignore the new bind policy. Crash guarantees for the
source follow its placement and durability: use file/FULL or hot on-write for
required crash-persistent evidence. The dedicated log sink remains file/FULL.

The default actor is a private package source file run through Bun with
`--no-env-file`. A missing source actor fails startup with a safe configuration
error. Shared-entry/compiled deployments can call the public
`runLoggingActorIfRequested()` from `@zero/framework/logging/actor` before app startup and point `logging.actors.launch`
at that entry. The helper handles both the delivery process and fixed-realm
database actors with distinct private markers; never boot the app in either
child. A custom entry that handles only the older database marker is no longer
sufficient. The owner and actors must use matching
realm/build fingerprints; do not weaken the check to mix separately built
implementations. The shared-entry pattern is:

Invoke the helper before yielding to ordinary startup or asynchronous diagnostic
work. An instrumentation probe must not delay installing the private IPC owner.
Keep the actor entry minimal; import/start the application only when the helper
reports that this is not an actor invocation.

```ts
import { runLoggingActorIfRequested } from '@zero/framework/logging/actor';

if (!await runLoggingActorIfRequested()) {
  const { createApp } = await import('@zero/framework/server');
  const app = await createApp({
    db: { mode: 'file', path: './data/application.db' },
    tables: {},
    logging: {
      actors: {
        launch: { kind: 'bundle', entrypoint: process.execPath },
        env: {},
      },
    },
  });
  app.listen(3000);
}
```

This example is for a compiled Bun executable, not a source invocation where
`process.execPath` names the Bun runtime. Source apps normally retain the
default packaged actor. Logging always uses the dedicated delivery process;
there is no same-process performance fallback. Installed source launch and
compiled shared-entry owner-SIGKILL recovery have focused tests; arbitrary wrappers, other target
platforms and complete compliance release readiness remain separate gates.

Budget memory and process supervision for the delivery child as well as the
Fabric writers/readers. The worker channel is private parent/child IPC, not a
new network listener. Host CPU, memory and disk isolation remain deployment
responsibilities when one workload must have a hard resource reservation.

Paths are checked lexically during configuration and through filesystem aliases
before builds/startup mutate their owners. The log directory cannot overlap
application/control files, application Fabric, public build output, generated
artifacts or app routes. Storage-owned root/tmp/blob areas are protected too.
The coordinator then takes the normal exclusive Fabric root ownership claim.
Do not reuse this directory as an archive/export/public asset directory.

When `observability: false` or its runtime is disabled, backend diagnostic
forwarding stays disabled even if logging storage is opened. Existing
observability sinks/endpoints retain their configuration. The new authorized
logging API is separate from the existing recent-event endpoint.

## Related Guides And Next Steps

- [Delivery](./delivery.md) explains policy-filtered versus committed receipts,
  best-effort diagnostic failures and ownership drain.
- [Roadmap](./roadmap.md) separates optional UI, additional deployment targets
  and deferred backups from current strict controls and explicit app capture.
- [Fabric configuration](../fabric/configuration.md) covers explicit actor
  launch and the underlying private database ownership model.

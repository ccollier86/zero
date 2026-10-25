---
id: zero.logging.configuration
type: reference
audience: [developer, agent, operator, maintainer]
owner: observability
status: in-review
visibility: internal
system: logging
feature: managed-configuration-preview
maturity: preview
applies_to: ["2.6.0 main builds containing the opt-in logging preview"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "7f1383a7ea7483abab04d57aebbde8b0f9fe2d8d"
  snapshot: clean
  date: "2026-10-25"
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
Selecting `compliance` fails with `LOGGING_NOT_READY` until its complete required
controls are implemented and qualified. Review [coverage](./events-and-coverage.md).

| Option | Default and behavior |
| --- | --- |
| `logging` | Omitted/`false`: no new files or workers. `true`: default policy/storage. Object: explicit policy/storage. `null` and unknown fields are invalid. |
| `logging.rootDirectory` | `data/zero.logs`, resolved from immutable `projectRoot`. Dedicated private Fabric ownership; never a browser value. |
| `logging.preset` | `basic`; policy vocabulary also includes `activity` and `detailed`. Compliance is reserved and rejected by managed startup. |
| `logging.minimumLevel` | `info`; `debug`, `info`, `warn`, `error`, `fatal`. Filters diagnostics, not required audit events. |
| `logging.capture` | Granular boolean family overrides. Automatic Guardian/application capture and browser collection follow enabled families; uncovered services still require declared instrumentation. |
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

`basic` enables operational/security families. `activity` additionally enables
records, transfers, workflow, communications, AI, investigations and navigation.
`detailed` enables every family, including browser views/copy/print. Granular
overrides remain available. They do not implement uncovered instrumentation.

Required browser-delivery enforcement is reserved for the explicit strict
compliance profile. Enabling more optional capture in `basic`, `activity` or
`detailed` must not lock users out when a browser upload fails. The preview
reports delivery failures; it does not silently promote those presets to strict
mode. See [required delivery](./browser.md#strict-compliance-delivery-requirement)
for the planned fail-closed enforcement and recovery boundaries.

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
`runLoggingActorIfRequested()` before app startup and point `logging.actors.launch`
at that entry. The helper handles both the delivery process and fixed-realm
database actors with distinct private markers; never boot the app in either
child. A custom entry that handles only the older database marker is no longer
sufficient. The owner and actors must use matching
realm/build fingerprints; do not weaken the check to mix separately built
implementations. The shared-entry pattern is:

```ts
import { createApp, runLoggingActorIfRequested } from '@zero/framework/server';

if (!await runLoggingActorIfRequested()) {
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
- [Roadmap](./roadmap.md) identifies remaining service-stage instrumentation,
  strict browser admission and compliance qualification work.
- [Fabric configuration](../fabric/configuration.md) covers explicit actor
  launch and the underlying private database ownership model.

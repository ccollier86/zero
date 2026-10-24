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
applies_to: ["Unreleased feature/core-logging source only"]
modes: [managed-server, Fabric, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "af5554b750affc48645889debf3680bee29c2ef5"
  snapshot: clean
  date: "2026-10-24"
  evidence_level: implementation-verified
---

# Logging Configuration Preview

[Logging index](./index.md) · [Backend index](../index.md)

Use `createApp({ logging })`; no plugin installation is required. The existing
Guardian audit is preserved. The authenticated AppProvider collector follows
the configured browser families. Configuration is read at resolution/startup
and requires restart; there are no separate logging environment variables or
runtime database settings.

Branch-only fragment using the normal server entry:

```ts
import { createApp } from '@zero/framework/server';

const app = await createApp({
  db: { mode: 'file', path: './data/application.db' },
  tables: {},
  logging: { rootDirectory: './data/zero.logs', minimumLevel: 'info' },
});
```

This opens dedicated storage, attaches backend diagnostics and installs the
configured managed source contributions. It does not promise every raw SQL,
semantic read or independent tenant-actor action is automatically audited.
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
| `logging.queue.batchSize` | `min(64, maxEvents)`; integer 1–`min(100, maxEvents)`. The 512 KiB actor-batch limit can split it further. |
| `logging.actors` | Default packaged source actor with empty child environment. Explicit `launch`, `env` and `executor` use Fabric's validated subprocess contract. Nothing implicitly inherits the parent's secrets or dotenv files. |

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

The default actor is a private package source file run through Bun with
`--no-env-file`. A missing source actor fails startup with a safe configuration
error. Shared-entry/compiled deployments can call the public
`runLoggingActorIfRequested()` before app startup and point `logging.actors.launch`
at that entry. This uses a separate private logging marker and fixed realm;
never boot the app in an actor child. Installed source launch is qualified;
compiled/custom deployment qualification remains a separate release gate.

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
- [Roadmap](./roadmap.md) identifies remaining independent-actor capture,
  strict browser admission and compliance qualification work.
- [Fabric configuration](../fabric/configuration.md) covers explicit actor
  launch and the underlying private database ownership model.

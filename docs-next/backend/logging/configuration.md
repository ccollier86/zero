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
  commit: "cc3b54383fc11497dda0b5c3a6cc04c09a936c8e"
  snapshot: dirty
  date: "2026-10-24"
  evidence_level: source-observed
---

# Logging Configuration Preview

[Logging index](./index.md) · [Backend index](../index.md)

The branch adds `createApp({ logging })`. It does not install a plugin, change
existing Guardian audit or enable browser collection. Configuration is read at
resolution/startup and requires restart; there are no logging environment
variables or runtime database settings in this milestone.

Branch-only fragment using the normal server entry:

```ts
import { createApp } from '@zero/framework/server';

const app = await createApp({
  db: { mode: 'file', path: './data/application.db' },
  tables: {},
  logging: { rootDirectory: './data/zero.logs', minimumLevel: 'info' },
});
```

This opens dedicated storage and attaches backend diagnostics. It does not
promise that every record read/write or user action is automatically audited.
The broader presets are capture-policy groundwork, not completed end-to-end
coverage. Selecting `compliance` fails with `LOGGING_NOT_READY` until its required
controls are implemented and qualified.

| Option | Default and behavior |
| --- | --- |
| `logging` | Omitted/`false`: no new files or workers. `true`: default policy/storage. Object: explicit policy/storage. `null` and unknown fields are invalid. |
| `logging.rootDirectory` | `data/zero.logs`, resolved from immutable `projectRoot`. Dedicated private Fabric ownership; never a browser value. |
| `logging.preset` | `basic`; policy vocabulary also includes `activity` and `detailed`. Compliance is reserved and rejected by managed startup. |
| `logging.minimumLevel` | `info`; `debug`, `info`, `warn`, `error`, `fatal`. Filters diagnostics, not required audit events. |
| `logging.capture` | Granular boolean family overrides. Only `operational` is automatically connected in this milestone. Other families do not activate unavailable instrumentation. |
| `logging.queue.maxEvents` | 1024 outstanding events per stream, including in-flight work; integer 1–100000. |
| `logging.queue.maxBytes` | 8 MiB event-payload budget per stream; integer 16384–67108864. This is not a total JavaScript heap bound. |
| `logging.queue.batchSize` | `min(64, maxEvents)`; integer 1–`min(100, maxEvents)`. The 512 KiB actor-batch limit can split it further. |
| `logging.actors` | Default packaged source actor with empty child environment. Explicit `launch`, `env` and `executor` use Fabric's validated subprocess contract. Nothing implicitly inherits the parent's secrets or dotenv files. |

The default actor is a private package source file run through Bun with
`--no-env-file`. A missing source actor fails startup with a safe configuration
error. Compiled/custom launches must package the correct logging realm and
protocol explicitly; compiled deployment qualification remains a release gate,
not a reason to import private logging implementation modules into normal apps.

Paths are checked lexically during configuration and through filesystem aliases
before builds/startup mutate their owners. The log directory cannot overlap
application/control files, application Fabric, public build output, generated
artifacts or app routes. Storage-owned root/tmp/blob areas are protected too.
The coordinator then takes the normal exclusive Fabric root ownership claim.
Do not reuse this directory as an archive/export/public asset directory.

When `observability: false` or its runtime is disabled, backend diagnostic
forwarding stays disabled even if logging storage is opened. Existing
observability sinks/endpoints retain their configuration; a future logging
query API is not provided by that existing recent-event endpoint.

## Related Guides And Next Steps

- [Delivery](./delivery.md) explains policy-filtered versus committed receipts,
  best-effort diagnostic failures and ownership drain.
- [Roadmap](./roadmap.md) distinguishes this preview from automatic activity
  capture, client event collection and compliance readiness.
- [Fabric configuration](../fabric/configuration.md) covers explicit actor
  launch and the underlying private database ownership model.

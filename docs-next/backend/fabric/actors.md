---
id: zero.fabric.actors
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: actors
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

# Launch And Package Database Actors

[Fabric index](./index.md) · [Documentation index](../../index.md)

Fabric uses direct Bun subprocesses with bounded IPC, not Bun worker threads.
Each actor imports the same admitted realm locally. Only canonical operation
input/results cross the boundary; closures, database handles and credentials
are not serialized as operation arguments.

## Same-Entry Bootstrap

This entry fragment assumes `appRealm` is imported from a side-effect-free realm
module and `startApplication` is the app's ordinary startup function:

```ts
import { runDatabaseActorIfRequested } from '@zero/framework/server';

if (!await runDatabaseActorIfRequested({ realm: appRealm })) {
  await startApplication();
}
```

Place the private actor check before ordinary server composition, listeners,
bootstrap or external adapter startup. The actor suffix is an exact private
marker, role and canonical slot. A direct actor invocation without parent IPC
fails closed.

## Launch Modes

- `source`: absolute source entrypoint (or file URL), through the current Bun or
  explicit absolute runtime executable. The corrected launcher adds
  `--no-env-file` so cwd dotenv files do not bypass the child environment allowlist.
- `bundle`: directly executable compiled Bun application. The corrected factory
  starts it in an owned empty private working directory, because a runtime
  `--no-env-file` argument does not disable compiled Bun's implicit dotenv loading.
- `command-prefix`: trusted absolute executable plus fixed argv for a reviewed
  custom launcher. Zero appends the private suffix; it does not invoke a shell.
  The wrapper owns its runtime configuration/cwd behavior and must preserve the
  explicit credential boundary.

`actors.env` is the complete explicit allowlist, default empty. Include only
actor-required values; do not copy `process.env` wholesale. Paths passed through
config/binding are absolute; bundle-local handler code must not rely on the
parent app's cwd for relative assets.

## Build And Cleanup

Compiled Bun also supports build-time
[`--no-compile-autoload-dotenv` and `--no-compile-autoload-bunfig`](https://bun.com/docs/bundler/executables).
Use them in reviewed deployment builds as defense in depth. Packaging must
include the realm and compatible Bun/SQLite runtime, not just the parent router.

The bundle launch directory is released only after the exact process is settled,
or spawning failed. Cleanup never recursively deletes actor-created files;
failure is safely classified and close rejects rather than pretending cleanup
succeeded. A process that has not exited remains quarantined.

The source and compiled corrections here are unreleased development changes.
They have focused synthetic launch regressions, not certification of an app's
deployment artifact. See [recovery](./recovery.md) and
[diagnostics](./operations-diagnostics.md).

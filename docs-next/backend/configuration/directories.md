---
id: zero.configuration.directories
type: reference
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: directories
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Directories, Build Output And Listening

[Configuration index](./index.md) · [Documentation index](../../index.md)

Directories select trusted source/artifact locations. They are not an
untrusted import API or tenant-controlled storage path.

| Option | Default |
| --- | --- |
| `appDir` | ./app |
| `outDir` | ./.build |
| `generatedDir` | ./.zero/generated |
| `serverPluginsDir` | ./server/plugins |
| `serverMiddlewareDir` | ./server/middleware |
| `serverEndpointsDir` | ./server/endpoints |
| `serverRoutesDir` | ./server/routes |
| `serverResourcesDir` | ./server/resources |
| `storageDir` | .storage |
| `port` | 3000 |

The five server discovery paths accept false to disable their corresponding
discovery. App/build/generated paths do not have that same typed false form.

## Discovery And Evaluation

[Runtime discovery](../runtime/discovery.md) owns export/file conventions and
deterministic ordering. It imports trusted app modules; source import can
execute arbitrary app code. Store side-effect-free declarations where practical
and put managed startup/cleanup in appropriate plugins/services.

Resource discovery also feeds Doctor's trusted config checks. Disabling a
directory does not remove explicitly supplied declarations from other config.

## Build Versus Runtime Data

Client bundles/styles are rebuildable output. Application/system/Fabric files
and storage objects are runtime data. Do not recursively clean a shared parent
directory on the assumption that every child is a build artifact.

Multiple-database root isolation is checked against build/storage/control
database owned paths and canonical aliases before opening. Use dedicated roots;
a symlink should not turn a “different” configured path into shared ownership.

## Listening And Headless Use

`createApp` composes; the entry point still calls `listen`. `port` resolves
a default but does not start a listener by itself.

There is no dedicated `serverOnly:true` scaffold/config switch in this inspected
release. Backend routes can be used without authoring a React page, but do not
invent a headless bootstrap mode or claim frontend asset steps disappeared.
Server-only scaffolding remains a separately labeled roadmap item.

## Verification

Use disposable paths to test discovery off/on, absent directories and invalid
exports. Typecheck/listen wiring separately from import behavior. Build examples
must not execute live project hooks or delete existing runtime data.

## Related Guides And Next Steps

- [Declaration](./declaration.md) shows a small explicit listener entry.
- [Discovery](../runtime/discovery.md) lists accepted module forms.
- [Data modes](./data-modes.md) explains protected database ownership.
- [Roadmap](./roadmap.md) separates future headless ergonomics from current APIs.

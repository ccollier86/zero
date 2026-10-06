---
id: zero.cli.tooling.scaffolding
type: reference
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: scaffolding
maturity: supported
applies_to: ["2.5.0 development source; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local development"]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Generated Application Files

[Tooling index](./index.md) · [Documentation index](../../index.md)

The starter copies the package-mode template, excluding its README and .git,
then writes an application manifest, tsconfig, gitignore and README. Generated
code imports `@zero/framework`; it is not a nested framework checkout.

The scaffold ensures app-owned `components/`, `hooks/`, `lib/` and
`server/{plugins,middleware,endpoints,routes,resources}/` directories.
It normalizes a supplied package name or the target basename. Application
version starts at 0.1.0, private=true, type=module.

## Generated Commands

| Script | Purpose / side effects |
| --- | --- |
| dev | Bun watches app/server.ts; starting the configured app owns runtime initialization |
| start | Bun runs app/server.ts |
| build | zero build --config ./zero.config.ts --entry ./app/server.ts --outdir ./dist; prepares declared plugin content/assets and bundles the original entry |
| typecheck | tsc --noEmit; inspect project configuration/plugins before execution |
| doctor | zero doctor --config ./zero.config.ts; trusted imports and infrastructure reads |
| migrate / migrate:status | explicitly target ./data/zero.system.db |
| migrate:plan | schema ./db/schema.ts plus explicit ./data/app.db |
| pdf:install / pdf:status | managed browser download / inspection |

A build is not a complete deployment recipe or a universal compiled
single-binary file-router distribution. Optional docs/plugin-only no-source
deployment is qualified separately; ordinary apps with file pages retain their
source-deployment convention. See [build](./build.md#deployment-boundaries).
The starter's React/Bun/Elysia dependencies
and package-provided frontend composition remain separate from app business
code. tsconfig uses strict typing, bundler module resolution and react-jsx,
with aliases for app-owned files and explicit React type resolution.

## Customization Boundary

`scaffoldZeroApp` is an internal source engine behind the CLI, not a public
package subpath API to import into normal apps. Its staged preparation is used
by create/saved launchers. After scaffolding, developers own generated files:
a [package update](./update.md) does not regenerate their config, routes, UI,
gitignore or README.

The new 2.5.0 scaffold build script is not retroactively installed into an older
app. Update that app-owned script when adding required native plugin content;
a bare Bun server bundle does not execute the content-preparation lifecycle.

Review [runtime composition](../../backend/runtime/index.md) and
[configuration resolution](../../backend/configuration/resolution.md) before
changing startup settings. Use [source copy](./source-copy.md) only for components
that genuinely require app-owned customization.

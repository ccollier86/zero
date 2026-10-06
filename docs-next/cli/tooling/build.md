---
id: zero.cli.tooling.build
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: draft
visibility: internal
system: cli-tooling
feature: build
maturity: supported
applies_to: ["2.5.0 development source; publication qualification pending"]
modes: ["Bun package-mode applications", "trusted local builds"]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Build The Existing App Entry

[Tooling index](./index.md) · [Documentation index](../../index.md)

`zero build` prepares declared plugin content/assets, then bundles the existing
application server entry. It preserves that entry's custom routes, hooks and
listening behavior rather than substituting a generic `createApp` launcher.
The selected config's named exports remain available.

```sh
# From the installed application root:
zero build --config ./zero.config.ts --entry ./app/server.ts --outdir ./dist
bun ./dist/server.js
```

New [scaffolds](./scaffolding.md) use this command in `bun run build`. Existing
apps own their package scripts: replace a bare `bun build` command when adding
a plugin with required content. An [update](./update.md) does not rewrite it.

## Inputs And Flags

| Flag | Default / behavior |
| --- | --- |
| `--config` | `./zero.config.ts`; the module actually imported by the app entry. |
| `--entry` | `./app/server.ts`, relative to captured project root. |
| `--outdir` | `./dist`, relative to that root. Must be outside public asset output. |
| `--compile` | Build a Bun executable instead of JavaScript server output. |
| `--outfile` | Simple executable filename, default `server`; requires `--compile`. |
| `--help`, `-h` | Print usage without preparation. |

Unknown/duplicate flags, missing arguments and an entry that never imports the
selected config fail rather than silently omitting required content.
The config may export `config`, `appConfig`, `zeroConfig` or default; their
precedence follows that order. Extra named exports are preserved.

The config's explicit absolute/file-URL `projectRoot` wins; otherwise the CLI
captures its directory. Entry/output and plugin relative paths use that root.
This is not a new merge system for database, storage or environment settings.

## Build Stages And Trust

1. Import selected config and discover native server declarations once.
2. Validate content mount ownership and prepare required contributions.
3. Bundle tokenized enhancements, scoped/shared styles and admitted files.
4. Save private compiled metadata outside `/_build`.
5. Bundle the original entry using prepared config and static declarations.

Plugin runtime `setup` is not executed during build. Zero preparation does not
open/migrate databases, provision tenants, call providers or start the server.
Trusted imports can execute arbitrary top-level code: inspect config/plugin
modules before running a build. Generated output writes are deliberate; this
command is not read-only Doctor and does not install, deploy or restart an app.
See [native build contributions](../../backend/runtime/build-contributions.md)
for the complete server-side contract.

## Deployment Boundaries

Copy the **complete** JavaScript output directory, not just `server.js`.
Its file-loader assets include the complete browser chunk graph. Compiled build
data stays in the server; public files have explicit static URLs. Private
attachments are embedded/copied separately and have no automatic public route.
Only their owning plugin's admission-controlled logical route should serve them.

The generated private manifest also binds bundled plugin SSR to the bundled
React identity. It must not change merely because app node_modules remains
available. File-page SSR continues to use consuming-app dependencies for its
copied source modules; no required app-level renderer setting is introduced.

```sh
zero build --config ./zero.config.ts --entry ./app/server.ts \
  --outdir ./dist --compile --outfile docs-server
./dist/docs-server
```

The verified no-source fixture is a docs/plugin-only app without file pages:
SSR, admitted private attachments, enhancements, named exports and app hooks
work after source and node_modules are removed from the deployment. A missing
optional app route directory is empty; an existing non-directory fails.

**Applications with file-routed pages retain their existing source-deployment
convention.** Deploy the app route modules and their app-owned dependencies.
Do not infer that this command precompiles every file-router, provider, Fabric
actor and API combination into one self-contained executable. The command does
not erase existing pages or start a replacement app to mask missing modules.

Runtime launches resolve ordinary generated paths from the deployment cwd,
unless the source config deliberately sets `projectRoot`. Database paths,
environment credentials, service startup and migrations retain their own
contracts. Building is not migrating. Verify the deployment mode actually used.

## Failures And Checks

Success reports the server path, declared-plugin count and public-asset count.
Required errors yield a nonzero command result. Core build events follow
[runtime observability](../../backend/runtime/observability.md), using bounded
plugin/stage metadata; human CLI output may provide operator error context.
Production startup requires a matching required artifact and will not silently
recompile missing sources.

In a disposable app, build, start the output, load documentation with JavaScript
disabled, fetch the emitted script/CSS and lazy chunks, verify a private
attachment's admission/revocation and gracefully shut down. Test ordinary file
pages separately when present. Source checks are not a release-archive claim.

## Related Guides And Next Steps

- [Scaffolding](./scaffolding.md): generated scripts versus app-owned changes.
- [Native build contributions](../../backend/runtime/build-contributions.md): output, setup and SSR seams.
- [Configuration](../../backend/runtime/configuration.md#build-and-root-options): explicit roots and prepared artifacts.
- [Shutdown](../../backend/runtime/shutdown.md): awaited extension drains before service disposal.
- [Markdown docs plugin](../../plugins/docs/index.md): public folder-based docs mounting.

---
id: zero.cli.tooling.build
type: how-to
audience: [developer, agent, operator]
owner: cli-tooling
status: verified
visibility: internal
system: cli-tooling
feature: build
maturity: supported
applies_to: ["2.6.0"]
modes: ["Bun package-mode applications", "trusted local builds"]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
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
6. For compiled output on macOS, replace the generated executable's ad-hoc
   signature and require strict verification before returning a successful build.

Plugin runtime `setup` is not executed during build. Zero preparation does not
open/migrate databases, provision tenants, call providers or start the server.
Trusted imports can execute arbitrary top-level code: inspect config/plugin
modules before running a build. Generated output writes are deliberate; this
command is not read-only Doctor and does not install, deploy or restart an app.
See [native build contributions](../../backend/runtime/build-contributions.md)
for the complete server-side contract.

## Deployment Boundaries

Copy the **complete** output directory for both JavaScript and executable builds,
not just `server.js` or the compiled executable.
Its file-loader assets include the complete browser chunk graph. Compiled build
data stays in the server; public files have explicit static URLs. Private
attachments are embedded/copied separately and have no automatic public route.
Only their owning plugin's admission-controlled logical route should serve them.

When the server graph includes Guardian's avatar decoder, the build also emits
a private `zero-native/` payload containing the host-native Sharp addon, its
libvips libraries and available vendor notices. Native binary filenames and
relative vendor layout are preserved; flattening or renaming those files can
break the OS loader. They are not browser assets or a copied `node_modules`
tree. Keep that directory beside the server/executable when relocating a build;
do not publish it through `/_build` or a public file route.

`zero build --compile` currently builds for the host platform/architecture,
including its native addon and libc. It does not offer a cross-target flag;
moving that payload to another OS/architecture is not a supported
cross-compilation workflow. Build on the intended target with Sharp's optional
native dependencies installed. Missing or unsupported native package layout
fails the build instead of dropping server image validation. Current
qualification covers the documented macOS ARM64 source/local baseline, not
every operating system.

On macOS, compiled builds require the host `/usr/bin/codesign` tool. Zero
ad-hoc signs only its newly generated executable, preserving existing signing
metadata and JIT entitlements where present, then verifies the signature
strictly. Signing or verification failure fails the build; neither is silently
ignored. This does not select an application certificate, establish a Developer
ID, notarize a release, or guarantee Gatekeeper acceptance on another machine.
Distribution signing and notarization remain a separate release responsibility.
The native vendor payload is not recursively re-signed. JavaScript output and
non-macOS builds do not invoke this step.
Each host signing command has a 60-second deadline. A timed-out child is killed
and reaped before the build rejects. Failures use the stable
`app.compiled_signature.failed` observability event with only the stage, reason
and exit status; command paths, environment and raw tool output are not logged.

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
Separate managed-avatar fixtures enable the real Guardian/Storage ceremony and
verify staged PNG upload, native normalization and private WebP delivery after
relocation, in JavaScript and executable modes. Disabled auth/avatars do not
eagerly load the native processor.

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

# Building Apps And Declared Plugin Content

Development source for Zero 2.5.0. The optional Markdown documentation package
uses these native build seams; installing a dependency alone does not register
a plugin or publish its content.

[Start Here](./start-here.md) · [SDK reference](./sdk-reference.md) ·
[Backend extensions](./framework/phase-1-backend-extensions.md)

## Normal Build Command

From an installed package-mode app:

```sh
zero build --config ./zero.config.ts --entry ./app/server.ts --outdir ./dist
```

New scaffolds use this command for `bun run build`. Existing applications own
their scripts: replace a bare `bun build app/server.ts ...` build command when
adding a plugin that declares required build content. A framework dependency
update does not rewrite an existing application's `package.json`.

The command performs these stages in order:

1. Import the selected trusted config and discover native server declarations.
2. Validate declared content mount ownership and compile plugin contributions.
3. Build content-addressed plugin enhancements, scoped CSS and shared styles.
4. Save private compiled metadata outside the public asset directory.
5. Bundle the **existing** app server entry with a prepared version of its config.

The original entry still owns listening, custom hooks and application startup.
Its selected config's named exports remain available. Discovered declarations
are included statically, so the deployed build does not import their original
files again. Runtime `setup` is not executed during this preparation phase;
managed startup invokes it after live Zero services are available.

Build imports execute trusted application code. Config/plugin modules must keep
top-level side effects deliberate. Zero's preparation itself does not open or
migrate databases, provision tenants, start app listeners, or call providers.
The build writes generated files; it is not a read-only Doctor invocation.

| Option | Default / behavior |
| --- | --- |
| `--config` | `./zero.config.ts`; selects the config actually imported by the app entry. |
| `--entry` | `./app/server.ts`, relative to the resolved project root. |
| `--outdir` | `./dist`, relative to that root; server output must be outside public `/_build` files. |
| `--compile` | Produce a Bun executable instead of `server.js`. |
| `--outfile` | Simple executable filename; defaults to `server`, requires `--compile`. |
| `--help`, `-h` | Show usage without preparing an app. |

Unknown/duplicate flags and missing values fail. An entry that does not import
the selected config fails instead of producing a server that silently lacks
required plugin content. No update, deployment, Docker operation or live app
restart is performed.

## Deployment Boundaries

The generated config embeds the private content manifest and file-loader
references. Public enhancements and private attachments are included in the
server build output; the latter have **no automatic public static URL**.
Copy the complete output directory, not only `server.js`, for a JavaScript
deployment. A compiled executable embeds those declared files.

```sh
# JavaScript server output and its file-loader assets:
bun ./dist/server.js

# Optional self-contained executable:
zero build --config ./zero.config.ts --entry ./app/server.ts \
  --outdir ./dist --compile --outfile docs-server
./dist/docs-server
```

Start from the application's deployment root, or configure an explicit
`projectRoot`. Runtime data paths, environment values, providers and app services
retain their normal ownership. Rebuilding does not migrate a database.

The qualified no-source case is a docs/plugin-only application with no file
pages: its built docs, private attachments, frontend assets and custom app-entry
behavior operate without the original Markdown/plugin directory or a live
`node_modules` tree. A missing optional `appDir` is an empty file-route set;
an existing non-directory is a configuration error.

**Apps with file-routed pages keep their existing source-deployment convention.**
Ship their `app/` modules and app-owned imports/runtime dependencies as required
by those pages. The docs build does not erase those pages, substitute a generic
server, or claim to precompile every file-router/API/provider/Fabric combination
into one executable. Verify the deployment mode actually used by the app.

## Declared Plugin Build Contract

`defineZeroPlugin` accepts optional `build` alongside `name` and `setup`:

```ts
import { defineZeroPlugin } from '@zero/framework/server';

export default defineZeroPlugin({
  name: 'example-reader',
  build: {
    identity: 'reader-config-v1',
    mountPaths: ['/reader'],
    async prepare(context) {
      const body = await Bun.file(`${context.projectRoot}/reader-content.txt`).text();
      return { data: { body } };
    },
  },
  setup({ app, frontend }) {
    const compiled = frontend.plugins['example-reader'];
    return app.get('/reader', () => Response.json(compiled.data));
  },
});
```

This complete declaration intentionally publishes its admitted `body` as JSON.
It is trusted server code, not a permission boundary for untrusted document
authors. A real package owns its content/publication validators before returning
build data. Use `renderServerPage` below for a composed SSR reader.

`build.required` defaults to `true`. Required compilation, entry, stylesheet and
attachment failures abort the build/startup. `required: false` is an explicit
optional capability; setup must tolerate its absence. Required errors are not
converted into a partially functioning docs page.

`build.identity` is an optional stable configuration identity. A production
artifact must match the current identity. `mountPaths` claims canonical page
prefixes: overlapping plugins, app page/file-API ownership, malformed paths and
reserved namespaces fail before setup. A root mount cannot displace app pages.
Canonical encoded Unicode/space segments are supported as literal paths; unsafe
encoding, encoded separators, traversal and route patterns remain rejected.
The public `isReservedAppRoutePath`/`RESERVED_APP_ROUTE_PREFIXES` registry lets
root-mounted content validators reject authored routes that would reinterpret
core namespaces. Package-owned paths such as a search endpoint remain that
package's additional responsibility.

### Build Context

The frozen context supplies:

| Field | Meaning |
| --- | --- |
| `projectRoot` | Captured config/launch origin; relative inputs never consult a later cwd. |
| `appDir` | Actual configured app route directory. |
| `appIdentity` | Existing readonly app name/public URL/support address. |
| `generatedDir` | This plugin's private generated snapshot directory. |
| `assetOutDir`, `publicBasePath` | Isolated public plugin asset namespace. |
| `mode` | `development` or `production`. |
| `emitCode` | App-bound Zero observability emitter. |

The normal CLI supplies the selected config's directory as origin. Direct
`createApp` captures explicit `projectRoot`, otherwise the parent of an absolute
`appDir`, otherwise the ordinary launch cwd once. `projectRoot` accepts an
absolute path or file URL; a relative explicit root is rejected. For custom
launches outside the normal project directory, provide that root or absolute
content inputs deliberately. This does not change database/storage paths into
an implicit new configuration merge system.

### Build Output

| Field | Contract |
| --- | --- |
| `data` | JSON-only compiled content, copied/frozen and kept server-side. No accessors, functions, symbols, sparse arrays or non-finite numbers. |
| `browserEntries` | Named source entries bundled using the host app's React identity. |
| `styles` | Named prebuilt scoped CSS files using Zero tokens. |
| `styleSources` | Additional component source files/directories for shared Tailwind scanning; not an implicit content scanner. |
| `assets` | Named explicitly public files in the plugin build namespace. |
| `privateAssets` | Named attachments copied privately; the plugin must serve them through current admission rules. |

File declarations accept `name`, `path` and optional `contentType`. Names are
unique bounded identifiers. Paths accept relative strings, absolute strings or
file URLs. Optional `contentHash` checks a full lowercase SHA-256 against copied
bytes; optional `sourceRoot` rechecks final realpath containment. Content
compilers should use these to preserve an admitted snapshot and reject changed
or escaping files rather than publish inconsistent content. The same admission
applies to browser entries, styles and public/private attachments.

Browser entries accept JavaScript/TypeScript extensions (`.js`, `.mjs`, `.cjs`,
`.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`). The bundler receives the admitted entry
bytes instead of rereading a pathname that could have changed after admission.
Normal relative imports and lazy chunks still work. `sourceRoot` bounds the
declared entry file, not every imported dependency; those dependencies remain
trusted build inputs. No new setting is required for an existing valid entry.

Public files live beneath `/_build/plugins/<owned-namespace>/`. Browser cleanup
does not delete that directory. Private manifests/attachments must remain
outside the public build directory; canonical/symlink aliases are checked.
Private attachment descriptors do not create a public `/_build` route.

## Runtime Setup And SSR

Setup receives the existing trusted `{ app, zero }` plus readonly
`projectRoot`, `appDir`, `appIdentity`, `generatedDir`, `files`, `frontend` and
app-bound `emitCode`. `files` contains only this plugin's declared private file
references; read with `Bun.file(files[name])` after that package's current access
and publication admission. Removing access must stop its logical download
route; it must not depend on obscuring a permanent public asset URL.

`frontend` exposes actual shared `cssPath`/`clientEntry` and per-plugin assets,
compiled data and private artifact descriptors. Do not guess hashed paths or
scan output directories in a package. The normal build injects
`frontendBuild`, `frontendAssetFiles`, `pluginBuildFiles` and explicit
`serverExtensions` into the config. These are trusted build artifacts, not
user-controlled tenant selectors or a browser configuration editor.

`renderServerPage` reuses Zero's React SSR machinery and document shell, with
explicit build-owned identity selection for bundled plugin closures. Its public options are:

- `component`, `props`, `request`, `appDir`, `frontend`.
- Optional `pluginName`, `meta`, `rootId`, `nonce`, `status`, `emitCode`.

The normal server build owns a private `frontend.pluginSsrRuntime` artifact
marker: bundled plugin closures use their bundled React renderer even when live
app dependencies exist beside the output. Source/manual preparation defaults
to the consuming-app renderer. File-route pages retain their app runtime because
their copied source modules are not bundled plugin closures. The marker is
validated, is not a required app setting/theme option and is never projected
into browser configuration. Renderer caches distinguish both identities.

It streams useful HTML, links actual shared/selected-plugin styles and external
enhancements, escapes metadata, and never serializes compiled private data into
the head. `rootId` is an HTML-only container outside React, so a plugin may
hydrate its matching component tree without changing `useId` ancestry. A nonce
is request-local, never cached in the manifest. `HEAD` returns no body. SSR
errors use caller-owned standard observability and a safe public 500 response.

This rendering seam is **not authentication admission**. Public V1 readers
admit the public projection before rendering. A protected package must use a
supported live page-session/authorization boundary for every page/search/asset;
ordinary Bearer middleware or a browser visibility gate is not a substitute.
Protected Markdown mounts remain a staged feature of the docs package.

Async plugin drains remain awaited while app services are live, before Guardian/
Fabric/provider disposal. Stop watchers, fence stale rebuilds and release owned
work in those hooks. Runtime setup is never used as a covert build phase.

## Errors And Focused Verification

Stable trusted build errors are `APP_PLUGIN_BUILD_CONFIG_INVALID`,
`APP_PLUGIN_BUILD_FAILED` and `APP_PLUGIN_BUILD_MISSING`. Build events use
`OBS_CODES.APP_PLUGIN_BUILD_READY`, `APP_PLUGIN_BUILD_FAILED` and
`APP_PLUGIN_BUILD_CONFIG_INVALID`; bounded plugin/stage metadata does not include
document bodies, credentials or raw source exceptions. A missing production
artifact fails clearly: required content is not silently rebuilt from sources.

The focused qualification exercises declaration/setup separation, JSON/asset
admission, mount ownership, private-directory containment, SSR/CSP escaping,
native streaming cancellation, normal app entry/named exports, copied public
assets including dynamic chunks, allowlist-controlled private attachments and
awaited shutdown. A relocated app with copied file-page sources retains its
pages, while the compiled fixture also exercises two fresh process/cwd launches. The
docs-only regular and compiled deployments run with source directories moved
away. Installed archive qualification remains part of the release handoff.

For application checks, build the app, start its built entry, load docs with
JavaScript disabled, request actual emitted asset URLs, revoke an admitted
attachment, and shut down gracefully. Verify real app file pages separately
when the application has them. Use disposable fixtures, not live app data.

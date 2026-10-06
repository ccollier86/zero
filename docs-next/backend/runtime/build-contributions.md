---
id: zero.runtime.build-contributions
type: reference
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: build-contributions
maturity: supported
applies_to: ["2.5.0 development source; publication qualification pending"]
modes: [managed-server, standalone-extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "636b1c01b3484317df56ce624c7cd57976ee417c"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Native Plugin Build Contributions

[Runtime index](./index.md) · [Documentation index](../../index.md)

An optional native plugin can compile content and declare browser enhancements,
styles and attachments without adding a second application server. Declaration
and build preparation happen before app assets and before managed services open.
[Plugin setup](./plugins.md) remains a privileged, awaited runtime lifecycle step.

Use the normal [build command](../../cli/tooling/build.md) to prepare these
contributions and bundle the **existing** app entry. Installing a package alone
does not register a plugin or publish content. The optional
[Markdown documentation plugin](../../plugins/docs/index.md)
uses this contract.

## Declare A Contribution

```ts
// server/plugins/reader.ts
import { defineZeroPlugin } from '@zero/framework/server';

export default defineZeroPlugin({
  name: 'example-reader',
  build: {
    identity: 'reader-settings-v1',
    mountPaths: ['/reader'],
    async prepare({ projectRoot }) {
      const body = await Bun.file(`${projectRoot}/reader-content.txt`).text();
      return { data: { body } };
    },
  },
  setup({ app, frontend }) {
    return app.get('/reader', () =>
      Response.json(frontend.plugins['example-reader']?.data));
  },
});
```

This example deliberately publishes the admitted file body as JSON. Compilers
for user-authored content must enforce their own validation and publication
rules before returning data. Build declarations are trusted server modules,
not an untrusted scripting API or an authorization grant.

`build.required` defaults to `true`; a required compile/entry/style/attachment
failure aborts preparation. An explicit `required: false` contribution may be
absent; its setup must tolerate that condition. `identity` is an optional stable
configuration fingerprint that must match a supplied production artifact.

`mountPaths` claims canonical page prefixes before setup. Overlapping plugins,
intersecting file pages/APIs and reserved core namespaces are rejected. Root
mounts cannot displace application pages. Canonical encoded Unicode segments
such as `/caf%C3%A9` are literal paths; malformed encodings, traversal, encoded
separators and route patterns are not admitted. A root content compiler can use
the public `isReservedAppRoutePath` and `RESERVED_APP_ROUTE_PREFIXES` to reject
authored paths in Zero-owned namespaces. Package-specific projections still
need the package's own ownership rules.

## Build Context And Output

The frozen build context contains `projectRoot`, `appDir`, `appIdentity`,
`generatedDir`, `assetOutDir`, `publicBasePath`, `mode` and app-bound `emitCode`.
`appIdentity` contains the existing app name/public URL/support address.
`generatedDir` is a plugin-owned private snapshot location. The normal CLI
captures the selected config directory as root unless `projectRoot` is explicit.
Direct app construction captures its origin once; later cwd changes do not
retarget relative inputs. See [configuration](./configuration.md#build-and-root-options).

| Output | Contract |
| --- | --- |
| `data` | JSON-only compiled data, deeply copied/frozen and server-side. |
| `browserEntries` | Named sources bundled with the host application's React identity. |
| `styles` | Named prebuilt scoped CSS using Zero design tokens. |
| `styleSources` | Extra source files/directories for shared Tailwind scanning. |
| `assets` | Named files explicitly public in `/_build/plugins/<owned-namespace>/`. |
| `privateAssets` | Named private snapshots; no automatic public static URL. |

File declarations accept `name`, a string/file-URL `path`, optional `contentType`,
full lowercase SHA-256 `contentHash` and `sourceRoot`. Relative paths resolve
against captured root. Hash checking protects the admitted bytes; canonical
source containment rejects an escaping file. These checks apply to browser
entries as well as styles and public/private attachments. A compiler should supply
both when serving an immutable publication snapshot.

Browser entries must be JavaScript or TypeScript (`.js`, `.mjs`, `.cjs`, `.jsx`,
`.ts`, `.mts`, `.cts`, or `.tsx`). Zero admits a canonical regular-file snapshot
and bundles those captured entry bytes, so replacing the entry pathname after
admission cannot substitute new code. Relative imports retain their original
source-directory resolution, and lazy chunks remain in the output graph.
`sourceRoot` contains the declared entry; it is **not** an imported-dependency
sandbox. Imported code and build declarations remain trusted execution inputs.

JSON data rejects accessors without invoking them, functions, symbols,
non-finite numbers, sparse arrays and non-plain objects. Private generated files
must be canonically outside the public build directory, including symlink
aliases. Browser cleanup does not delete the isolated plugin namespace. The
normal build includes the entire browser output graph, including lazy chunks.

## Preparation And Production

`prepareAppBuild(config, { mode?, emitCode? })` is the public trusted preparation
helper. It returns resolved `config`, discovered `extensions`, `frontend`,
`manifest`, `privateManifestPath` and `extensionModulePaths`. It writes generated
files but does not run setup, open/migrate a database or listen. Imported config
and plugin top-level code remain trusted execution inputs.

Required production contributors require the matching prepared `frontendBuild` artifact;
missing content is not silently compiled from sources at startup. The CLI
injects that artifact, public `frontendAssetFiles`, private `pluginBuildFiles`
and statically discovered `serverExtensions`. See
[deployment boundaries](../../cli/tooling/build.md#deployment-boundaries).

Runtime setup receives `{ app, zero, projectRoot, appDir, appIdentity,
generatedDir, files, frontend, emitCode }`. `files` is only the current plugin's
declared private references; `Bun.file(files[name])` reads embedded or copied
bytes. Serve them through the package's current admission boundary. Revoking
access must stop the logical route, not merely hide a public static URL.

## Shared Public SSR

`renderServerPage` accepts `component`, `props`, `request`, `appDir`, `frontend`
and optional `pluginName`, `meta`, `rootId`, `nonce`, `status`, `emitCode`.
It uses the existing React SSR machinery/HTML shell, emits actual selected
styles and enhancements, escapes metadata and supports streaming cancellation.
`HEAD` is bodyless without executing the component. SSR failures emit standard
app-bound events and return a safe generic 500.

`rootId` describes the HTML container **outside React**, preserving matching
`useId` ancestry for hydration. A request nonce is not a manifest value. The
helper never automatically publishes private build data into the head.

The normal CLI owns the private artifact's `frontend.pluginSsrRuntime` marker.
Bundled plugin closures select their bundled React/ReactDOM identity regardless
of whether physical app dependencies are still available beside the output.
Source/manual preparation defaults to the consuming-app renderer. File routes
retain consuming-app identity for copied source pages. Runtime caches separate
these choices. This validated artifact ownership marker is not a required user
configuration option or browser setting, and is not serialized into page props.

This seam does **not** authenticate a page. Public readers admit the public
projection first. Protected mounts need a supported live page-session and
authorization boundary for pages, search and attachments; ordinary bearer
middleware or browser visibility gates are not substitutes.

## Failures, Shutdown And Verification

Build errors use `APP_PLUGIN_BUILD_CONFIG_INVALID`, `APP_PLUGIN_BUILD_FAILED`
and `APP_PLUGIN_BUILD_MISSING`. Events use the corresponding
`OBS_CODES.APP_PLUGIN_BUILD_*` codes, with bounded plugin/stage metadata and no
document body, credentials or raw compiler exception in public responses.
Required errors propagate. Setup remains after service construction; owned
extension drains remain [awaited before service disposal](./shutdown.md).

Focused source tests cover declaration/setup separation, ownership, invalid
JSON/assets, private path isolation, SSR escaping/cancellation, real Unicode
mounts, app-entry named exports, the complete lazy browser graph and private
attachment revocation. Copied JavaScript and compiled plugin-only deployments
run with source/node_modules moved away and drain while SQL is still live.
These dirty-source checks do not independently qualify a published archive.

## Related Guides And Next Steps

- [Build CLI](../../cli/tooling/build.md): exact commands and source-deployment boundaries.
- [Configuration](./configuration.md#build-and-root-options): captured roots and trusted artifacts.
- [Discovery](./discovery.md): declarations are imported once before assets and setup.
- [Style build](../../frontend/design-system/style-build.md): scoped styles and extra tokenized component sources.
- [Markdown docs](../../plugins/docs/index.md): folder-based consumer of these seams.

---
id: zero.runtime.discovery
type: reference
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: discovery
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

# Server Module Discovery

[Runtime index](./index.md) · [Documentation index](../../index.md)

Managed apps discover app-owned server extensions from configured directories.
This is trusted dynamic module import and composition—not static metadata
inspection, sandboxed user code or a serverless function registry.

From the 2.5.0 native build integration, managed construction discovers these
declarations **once before app assets**. Required
[build contributions](./build-contributions.md) prepare next; runtime setup is
awaited only after managed services exist. The normal
[build command](../../cli/tooling/build.md) statically bundles the same discovered
declarations and disables duplicate runtime file discovery. Imports still run
trusted module top-level code; preparation is not a sandbox.

## Files And Exports

Eligible extension files are .ts/.tsx/.js/.jsx/.mjs/.cjs, recursively collected
in stable lexical file order. Hidden entries, .d.ts files and colocated test/spec
files are skipped. Missing directories produce an empty contribution; a present
non-directory path or invalid module export fails instead of silently dropping
application backend behavior.

Recognized export names are default, endpoint, endpoints, middleware, plugin,
plugins, router, routers and routes. Values may be supported definitions,
raw Elysia plugins/callbacks or nested arrays of those. Duplicate references to
the same exported value are deduplicated by identity; two different definitions
with the same name are still subject to Elysia/plugin naming semantics.

```ts
// server/endpoints/status.ts
import { defineEndpoint } from '@zero/framework/server';

export const endpoint = defineEndpoint({
  method: 'GET', path: '/api/example/status', auth: false,
  handler() { return { ok: true }; },
});
```

This simple public endpoint has no protected data. Exporting an arbitrary
function that is not a supported plugin callback/definition is not a safe way
to publish an app function.

## Areas And Order

Managed defaults are separate plugins, middleware, endpoints and routes
directories. Explicit extensionDirs in the lower-level loader takes precedence
over its legacy routesDir option. Resource discovery is a separate declaration
loader; a resource file is not mounted just because a similarly named router
folder exists.

Use meaningful layout and explicit dependencies rather than relying on filename
ordering to initialize a service later consumed by another plugin. Async setup
is awaited. No background recovery should run against a handler registry that
is still being imported.

## Trust And Side Effects

An import can run top-level JavaScript, read environment variables, start timers
or call external code. For that reason, import diagnostics require inspected,
trusted modules and disposable fixtures. “Read-only Doctor” does not make
configuration imports side-effect-free. Never execute a real app's config merely
to enumerate its documented options.

The loader emits stable loaded/load-failed observability with safe directory-kind
and count metadata. Invalid exports produce ServerRouteLoaderError rather than
an incomplete ready app. File paths are operator context; do not echo private
paths or raw import errors into public responses.

## Public Helpers

`loadServerRoutePlugins` returns composed mountable plugins; it does not open a
listener. `collectServerRouteFiles` performs file discovery without executing
those modules. Lower-level helpers remain trusted server APIs, not browser
module-discovery endpoints.

`normalizeServerRouteModule` is the public trusted module-export normalization
seam used by the normal build adapter. It does not admit untrusted JavaScript
or bypass setup/request authority boundaries.

## Related Guides And Next Steps

- [Configuration](./configuration.md#managed-directories) selects/disables areas.
- [Endpoints](./endpoints.md), [routers](./routers.md), [middleware](./middleware.md)
  and [plugins](./plugins.md) define valid contributions.
- [Composition](./composition.md) owns admission and publication of the app.

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
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Server Module Discovery

[Runtime index](./index.md) · [Documentation index](../../index.md)

Managed apps discover app-owned server extensions from configured directories.
This is trusted dynamic module import and composition—not static metadata
inspection, sandboxed user code or a serverless function registry.

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

## Related Guides And Next Steps

- [Configuration](./configuration.md#managed-directories) selects/disables areas.
- [Endpoints](./endpoints.md), [routers](./routers.md), [middleware](./middleware.md)
  and [plugins](./plugins.md) define valid contributions.
- [Composition](./composition.md) owns admission and publication of the app.

---
id: zero.runtime.configuration
type: reference
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: configuration
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

# Runtime And Extension Configuration

[Runtime index](./index.md) · [Documentation index](../../index.md)

Import helpers/types from `@zero/framework/server`. The declarations below are
trusted server code; they are read during construction/composition, not loaded
as user-authored scripts from a database. Changing runtime declarations normally
requires re-composition/restart and any relevant data migration.

## Managed Directories

| AppConfig option | Omitted value | Responsibility |
| --- | --- | --- |
| appDir | ./app | file-router/frontend application |
| outDir | ./.build | public browser assets, served under /_build |
| generatedDir | ./.zero/generated | private generated glue and plugin content snapshots |
| serverPluginsDir | ./server/plugins | app plugin modules |
| serverMiddlewareDir | ./server/middleware | app middleware modules |
| serverEndpointsDir | ./server/endpoints | endpoint modules |
| serverRoutesDir | ./server/routes | grouped/raw route modules |
| serverResourcesDir | ./server/resources | declarative resources |
| port |3000| resolved listener setting used by the entry point |

Each server discovery directory accepts false to disable its area. Do not use
false for an unrelated string-only path option. Configured paths are admitted
for isolation before managed data/build work. A directory is not a URL prefix.
See [discovery](./discovery.md) for execution and export conventions.

## Build And Root Options

The following additions apply to the 2.5.0 development source:

| AppConfig option | Contract |
| --- | --- |
| `projectRoot` | Optional absolute string/file URL. Otherwise capture the parent of an absolute appDir, or ordinary launch cwd, once. Relative frontend/discovery/generated paths use this root; database/storage settings retain their own behavior. |
| `serverExtensions` | Optional readonly explicit native/raw extension array; combined with configured discovery, with explicit entries preceding discovered modules. |
| `frontendBuild` | Trusted version-1 prepared manifest; required for production plugins declaring required compiled content. |
| `frontendAssetFiles` | Trusted public URL → file reference map injected by normal build for copied/embedded assets. Not a tenant selector. |
| `pluginBuildFiles` | Trusted plugin name → declared private name → file reference map; never exposed by the public static router. |

The [build CLI](../../cli/tooling/build.md) captures the config-directory root
during preparation and preserves an explicitly configured runtime root. Without
an explicit root its generated wrapper captures deployment cwd, not the build
machine's absolute path. Apps with copied file-page sources therefore keep their
normal relocated routing. Production requires matching content and file
references; missing private artifacts are not a source rebuild fallback.
See [build contributions](./build-contributions.md) for validation, read time,
immutability and separation from the public static directory.

There is no generic runtime config-file deep merge, database-backed configuration
editor or `serverOnly:true` switch supplied by this reference. Subsystem
configuration owns its actual environment binding and precedence.

## Endpoint Options

| Option | Contract |
| --- | --- |
| method | required GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD or lowercase form |
| path | required absolute-style path; relative to enclosing router prefix |
| handler | required callback over typed Zero lifecycle context; sync or async result |
| name | optional stable diagnostic/plugin name |
| auth | shared AccessRequirement; omitted inherits parent/root optional policy |
| body, query, params, headers | transport validation schemas; static schema types infer handler inputs |
| cookie, response | Elysia cookie/response validation contracts |
| detail | Elysia route metadata |
| parse, transform, beforeHandle, afterHandle, mapResponse, error | lifecycle callback or callback array; may be async |

Access admission is prepended before app beforeHandle work. Protected multipart
admission also runs before file parsing. Custom hooks must preserve that boundary
and safe error handling; [endpoint guidance](./endpoints.md) owns the flow.

## Router Options

`defineRouter` accepts required name, optional prefix/auth, and endpoints/routes
child arrays. When both child arrays are present, endpoints precede routes.
Prefixes compose through nested routers. Names govern Elysia deduplication;
use stable distinct names rather than random names for identical plugins.
See [router policy](./routers.md).

## Middleware Options

`defineMiddleware` accepts required name/run, optional top-level path/auth and
optional structured matcher. `run` may be async. The matcher accepts path,
method, predicate, auth, role and properties. Explicit matcher fields take
precedence over matching legacy aliases.

Path/method/predicate determine applicability; auth/role/properties enforce
policy on a matching request. Scalar property requirements accept direct values,
arrays or equals/in/not/exists objects. Trusted predicates may execute code and
must not be mistaken for browser-supplied rules. The [middleware guide](./middleware.md)
owns matching/enforcement and credential-reset behavior.

## Plugin Options

`defineZeroPlugin` requires name and setup. Setup receives app and the privileged
app-local setup zero services, may be async, and returns an Elysia plugin or void.
The compiler awaits it and mounts the returned child or supplied app. It is not
the same capability set later exposed to a tenant request.

Optional `build` declares `prepare`, `required` (default true), `identity` and
`mountPaths`; it executes before browser assets and before runtime setup.
Setup additionally receives readonly `projectRoot`, `appDir`, `appIdentity`,
`generatedDir`, private `files`, resolved `frontend` and app-bound `emitCode`.
[Build contributions](./build-contributions.md) owns these fields and the
JSON/file admission rules. They are build-time configuration, not live grants.

Advanced bundle/app helpers accept an extension array, optional stable name and
an app-local runtime binding. `applyServerExtension` additionally accepts inherited
auth and route-prefix context. Managed discovery supplies these bindings; do not
import an internal runtime constructor merely to avoid normal composition.

## Read Time, Projection And Diagnostics

Declarations normalize method/path/access during construction and compile against
the app-local Guardian kernel at composition. Live request admission still
revalidates current authority; compiled configuration is not an everlasting grant.
The server configuration is not serialized wholesale into browser config.

Configuration and resource discovery imports execute trusted modules. Doctor
uses selected trusted config/resource paths; it is not a static-only guarantee.
Run synthetic fixtures without env-file loading when testing declarations.

## Related Guides And Next Steps

- [Composition](./composition.md) separates configuration from startup/listening.
- [Discovery](./discovery.md) explains actual module execution/order.
- [Service boundaries](../../concepts/service-boundaries.md) separates setup,
  request and verified background capabilities.
- [Roadmap](./roadmap.md) labels proposed configuration/scaffolding work.

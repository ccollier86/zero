---
id: zero.inventory.platform-configuration
type: inventory
audience: [maintainer, agent]
owner: platform-configuration
status: in-review
visibility: internal
system: platform-configuration
applies_to: ["2.1.1 committed source; archive qualification pending"]
modes: ["see feature and configuration matrix"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Declarative Platform Configuration Inventory

[System index](./index.md) · [Documentation index](../../../index.md)

## Audit Identity

Owns the top-level app configuration contract and how independent subsystem configuration is resolved and composed. Configuration is ordinary typed trusted TypeScript. A documentation layout is not a new Hydra/config-discovery API.

This source/contract inventory records the original clean baseline above.
The documentation branch now includes separately authorized source/test fixes;
their reproductions and actual runs are recorded in the
[findings ledger](../findings.md) and owning supplemental sections. Baseline
test-presence statements below do not claim those checks were executed.
Public implementation is observed in the committed source/export map; package
qualification is a separate gate. Internal annotations and trusted escape hatches
are not promoted to ordinary request APIs.

## Purpose And Terminology

`AppConfig` is the typed trusted-server declaration consumed by `createApp`.
`defineZeroConfig` is a literal-preserving identity helper; it does not merge
files or resolve secrets. `ResolvedConfig` is the normalized startup contract
from `resolveConfig`. Environment binding and precedence belong to each feature
resolver—there is no platform-wide “config always wins” rule and no implemented
database-backed settings control plane.

## Features And Documentation Coverage

Unless a row says otherwise, maturity is source-observed **supported** and its
review status is **inventory in review**; package qualification remains pending.

| Feature | Public surface and modes | Evidence / owning responsibility | Planned canonical guide |
| --- | --- | --- | --- |
| Literal-preserving declaration | `defineZeroConfig<const TConfig extends AppConfig>()` | Runtime-neutral returns input; exact config resolution owned by `createApp` | [Draft declaration guide](../../../backend/configuration/declaration.md) |
| Resolved configuration | `resolveConfig(config, env?)`, `ResolvedConfig` | Normalizes table wrappers, feature switches, modes, directories; validates interactions | [Draft resolution guide](../../../backend/configuration/resolution.md) |
| Feature enabling | `auth`, `workflows`, `email`, `ai`, `vector`, `kv`, `pdf`, `stateSync` | Enable/disable behavior not universal across subsystem types | [Draft feature switches guide](../../../backend/configuration/feature-switches.md) |
| App identity | `app: AppIdentityConfig` | Email/system UI identity, no generated permissions inferred | [Draft app identity guide](../../../backend/configuration/app-identity.md) |
| Data-plane modes | `db`, `systemDb`, `databaseTopology`, `tables`, `databaseAutomations` | Independent app/system and optional actor topology; realm registry | [Draft data modes guide](../../../backend/configuration/data-modes.md) |
| Resource/sync policy | `resources`, `resourceRoutes`, `syncPolicy`, `ephemeralPolicy`, `syncAuth`, `syncDefaults` | Mandatory multi-tenant classification and deny-wins managed protections | [Draft data access guide](../../../backend/configuration/data-access.md) |
| File router and redirect policy | `routeAuth`, `publicPaths`, `loginPath`, `registrationPath`, `postLoginPath` | Path normalization, safe return path, configurable fallback | [Draft routing guide](../../../backend/configuration/routing.md) |
| Discovery and artifacts | App/server directories, output/generated paths, port | Trusted module discovery and Bun build, no public arbitrary import API | [Draft directories guide](../../../backend/configuration/directories.md) |
| Sitemap | `sitemap: false | true | SitemapConfig` | Public static routes plus explicit entries/exclusions; path/frequency/priority | [Draft sitemap guide](../../../backend/configuration/sitemap.md) |
| Diagnostics/config hints | `doctor.indexedFields`, subsystem validation and export types | Doctor executes chosen config; separate static docs checks | [Draft diagnostics guide](../../../backend/configuration/diagnostics.md) |

## Public Surface Map

- `@zero/framework/server` exports `defineZeroConfig`, `resolveConfig`,
  `AppConfig`, `ResolvedConfig`, topology/storage/sitemap/sync configuration
  types, and `createApp` as the consumer of the resolved contract.
- The scaffold uses `zero.config.ts`. Doctor discovers
  `./zero.config.{ts,js}` and `./config/zero.config.{ts,js}`, or accepts an
  explicit path; it recognizes `config`, `appConfig`, `zeroConfig`, or a default
  export.
- Doctor loads the selected module through dynamic import and discovers the same
  conventional Resource modules used by startup. That executes trusted
  application code; it is not static parsing or side-effect-free inspection.
- Feature-specific types also live at their owning subpaths (for example
  `/ai`, `/kv`, `/pdf`, `/persistence`, and `/workflows`). There is no public
  broad deep-merge helper, alternate discovery graph, or runtime secret editor.

## Configuration Inventory

| Top-level option | Type / default observed in resolver | Owner / timing |
| --- | --- | --- |
| `db`, `tables` | Required database config and table map | Source config evaluated by app; resolution then startup |
| `systemDb` | Independent ephemeral for ephemeral app; otherwise file `./data/zero.system.db` | Persistence/Guardian startup |
| `databaseTopology` | Omitted / `{ mode: 'single' }`; object `multiple` | Fabric resolution |
| `databaseAutomations` | Optional admitted registry | Pinned app runtime; realm owns actor automations |
| `auth` | Omitted/false disabled; true defaults; object custom | Guardian resolution/startup |
| `workflows` | False disables; omitted/object enabled only with auth | Torrent registration/startup |
| `email`, `ai`, `vector`, `pdf` | Omitted/false disabled; true or own object enables | Each resolver owns env/default precedence |
| `kv` | Omitted/true durable defaults; false disabled; object custom | KV resolver/startup |
| `stateSync` | false | Requires auth, per-user state |
| `syncAuth` | required with auth; public without auth | No required authless combination |
| `resources` | [] | Resource admission/discovery |
| `resourceRoutes` | Enabled `{}` unless false | HTTP routes, `/api/resources` default |
| `syncPolicy`, `ephemeralPolicy` | Optional callbacks | Trusted live policy, no client security by config export |
| `syncDefaults` | auto loading with per-table overrides | Startup counts/resolves/persists eligible modes |
| `storageDir`, `storage` | `.storage`, normalized signing and Studio policy | Server startup |
| `appDir`, `outDir`, `generatedDir` | `./app`, `./.build`, `./.zero/generated` | App module load/build |
| `serverPluginsDir`, `serverMiddlewareDir`, `serverEndpointsDir`, `serverRoutesDir`, `serverResourcesDir` | `./server/<area>` or false | Trusted discovery/startup |
| `port` | 3000 | Exposed resolved config; application listen wiring |
| `migrate` | true in current `resolveConfig()` | Startup managed schema migration |
| `observability` | Console + bounded memory unless disabled/configured | Runtime creation before services |
| `publicPaths` | Resolved auth/lifecycle public defaults or explicit authoritative list | Protected-by-default page policy |
| `routeAuth` | protected-by-default with auth | Explicit mode supports page/layout declarations |
| `sitemap` | false | Optional static/public sitemap mounting |
| `loginPath`, `registrationPath`, `postLoginPath` | `/login`, `/register`, `/` | Normalized local paths; configured login loop rejected |
| `doctor` | {} | Trusted config validation |

`null` is not a universal accepted disable value. Environment precedence belongs to each resolver: never teach a global rule that all explicit config wins. Server config must not be wholesale serialized into browser config.

All values are server configuration unless explicitly projected. Reading an app's
configuration module executes trusted code; this audit only inspects source.
Doctor/config parity and installed-package examples require scoped synthetic
verification before release-facing claims are marked verified.

## Integration Map

AppConfig imports subsystem types rather than one untyped settings bag. `resolveConfig` composes these before file/runtime construction. Auth-disabled apps cannot enable stateSync or workflows. Tenant-database isolation requires multi-tenancy; durable database functions require a crash-durable system plane. Browser-injected configuration is a deliberate safe subset, not the server object.

## Evidence And Verification

Implementation, public type exports, scaffold conventions, and Doctor's loader
were inspected. `types.test.ts` and one direct Doctor config-loader test are
present; neither was run in this pass.

- [src/frontend/server/types.ts](../../../../src/frontend/server/types.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/types.test.ts](../../../../src/frontend/server/types.test.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/system-database-config.ts](../../../../src/frontend/server/system-database-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/database-topology-config.ts](../../../../src/frontend/server/database-topology-config.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/sync-mode-resolver.ts](../../../../src/frontend/server/sync-mode-resolver.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/frontend/server/sitemap.ts](../../../../src/frontend/server/sitemap.ts): source/test or research reference; test files were inspected as evidence, not executed.
- [src/doctor/config-loader.ts](../../../../src/doctor/config-loader.ts): conventional path/export discovery and trusted dynamic import.
- [src/doctor/config-loader.test.ts](../../../../src/doctor/config-loader.test.ts): test present, not executed in this pass.
- [docs/platform-configuration.md](../../../../docs/platform-configuration.md): source/test or research reference; test files were inspected as evidence, not executed.

See the [package export catalog](../catalogs/package-exports.md) for subpath
coverage; named exports require the owning feature guide, not a second API manual.

## Findings

Documentation/source-comment discrepancy: `migrate` comment mentions file-backed default, while resolver unconditionally uses `config.migrate ?? true`. Document the resolver's actual value and review migration execution separately; do not copy the comment as a mode promise. `vector.dataDir` currently gives environment precedence; per-system guide must preserve exact behavior rather than generic config precedence.

## Known Future Plans

User plans: split app configs into focused, well-linked modules; improve discoverability/agent tooling and effective-settings organization. No new config loader, runtime database-backed settings, or env precedence change implemented by these docs.

## Navigation And Cross-Link Plan

Planned home: `docs-next/backend/configuration/index.md`, `configuration.md` where relevant, and
`roadmap.md`. Feature paths above are plans until actual linked guides exist.
Cross-system integration descriptions must become contextual reciprocal links.

## Completion Review

- [x] Responsibility and primary source/public/config surfaces inspected.
- [x] Feature groups assigned canonical documentation destinations.
- [x] Independent source/public-boundary review of this inventory complete.
- [x] Whole-platform discovery/ownership reconciliation complete (not package/security qualification).
- [ ] Important examples and artifact/package support qualified.
- [x] Detailed draft guide homes replace the feature table's planned paths; independent manual/artifact qualification pending.

Follow the [documentation process](../../../documentation-process.md) before
marking this inventory complete or beginning detailed feature rewriting.

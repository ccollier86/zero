---
id: zero.configuration.reference
type: reference
audience: [developer, agent, operator]
owner: platform-configuration
status: draft
visibility: internal
system: platform-configuration
feature: reference
maturity: supported
applies_to: ["2.1.1 baseline with unreleased Schema corrections"]
modes: [managed-server]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# AppConfig Reference

[Configuration index](./index.md) · [Documentation index](../../index.md)

Import `AppConfig`, `ResolvedConfig`, `defineZeroConfig` and
`resolveConfig` from `@zero/framework/server`. This reference owns top-level
composition. Feature-specific nested settings belong to their corresponding
manual, not a second copy of the same contract.

All options are server-side declaration inputs. No automatic browser projection,
runtime database editor or global environment binding is implied.

## Identity And Data

| Option | Accepted type / omitted value | Detailed behavior |
| --- | --- | --- |
| `app` | `AppIdentityConfig`; {} | [identity](./app-identity.md): name/publicUrl/supportEmail |
| `db` | required `ReactiveDBConfig` | application plane; storage resolver owns mode/path/tuning |
| `systemDb` | `SystemDatabaseConfig`; separate ephemeral for ephemeral app, otherwise file `./data/zero.system.db` | always separate; raw `database` handle forbidden |
| `databaseTopology` | single/multiple discriminated object; single | actor topology adds isolated files; does not replace system ownership |
| `tables` | required table map | raw SQL tables, defineTable wrappers or mixed; exactly one supported row key |
| `databaseAutomations` | optional admitted registry | pinned application plane; realm owns actor-local automations |
| `resources` | readonly Resource definitions; [] | startup policy admission plus discovered conventional definitions |
| `resourceRoutes` | boolean or own route config; enabled {} | false omits generated routes; default base `/api/resources` |
| `syncPolicy` | optional trusted SyncPolicy | combines with managed protections using deny-wins semantics |
| `ephemeralPolicy` | optional trusted topic policy | custom topic admission and server-derived namespaces |
| `syncDefaults` | optional SyncDefaultsConfig | full/lazy/auto loading rules; not authorization |
| `storageDir` | string; `.storage` | built-in file object root, distinct from database actor directory |
| `storage` | AppStorageConfig | signing/expiry/Studio policy; not a generic true/false service switch |

## Feature Composition

| Option | Accepted form / omitted behavior | Dependency |
| --- | --- | --- |
| `auth` | false/true/Guardian object; disabled | true enables defaults; object adds app token TTLs |
| `workflows` | false/AppWorkflowsConfig; {} with auth, disabled without | enabled form requires auth |
| `email` | false/true/EmailConfig; disabled | true selects default Resend configuration, not guaranteed delivery readiness |
| `ai` | false/true/AIConfig; disabled | true enables environment-based provider detection |
| `vector` | false/true/VectorConfig; disabled | true selects default local index configuration |
| `kv` | false/true/KvServiceConfig; enabled | default everysec durability at `./data/kv` |
| `pdf` | false/true/PdfConfig; disabled | true uses secure Chromium defaults; renderer launches lazily |
| `stateSync` | boolean; false | true requires auth |
| `syncAuth` | required/public; required with auth, public otherwise | required without auth rejected |
| `observability` | false/ObservabilityConfig; default runtime | console plus bounded memory defaults; endpoint/trace policy separate |

[Feature switches](./feature-switches.md) explains true/object/readiness
differences. Guardian `accessTokenTTL` / `refreshTokenTTL` are app-level
duration strings (defaults 15m/7d), validated separately from behavior settings.
No universal null-disable convention exists.

## Paths And Pages

| Option | Accepted value / omitted default | Behavior |
| --- | --- | --- |
| `appDir` | string; `./app` | file-router source |
| `outDir` | string; `./.build` | generated build assets |
| `generatedDir` | string; `./.zero/generated` | framework glue |
| `serverPluginsDir` | string/false; `./server/plugins` | trusted discovery |
| `serverMiddlewareDir` | string/false; `./server/middleware` | trusted discovery |
| `serverEndpointsDir` | string/false; `./server/endpoints` | trusted discovery |
| `serverRoutesDir` | string/false; `./server/routes` | trusted discovery |
| `serverResourcesDir` | string/false; `./server/resources` | trusted Resource imports |
| `port` | number; 3000 | caller still invokes listen |
| `migrate` | boolean; true | execution is per-plane; not every ephemeral runtime runs platform migrations |
| `routeAuth` | protected-by-default/explicit | page policy when auth enabled |
| `publicPaths` | string[]; resolved login/register/account lifecycle defaults | explicit list replaces the defaults |
| `loginPath` | safe configured local path; `/login` | unauthenticated page destination |
| `registrationPath` | safe configured local path; `/register` | native authorization registration link |
| `postLoginPath` | safe configured local path; `/` | authenticated login fallback; safe return path wins |
| `sitemap` | false/true/SitemapConfig; disabled | public static routes plus deliberate entries |
| `doctor` | AppDoctorConfig; {} | trusted config/index hints |

## Resolution And Security

[Data modes](./data-modes.md) explains the plane/topology options;
[data access](./data-access.md) owns exact loading defaults and policy boundaries.
[Routing](./routing.md), [directories](./directories.md),
[sitemap](./sitemap.md) and [diagnostics](./diagnostics.md) own the corresponding
page/artifact/operational contracts in the tables above.

Omitted/false/true/object meanings are feature-specific. Changing startup
configuration requires re-admission/restart where appropriate; persistent schema
changes require migrations, not just new TypeScript.

Safe browser config is an explicit subset. Never inject server `AppConfig`,
resolved provider credentials, service instances or actor environment values
into a public page.

## Related Guides And Next Steps

- [Resolution](./resolution.md) owns read-time/precedence distinctions.
- [Runtime configuration](../runtime/configuration.md) lists endpoint/router/middleware/plugin options.
- [Guardian](../guardian/index.md) owns identity, onboarding, RBAC and API-key settings.
- [AI configuration](../ai/configuration.md) owns provider-specific controls.

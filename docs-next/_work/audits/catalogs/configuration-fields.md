---
id: zero.inventory.catalog.configuration-fields
type: inventory
audience: [agent, maintainer]
owner: platform-configuration
status: in-review
visibility: internal
system: platform-configuration
applies_to: ["2.1.1"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-04"
  evidence_level: source-observed
---

# Public Configuration Field Coverage

[Catalog index](./index.md) · [Documentation index](../../../index.md)

## Baseline, Method, And Claim Boundary

This is an internal field-coverage ledger for the committed `main` baseline
`a3a5f726768dac890f241a3899c0a1acb66265d9` / framework 2.1.1. It was built by
static inspection of exported TypeScript declarations, package barrels, config
resolvers, composition code, and focused tests. No config module, app, CLI,
provider, hook, database, environment file, or network path was executed.

Every row keeps declaration evidence separate from resolver/admission evidence.
A source comment that states a default does **not** by itself verify the runtime
default. `Observed resolver` means a source path was located; it does not mean a
test was run during this catalog pass. Planned guide paths are plain text until
those guides exist.

Configuration classes used below:

- **Managed**: accepted through `AppConfig` and composed by `createApp()`.
- **Public standalone**: exported options for direct trusted server construction,
  but not a field in normal managed app config.
- **Public operation**: per-call policy, not startup configuration.
- **Internal composition**: source declaration not reachable through a declared
  package subpath. It must not be presented as an application API.
- **CLI invocation**: command/programmatic invocation options, not `zero.config.ts`.

The [package export catalog](./package-exports.md) is the reachability authority.
In particular, `DatabaseCoordinatorOptions` and
`SubprocessDatabaseExecutorOptions` exist in source but are not exported from a
declared package subpath; only the selected managed Fabric types re-exported by
`@zero/framework/server` are public.

## Tracked Coverage

| Hierarchy | Classification | Field coverage in this ledger | Public route / boundary | Planned configuration owner |
| --- | --- | --- | --- | --- |
| `AppConfig` and root helper types | Managed | Complete for declared 2.1.1 fields | `@zero/framework/server` | `docs-next/backend/configuration/` |
| Guardian `AuthBehaviorConfig` hierarchy | Managed | Complete for behavior fields and nested developer policy records; plugin dependency injection is classified separately | `/server`, `/auth` | `docs-next/backend/guardian/configuration.md` |
| AI provider configuration | Managed | Complete for `AIConfig`, provider, settings, capabilities and status-route config | `/server`, `/ai` | `docs-next/backend/ai/configuration.md` |
| Vector configuration | Managed | Complete for top-level, index, query and metadata config | `/server`, `/vector` | `docs-next/backend/vector/configuration.md` |
| SQLite and ReactiveDB construction | Managed plus public standalone | Complete for `SQLiteStorageConfig`, `BufferPoolConfig`, and `ReactiveDBConfig` | `/server`, `/persistence`, `/sync` | `docs-next/backend/persistence/configuration.md`; `docs-next/backend/reactive-db/configuration.md` |
| Fabric topology, placement, actors and restart | Managed | Complete for the managed topology tree | `/server` | `docs-next/backend/fabric/configuration.md` |
| Fabric coordinator/executor constructors | Internal composition | Classified and field-mapped; intentionally not a public import | none | `docs-next/backend/fabric/architecture.md` |
| Storage and Storage Studio | Managed | Complete for the managed storage policy tree | `/server`, `/storage` | `docs-next/backend/storage/configuration.md` |
| Email, KV, PDF and observability | Managed; some direct constructors | Complete for managed trees and named nested records | `/server` plus owning subpath | owning subsystem `configuration.md` |
| Torrent workflows | Managed plus public standalone/operation | Complete for managed/plugin/start/memory/service option records | `/server`, `/workflows` | `docs-next/backend/torrent/configuration.md` |
| Doctor and main CLI programmatic options | Managed hint plus CLI invocation | Complete for Doctor, usage audit, scaffold and updater records; shell flags are listed separately | `/server`, `/doctor`; CLI source | `docs-next/cli/` |

Request payloads, result types, UI props, and ordinary SDK call options belong in
their feature/API catalogs, not here. Lower-level constructor dependency records
are included only when their classification prevents a managed-config mistake.

## Root Managed AppConfig

All declarations in this table come from
[`AppConfig`](../../../../src/frontend/server/types.ts). `defineZeroConfig()` is
a literal-preserving identity helper; runtime resolution remains in
[`resolveConfig()`](../../../../src/frontend/server/types.ts). Importing an app
config for Doctor is trusted dynamic module execution, not static inspection;
see [`config-loader.ts`](../../../../src/doctor/config-loader.ts).

| Field | Exact declared type | Resolution / destination evidence | Owner and planned guide |
| --- | --- | --- | --- |
| `AppConfig.app` | `AppIdentityConfig` | [`resolveConfig`](../../../../src/frontend/server/types.ts) passes the object to app/email composition | Platform configuration · `backend/configuration/app-identity.md` |
| `AppConfig.db` | `ReactiveDBConfig` (required) | [`resolveConfig`](../../../../src/frontend/server/types.ts); constructed through ReactiveDB/persistence by app factory | ReactiveDB/persistence · `backend/configuration/data-modes.md` |
| `AppConfig.systemDb` | `SystemDatabaseConfig` | [`resolveSystemDatabaseConfig`](../../../../src/frontend/server/system-database-config.ts) validates physical separation | Persistence/platform runtime · `backend/configuration/data-modes.md` |
| `AppConfig.databaseTopology` | `AppDatabaseTopologyConfig` | [`resolveAppDatabaseTopology`](../../../../src/frontend/server/database-topology-config.ts) | Fabric · `backend/fabric/configuration.md` |
| `AppConfig.tables` | `Record<string, AppTableInput>` (required) | [`resolveConfig`](../../../../src/frontend/server/types.ts) unwraps table definitions and admits validators | Schema/ReactiveDB · `backend/schema/tables.md` |
| `AppConfig.databaseAutomations` | `DatabaseAutomationRegistry` | [`admitDatabaseRealmAutomations`](../../../../src/databases/database-realm-automation-admission.ts) from `resolveConfig` | Database automations · `backend/database-automations/configuration.md` |
| `AppConfig.auth` | `boolean \| (AuthBehaviorConfig & { accessTokenTTL?: string; refreshTokenTTL?: string })` | [`validateAppAuthConfig`](../../../../src/frontend/server/types.ts) plus Guardian resolvers | Guardian · `backend/guardian/configuration.md` |
| `AppConfig.workflows` | `false \| AppWorkflowsConfig` | [`resolveConfig`](../../../../src/frontend/server/types.ts); managed workflow composition in app factory | Torrent · `backend/torrent/configuration.md` |
| `AppConfig.email` | `boolean \| EmailConfig` | [`resolveConfig`](../../../../src/frontend/server/types.ts); [`createEmailRuntime`](../../../../src/email/runtime.ts) | Email · `backend/email/configuration.md` |
| `AppConfig.ai` | `boolean \| AIConfig` | [`resolveAIConfig`](../../../../src/ai/ai-env.ts) | AI · `backend/ai/configuration.md` |
| `AppConfig.vector` | `boolean \| VectorConfig` | [`resolveVectorConfig`](../../../../src/vector/vector-config.ts) | Vector · `backend/vector/configuration.md` |
| `AppConfig.kv` | `boolean \| KvServiceConfig` | [`resolveKvConfig`](../../../../src/frontend/server/types.ts), then `KvService` | KV · `backend/kv/configuration.md` |
| `AppConfig.pdf` | `boolean \| PdfConfig` | [`resolvePdfConfig`](../../../../src/pdf/pdf-config.ts) | PDF · `backend/pdf/configuration.md` |
| `AppConfig.stateSync` | `boolean` | [`resolveConfig`](../../../../src/frontend/server/types.ts) validates the auth interaction | Sync · `backend/sync/configuration.md` |
| `AppConfig.syncAuth` | `SyncAuthMode` | [`resolveConfig`](../../../../src/frontend/server/types.ts) derives and validates auth mode | Sync · `backend/sync/configuration.md` |
| `AppConfig.syncPolicy` | `SyncPolicy` | Passed through by [`resolveConfig`](../../../../src/frontend/server/types.ts), evaluated by Sync policy code | Sync · `backend/sync/authorization.md` |
| `AppConfig.ephemeralPolicy` | `EphemeralTopicPolicy` | Passed through by [`resolveConfig`](../../../../src/frontend/server/types.ts), evaluated by ephemeral policy code | Sync · `backend/sync/ephemeral.md` |
| `AppConfig.resources` | `readonly ResourceDefinition[]` | [`resolveConfig`](../../../../src/frontend/server/types.ts) plus resource registry validation | Resources · `backend/resources/configuration.md` |
| `AppConfig.resourceRoutes` | `boolean \| ResourceCrudRoutesConfig` | [`resolveConfig`](../../../../src/frontend/server/types.ts); CRUD plugin validates route policy | Resources · `backend/resources/configuration.md` |
| `AppConfig.syncDefaults` | `SyncDefaultsConfig` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts), then startup mode resolution | Sync · `backend/sync/configuration.md` |
| `AppConfig.storageDir` | `string` | [`resolveConfig`](../../../../src/frontend/server/types.ts); directory isolation validation | Storage/platform configuration · `backend/configuration/directories.md` |
| `AppConfig.storage` | `AppStorageConfig` | [`resolveAppStorageConfig`](../../../../src/storage/storage-config.ts) | Storage · `backend/storage/configuration.md` |
| `AppConfig.appDir` | `string` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by file router | Platform configuration · `backend/configuration/directories.md` |
| `AppConfig.outDir` | `string` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by bundle/artifact paths | Platform configuration · `backend/configuration/directories.md` |
| `AppConfig.generatedDir` | `string` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by generated glue | Platform configuration · `backend/configuration/directories.md` |
| `AppConfig.serverPluginsDir` | `string \| false` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by server module loader | Platform runtime · `backend/configuration/directories.md` |
| `AppConfig.serverMiddlewareDir` | `string \| false` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by server module loader | Platform runtime · `backend/configuration/directories.md` |
| `AppConfig.serverEndpointsDir` | `string \| false` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by server module loader | Platform runtime · `backend/configuration/directories.md` |
| `AppConfig.serverRoutesDir` | `string \| false` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by server module loader | Platform runtime · `backend/configuration/directories.md` |
| `AppConfig.serverResourcesDir` | `string \| false` | [`resolveConfig`](../../../../src/frontend/server/types.ts); resource discovery and Doctor loader | Resources/platform configuration · `backend/configuration/directories.md` |
| `AppConfig.port` | `number` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by app listen boundary | Platform runtime · `backend/configuration/runtime.md` |
| `AppConfig.migrate` | `boolean` | [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by startup migration boundary | Migrations · `backend/migrations/configuration.md` |
| `AppConfig.observability` | `ObservabilityConfig \| false` | Passed through by [`resolveConfig`](../../../../src/frontend/server/types.ts), normalized during observability composition | Observability · `backend/observability/configuration.md` |
| `AppConfig.publicPaths` | `string[]` | [`defaultPublicPaths`](../../../../src/frontend/server/types.ts) and route-auth evaluation | Router/Guardian · `backend/configuration/routing.md` |
| `AppConfig.routeAuth` | `RouteAuthMode` | [`resolveRouteAuthMode`](../../../../src/frontend/router/auth-policy.ts) | Router/Guardian · `backend/configuration/routing.md` |
| `AppConfig.sitemap` | `boolean \| SitemapConfig` | [`resolveSitemapConfig`](../../../../src/frontend/server/types.ts) | Router · `backend/configuration/sitemap.md` |
| `AppConfig.loginPath` | `string` | [`normalizeConfiguredAuthPath`](../../../../src/frontend/server/types.ts) | Guardian/router · `backend/configuration/routing.md` |
| `AppConfig.registrationPath` | `string` | [`normalizeConfiguredAuthPath`](../../../../src/frontend/server/types.ts) | Guardian/router · `backend/configuration/routing.md` |
| `AppConfig.postLoginPath` | `string` | [`normalizeConfiguredAuthPath`](../../../../src/frontend/server/types.ts) and login-path collision check | Guardian/router · `backend/configuration/routing.md` |
| `AppConfig.doctor` | `AppDoctorConfig` | Passed through by [`resolveConfig`](../../../../src/frontend/server/types.ts), consumed by Doctor | Doctor · `cli/doctor/configuration.md` |

### Root Helper Records

| Type and field | Exact declared type | Resolver / admission evidence | Owner and planned guide |
| --- | --- | --- | --- |
| `AppIdentityConfig.name` | `string` | [`resolveAuthEmailBranding`](../../../../src/auth/auth-email-templates.ts) and email runtime | Platform/email · `backend/configuration/app-identity.md` |
| `AppIdentityConfig.publicUrl` | `string` | [`resolveAuthEmailBranding`](../../../../src/auth/auth-email-templates.ts) | Platform/email · `backend/configuration/app-identity.md` |
| `AppIdentityConfig.supportEmail` | `string` | [`resolveAuthEmailBranding`](../../../../src/auth/auth-email-templates.ts) | Platform/email · `backend/configuration/app-identity.md` |
| `TableSyncDefaultConfig.mode` | `DeclaredSyncMode` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `TableSyncDefaultConfig.rowLimit` | `number` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `TableSyncDefaultConfig.action` | `AutoLazyAction` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `TableSyncDefaultConfig.persist` | `boolean` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `SyncDefaultsConfig.defaultMode` | `DeclaredSyncMode` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `SyncDefaultsConfig.autoLazy` | `{ rowLimit?: number; action?: AutoLazyAction; persist?: boolean }` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts); nested fields validated separately | Sync · `backend/sync/configuration.md` |
| `SyncDefaultsConfig.autoLazy.rowLimit` | `number` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `SyncDefaultsConfig.autoLazy.action` | `AutoLazyAction` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `SyncDefaultsConfig.autoLazy.persist` | `boolean` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `SyncDefaultsConfig.tables` | `Record<string, DeclaredSyncMode \| TableSyncDefaultConfig>` | [`normalizeSyncDefaults`](../../../../src/frontend/server/types.ts) | Sync · `backend/sync/configuration.md` |
| `ResourceCrudRoutesConfig.prefix` | `string` | [`resource-crud.plugin.ts`](../../../../src/resources/resource-crud.plugin.ts) | Resources · `backend/resources/configuration.md` |
| `ResourceCrudRoutesConfig.defaultLimit` | `number` | [`resource-crud.plugin.ts`](../../../../src/resources/resource-crud.plugin.ts) | Resources · `backend/resources/configuration.md` |
| `ResourceCrudRoutesConfig.maxLimit` | `number` | [`resource-crud.plugin.ts`](../../../../src/resources/resource-crud.plugin.ts) | Resources · `backend/resources/configuration.md` |
| `SitemapConfig.enabled` | `boolean` | [`resolveSitemapConfig`](../../../../src/frontend/server/types.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapConfig.path` | `string` | [`normalizeSitemapPath`](../../../../src/frontend/server/types.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapConfig.changefreq` | `SitemapChangeFrequency` | [`resolveSitemapConfig`](../../../../src/frontend/server/types.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapConfig.priority` | `number` | [`resolveSitemapConfig`](../../../../src/frontend/server/types.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapConfig.entries` | `readonly SitemapEntry[]` | [`resolveSitemapConfig`](../../../../src/frontend/server/types.ts), sitemap generator | Router · `backend/configuration/sitemap.md` |
| `SitemapConfig.exclude` | `readonly string[]` | [`resolveSitemapConfig`](../../../../src/frontend/server/types.ts), sitemap generator | Router · `backend/configuration/sitemap.md` |
| `SitemapEntry.href` | `string` | [`sitemap.ts`](../../../../src/frontend/server/sitemap.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapEntry.lastmod` | `string \| Date` | [`sitemap.ts`](../../../../src/frontend/server/sitemap.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapEntry.changefreq` | `SitemapChangeFrequency` | [`sitemap.ts`](../../../../src/frontend/server/sitemap.ts) | Router · `backend/configuration/sitemap.md` |
| `SitemapEntry.priority` | `number` | [`sitemap.ts`](../../../../src/frontend/server/sitemap.ts) | Router · `backend/configuration/sitemap.md` |
| `AppDoctorConfig.indexedFields` | `Record<string, readonly string[]>` | [`platform-doctor.ts`](../../../../src/doctor/platform-doctor.ts) | Doctor · `cli/doctor/configuration.md` |

## Guardian Auth Behavior Configuration

`AuthBehaviorConfig` and its developer policy records are exported from
`@zero/framework/auth` and re-exported through `/server` for `AppConfig.auth`.
The app-only token TTL fields are declared at the `AppConfig.auth` intersection,
not on `AuthBehaviorConfig`. Guardian resolution is split intentionally across
focused config modules beginning at
[`auth-config.ts`](../../../../src/auth/auth-config.ts).

### Root, Bootstrap, Registration, Audit, And API Keys

| Type and field | Exact declared type | Resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `AuthBehaviorConfig.audit` | `AuthAuditConfig` | [`resolveAuthBehaviorConfig`](../../../../src/auth/auth-config.ts), audit resolver | `backend/guardian/audit.md` |
| `AuthBehaviorConfig.tenancy` | `AuthTenancyConfig` | [`auth-config-tenancy.ts`](../../../../src/auth/auth-config-tenancy.ts) | `backend/guardian/tenancy.md` |
| `AuthBehaviorConfig.authorization` | `AuthAuthorizationConfig` | [`auth-config-authorization.ts`](../../../../src/auth/auth-config-authorization.ts) | `backend/guardian/rbac.md` |
| `AuthBehaviorConfig.registration` | `AuthRegistrationConfig` | [`auth-config.ts`](../../../../src/auth/auth-config.ts) | `backend/guardian/registration.md` |
| `AuthBehaviorConfig.bootstrap` | `AuthBootstrapConfig` | [`auth-config-account.ts`](../../../../src/auth/auth-config-account.ts) | `backend/guardian/bootstrap.md` |
| `AuthBehaviorConfig.requestAdmission` | `AuthRequestAdmissionConfig` | [`auth-request-admission-config.ts`](../../../../src/auth/auth-request-admission-config.ts) | `backend/guardian/request-admission.md` |
| `AuthBehaviorConfig.account` | `AuthAccountConfig` | [`auth-config-account.ts`](../../../../src/auth/auth-config-account.ts) | `backend/guardian/accounts.md` |
| `AuthBehaviorConfig.mfa` | `AuthMfaConfig` | [`auth-config-account.ts`](../../../../src/auth/auth-config-account.ts) | `backend/guardian/mfa.md` |
| `AuthBehaviorConfig.accountEmails` | `AuthAccountEmailConfig` | [`auth-config-email.ts`](../../../../src/auth/auth-config-email.ts) | `backend/guardian/account-email.md` |
| `AuthBehaviorConfig.branding` | `AuthEmailBrandingConfig` | [`resolveAuthEmailBranding`](../../../../src/auth/auth-email-templates.ts) | `backend/guardian/account-email.md` |
| `AuthBehaviorConfig.emails` | `AuthEmailTemplates` | [`auth-email-templates.ts`](../../../../src/auth/auth-email-templates.ts), email dispatch services | `backend/guardian/account-email.md` |
| `AuthBehaviorConfig.userProperties` | `Record<string, UserPropertyFieldConfig>` | [`auth-config-user-properties.ts`](../../../../src/auth/auth-config-user-properties.ts) | `backend/guardian/properties.md` |
| `AuthBehaviorConfig.strictUserProperties` | `boolean` | [`auth-config-user-properties.ts`](../../../../src/auth/auth-config-user-properties.ts) | `backend/guardian/properties.md` |
| `AuthBehaviorConfig.nativeApps` | `NativeAuthConfig` | [`native/config.ts`](../../../../src/auth/native/config.ts) | `backend/guardian/native-provider.md` |
| `AuthBehaviorConfig.apiKeys` | `AuthApiKeyConfig` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |
| `AppConfig.auth.accessTokenTTL` | `string` | [`validateAppAuthConfig`](../../../../src/frontend/server/types.ts), token service construction | `backend/guardian/sessions.md` |
| `AppConfig.auth.refreshTokenTTL` | `string` | [`validateAppAuthConfig`](../../../../src/frontend/server/types.ts), token service construction | `backend/guardian/sessions.md` |
| `AuthAuditConfig.retentionDays` | `number` | [`auth-audit-config.ts`](../../../../src/auth/auth-audit-config.ts) | `backend/guardian/audit.md` |
| `AuthAuditConfig.pruneBatchSize` | `number` | [`auth-audit-config.ts`](../../../../src/auth/auth-audit-config.ts) | `backend/guardian/audit.md` |
| `AuthAuditConfig.pruneInterval` | `string` | [`auth-audit-config.ts`](../../../../src/auth/auth-audit-config.ts) | `backend/guardian/audit.md` |
| `AuthBootstrapOptions.mode` | `AuthBootstrapMode` | [`auth-config-account.ts`](../../../../src/auth/auth-config-account.ts) | `backend/guardian/bootstrap.md` |
| `AuthBootstrapOptions.secret` | `string` | [`auth-config-account.ts`](../../../../src/auth/auth-config-account.ts); server-only and never projected | `backend/guardian/bootstrap.md` |
| `AuthRegistrationConfig.mode` | `AuthRegistrationMode` | [`auth-config.ts`](../../../../src/auth/auth-config.ts) | `backend/guardian/registration.md` |
| `AuthApiKeyOptions.enabled` | `boolean` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |
| `AuthApiKeyOptions.selfService` | `boolean` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |
| `AuthApiKeyOptions.administratorIssuance` | `boolean` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |
| `AuthApiKeyOptions.eligibleScopeRoles` | `readonly string[]` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) and live role admission | `backend/guardian/api-keys.md` |
| `AuthApiKeyOptions.defaultTTL` | `string` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |
| `AuthApiKeyOptions.maxTTL` | `string` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |
| `AuthApiKeyOptions.maxActivePerUser` | `number` | [`auth-api-key-config.ts`](../../../../src/auth/auth-api-key-config.ts) | `backend/guardian/api-keys.md` |

### Tenancy And Onboarding

| Type and field | Exact declared type | Resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `AuthTenancyOptions.mode` | `AuthTenancyMode` | [`auth-config-tenancy.ts`](../../../../src/auth/auth-config-tenancy.ts) | `backend/guardian/tenancy.md` |
| `AuthTenancyOptions.terminology` | `AuthTenantTerminologyConfig` | `auth-config-tenancy.ts` | `backend/guardian/tenancy.md` |
| `AuthTenancyOptions.creation` | `AuthTenantCreationConfig` | `auth-config-tenancy.ts` | `backend/guardian/tenancy.md` |
| `AuthTenancyOptions.onboarding` | `AuthTenantOnboardingConfig` | [`auth-tenant-onboarding-config.ts`](../../../../src/auth/auth-tenant-onboarding-config.ts) | `backend/guardian/onboarding.md` |
| `AuthTenancyOptions.administration` | `AuthAdministrationTenantConfig` | `auth-config-tenancy.ts` and administration-tenant reconciliation | `backend/guardian/control-plane.md` |
| `AuthTenantTerminologyConfig.singular` | `string` | `auth-config-tenancy.ts` | `backend/guardian/tenancy.md` |
| `AuthTenantTerminologyConfig.plural` | `string` | `auth-config-tenancy.ts` | `backend/guardian/tenancy.md` |
| `AuthTenantCreationConfig.mode` | `AuthTenantCreationMode` | `auth-config-tenancy.ts` | `backend/guardian/tenancy.md` |
| `AuthAdministrationTenantConfig.adoptTenantId` | `string` | `auth-config-tenancy.ts` and administration-tenant reconciliation | `backend/guardian/control-plane.md` |
| `AuthTenantOnboardingConfig.invitations` | nested invitation policy object | [`auth-tenant-onboarding-config.ts`](../../../../src/auth/auth-tenant-onboarding-config.ts) | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.enabled` | `boolean` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.defaultTTL` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.maxTTL` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.accountCreation` | `boolean` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery` | nested delivery policy object | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.default` | `AuthTenantInvitationDeliveryMode` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.allowManual` | `boolean` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.email` | nested email policy object | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.email.enabled` | `boolean` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.email.landingPath` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.email.encryptionKey` | `string` | `auth-tenant-onboarding-config.ts`; server-only wrapping key | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.email.previousEncryptionKeys` | `string[]` | `auth-tenant-onboarding-config.ts`; server-only rotation input | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.invitations.delivery.email.template` | `AuthTenantInvitationEmailTemplate` | `auth-tenant-onboarding-config.ts`, invitation email dispatch | `backend/guardian/invitations.md` |
| `AuthTenantOnboardingConfig.joinRequests` | nested join-request policy object | `auth-tenant-onboarding-config.ts` | `backend/guardian/join-requests.md` |
| `AuthTenantOnboardingConfig.joinRequests.enabled` | `boolean` | `auth-tenant-onboarding-config.ts` | `backend/guardian/join-requests.md` |
| `AuthTenantOnboardingConfig.verifiedDomains` | `AuthVerifiedDomainOnboardingConfig` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.enabled` | `boolean` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.allowedRequestRoles` | `readonly string[]` | `auth-tenant-onboarding-config.ts` and role admission | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.defaultRequestRole` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.challengeTTL` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.dnsCheckCooldown` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.reverifyInterval` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.gracePeriod` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.reverifyRetryInterval` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.mailboxProofMaxAge` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.mailboxLinkTTL` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.admissionTTL` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.deniedRetryCooldown` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.mailboxLandingPath` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.sharedMailboxDomains` | `readonly string[]` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.resolveTxt` | `AuthVerifiedDomainTxtResolver` | `auth-tenant-onboarding-config.ts`, verified-domain service | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.dnsTimeout` | `string` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.maxTxtAnswers` | `number` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.maxTxtBytes` | `number` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |
| `AuthVerifiedDomainOnboardingConfig.maxClaimsPerTenant` | `number` | `auth-tenant-onboarding-config.ts` | `backend/guardian/verified-domains.md` |

### Authorization And User Properties

| Type and field | Exact declared type | Resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `AuthAuthorizationOptions.mode` | `AuthAuthorizationMode` | [`auth-config-authorization.ts`](../../../../src/auth/auth-config-authorization.ts) | `backend/guardian/rbac.md` |
| `AuthAuthorizationOptions.registryVersion` | `number` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthAuthorizationOptions.permissions` | `Record<PermissionKey, AuthPermissionConfig>` | `auth-config-authorization.ts` and authorization registry | `backend/guardian/rbac.md` |
| `AuthAuthorizationOptions.roles` | `Record<string, AuthRoleTemplateConfig>` | `auth-config-authorization.ts` and authorization registry | `backend/guardian/rbac.md` |
| `AuthAuthorizationOptions.ownerAdoption` | `AuthAuthorizationOwnerAdoptionConfig` | `auth-config-authorization.ts` and owner reconciliation | `backend/guardian/control-plane.md` |
| `AuthAuthorizationOptions.legacySimpleRoleAdoption` | `true` | `auth-config-authorization.ts` and installed-profile reconciliation | `backend/guardian/upgrading.md` |
| `AuthPermissionConfig.label` | `string` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthPermissionConfig.description` | `string` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthPermissionConfig.scope` | `AuthPermissionScope` | `auth-config-authorization.ts` and live authorization kernel | `backend/guardian/rbac.md` |
| `AuthRoleTemplateConfig.label` | `string` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthRoleTemplateConfig.description` | `string` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthRoleTemplateConfig.permissions` | `readonly PermissionKey[]` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthRoleTemplateConfig.allPermissions` | `boolean` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthRoleTemplateConfig.system` | `boolean` | `auth-config-authorization.ts` | `backend/guardian/rbac.md` |
| `AuthAuthorizationOwnerAdoptionConfig.userId` | `string` | `auth-config-authorization.ts`; mutually exclusive target | `backend/guardian/control-plane.md` |
| `AuthAuthorizationOwnerAdoptionConfig.email` | `string` | `auth-config-authorization.ts`; mutually exclusive target | `backend/guardian/control-plane.md` |
| `UserPropertyFieldConfig.type` | `UserPropertyFieldType` | [`auth-config-user-properties.ts`](../../../../src/auth/auth-config-user-properties.ts) | `backend/guardian/properties.md` |
| `UserPropertyFieldConfig.label` | `string` | `auth-config-user-properties.ts` | `backend/guardian/properties.md` |
| `UserPropertyFieldConfig.values` | `string[]` | `auth-config-user-properties.ts` | `backend/guardian/properties.md` |
| `UserPropertyFieldConfig.default` | `string \| number \| boolean` | `auth-config-user-properties.ts` | `backend/guardian/properties.md` |
| `UserPropertyFieldConfig.editableBy` | `UserPropertyEditableBy` | `auth-config-user-properties.ts` and property service | `backend/guardian/properties.md` |
| `UserPropertyFieldConfig.useInPolicies` | `boolean` | `auth-config-user-properties.ts` and trusted-policy-key admission | `backend/guardian/properties.md` |
| `UserPropertyFieldConfig.description` | `string` | `auth-config-user-properties.ts` | `backend/guardian/properties.md` |

### Account Lifecycle, MFA, And Email Branding

| Type and field | Exact declared type | Resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `AuthAccountConfig.requireEmailVerification` | `boolean` | [`auth-config-account.ts`](../../../../src/auth/auth-config-account.ts) | `backend/guardian/accounts.md` |
| `AuthAccountConfig.emailVerificationPath` | `string` | `auth-config-account.ts` | `backend/guardian/accounts.md` |
| `AuthAccountConfig.allowAdminMarkEmailVerified` | `boolean` | `auth-config-account.ts` | `backend/guardian/accounts.md` |
| `AuthAccountEmailConfig.adminCreatedUser` | `boolean` | [`auth-config-email.ts`](../../../../src/auth/auth-config-email.ts) | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.passwordReset` | `boolean` | `auth-config-email.ts` | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.passwordChangedNotice` | `boolean` | `auth-config-email.ts`; resolver currently constrains reserved behavior | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.manualPasswordReset` | `boolean` | `auth-config-email.ts` | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.actionTokenTTL` | `string` | `auth-config-email.ts` | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.requestCooldown` | `string` | `auth-config-email.ts` | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.resetPath` | `string` | `auth-config-email.ts` | `backend/guardian/account-email.md` |
| `AuthAccountEmailConfig.setupPath` | `string` | `auth-config-email.ts` | `backend/guardian/account-email.md` |
| `AuthMfaConfig.enabled` | `boolean` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.policy` | `AuthMfaPolicy` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.methods` | `AuthMfaMethodType[]` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.allowUserChoice` | `boolean` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.allowMultipleMethods` | `boolean` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.rememberDevice` | `boolean` | `auth-config-account.ts`; reserved behavior must be documented exactly | `backend/guardian/mfa.md` |
| `AuthMfaConfig.challengeTTL` | `string` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.challengeCooldown` | `string` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.maxAttempts` | `number` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaConfig.recoveryCodes` | `boolean` | `auth-config-account.ts`; reserved behavior must be documented exactly | `backend/guardian/mfa.md` |
| `AuthMfaConfig.totp` | `AuthMfaTotpConfig` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaTotpConfig.issuer` | `string` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthMfaTotpConfig.encryptionKey` | `string` | `auth-config-account.ts`; server-only | `backend/guardian/mfa.md` |
| `AuthMfaTotpConfig.qrRobustness` | `AuthMfaQrRobustness` | `auth-config-account.ts` | `backend/guardian/mfa.md` |
| `AuthEmailBrandingConfig.appName` | `string` | [`resolveAuthEmailBranding`](../../../../src/auth/auth-email-templates.ts) | `backend/guardian/account-email.md` |
| `AuthEmailBrandingConfig.publicUrl` | `string` | `resolveAuthEmailBranding` | `backend/guardian/account-email.md` |
| `AuthEmailBrandingConfig.logoUrl` | `string` | `resolveAuthEmailBranding` | `backend/guardian/account-email.md` |
| `AuthEmailBrandingConfig.supportEmail` | `string` | `resolveAuthEmailBranding` | `backend/guardian/account-email.md` |
| `AuthEmailBrandingConfig.brandColor` | `string` | `resolveAuthEmailBranding` | `backend/guardian/account-email.md` |
| `AuthEmailTemplates[templateKey]` | `AuthEmailTemplate` | `defineAuthEmailTemplates` identity helper plus dispatch-time rendering | `backend/guardian/account-email.md` |

### Public Request Admission And Native Clients

| Type and field | Exact declared type | Resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `AuthRequestAdmissionConfig.enabled` | `boolean` | [`auth-request-admission-config.ts`](../../../../src/auth/auth-request-admission-config.ts) | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.cleanupBatchSize` | `number` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.trustedProxyRanges` | `readonly string[]` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.forwardedForHeader` | `string` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.sourceKey` | `AuthRequestSourceResolver` | `auth-request-admission-config.ts`; mutually exclusive deployment seam | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.bootstrap` | `AuthRequestAdmissionFlowConfig` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.registration` | `AuthRequestAdmissionFlowConfig` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.login` | `AuthRequestAdmissionFlowConfig` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.invitation` | `AuthRequestAdmissionFlowConfig` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.joinRequest` | `AuthRequestAdmissionFlowConfig` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionConfig.domainOnboarding` | `AuthRequestAdmissionFlowConfig` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionFlowConfig.window` | `string` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionFlowConfig.maxGlobal` | `number` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionFlowConfig.maxPerSource` | `number` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `AuthRequestAdmissionFlowConfig.maxPerSubject` | `number` | `auth-request-admission-config.ts` | `backend/guardian/request-admission.md` |
| `NativeAuthConfig.enabled` | `boolean` | [`native/config.ts`](../../../../src/auth/native/config.ts) | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.issuer` | `string` | `native/config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.requestTTL` | `string` | `native/config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.codeTTL` | `string` | `native/config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.refreshTokenTTL` | `string` | `native/config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.requestAdmission` | `NativeAuthorizationRequestPolicyConfig` | [`native/policy-config.ts`](../../../../src/auth/native/policy-config.ts) | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.refreshRotation` | `NativeRefreshRotationPolicyConfig` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthConfig.clients` | `readonly NativeAuthClientConfig[]` | `native/config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthClientConfig.clientId` | `string` (required) | `native/config.ts` | `backend/guardian/native-clients.md` |
| `NativeAuthClientConfig.name` | `string` (required) | `native/config.ts` | `backend/guardian/native-clients.md` |
| `NativeAuthClientConfig.redirectUris` | `readonly string[]` (required) | `native/config.ts`, redirect validation | `backend/guardian/native-clients.md` |
| `NativeAuthClientConfig.scopes` | `readonly NativeIdentityScope[]` | `native/config.ts` | `backend/guardian/native-clients.md` |
| `NativeAuthorizationRequestPolicyConfig.cleanupBatchSize` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.maxOutstandingGlobal` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.maxOutstandingPerClient` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.maxOutstandingPerSource` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.rollingWindow` | `string` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.maxAdmissionsGlobal` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.maxAdmissionsPerClient` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.maxAdmissionsPerSource` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.trustedProxyRanges` | `readonly string[]` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.forwardedForHeader` | `string` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeAuthorizationRequestPolicyConfig.sourceKey` | `NativeAuthorizationSourceResolver` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeRefreshRotationPolicyConfig.cleanupBatchSize` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeRefreshRotationPolicyConfig.minRotationInterval` | `string` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeRefreshRotationPolicyConfig.maxRotationsPerFamily` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |
| `NativeRefreshRotationPolicyConfig.maxActiveFamiliesPerUserClient` | `number` | `native/policy-config.ts` | `backend/guardian/native-provider.md` |

`AuthPluginConfig` extends this behavior tree but also requires runtime/service
dependencies (`db`, token/runtime/email/platform-token callbacks, and lifecycle
hooks). It is a public standalone plugin composition boundary from `/auth`, not
a shape applications should paste under `AppConfig.auth`; managed composition
supplies those dependencies.

## AI Configuration

These are managed through `AppConfig.ai`; the same declarations are exported by
`@zero/framework/ai`. Resolution is split across
[`ai-env.ts`](../../../../src/ai/ai-env.ts), provider resolution/selection
modules, and the static [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts).
The catalog is static metadata, not a live provider model/pricing catalog or a
database-backed provider settings control plane.

| Type and field | Exact declared type | Resolver / admission evidence | Planned guide |
| --- | --- | --- | --- |
| `AIConfig.autoDetect` | `boolean` | [`resolveAIConfig`](../../../../src/ai/ai-env.ts) | `backend/ai/configuration.md#provider-detection` |
| `AIConfig.providers` | `Record<string, AIProviderConfig \| false>` | [`resolveExplicitAIProviders`](../../../../src/ai/ai-env-provider-resolution.ts) | `backend/ai/configuration.md#providers` |
| `AIConfig.aliases` | `Record<string, string>` | [`resolveAIEnvAliases`](../../../../src/ai/ai-env-selection.ts) | `backend/ai/configuration.md#aliases` |
| `AIConfig.filesProvider` | `string` | [`resolveAIEnvFilesProvider`](../../../../src/ai/ai-env-selection.ts) | `backend/ai/configuration.md#hosted-files` |
| `AIConfig.statusEndpoint` | `false \| AIStatusEndpointConfig` | [`resolveAIConfig`](../../../../src/ai/ai-env.ts), mounted by AI plugin | `backend/ai/configuration.md#status-endpoint` |
| `AIProviderConfig.type` | `AIProviderType` (required) | [`ai-env-provider-resolution.ts`](../../../../src/ai/ai-env-provider-resolution.ts) and provider factory | `backend/ai/configuration.md#providers` |
| `AIProviderConfig.enabled` | `boolean` | [`ai-env-provider-resolution.ts`](../../../../src/ai/ai-env-provider-resolution.ts) | `backend/ai/configuration.md#activation` |
| `AIProviderConfig.apiKey` | `string \| null` | [`ai-env-provider-resolution.ts`](../../../../src/ai/ai-env-provider-resolution.ts); server-only | `backend/ai/configuration.md#credentials` |
| `AIProviderConfig.baseURL` | `string \| null` | [`ai-env-provider-endpoints.ts`](../../../../src/ai/ai-env-provider-endpoints.ts) | `backend/ai/configuration.md#endpoints` |
| `AIProviderConfig.headers` | `Record<string, string>` | [`createAIProviderFactory`](../../../../src/ai/ai-provider-factory.ts) dispatches to type-specific adapters | `backend/ai/configuration.md#providers` |
| `AIProviderConfig.fetch` | `AIFetchFunction` | [`createAIProviderFactory`](../../../../src/ai/ai-provider-factory.ts) dispatches to type-specific adapters | `backend/ai/configuration.md#advanced-provider-construction` |
| `AIProviderConfig.settings` | `AIProviderInstanceSettings` | [`ai-env-provider-resolution.ts`](../../../../src/ai/ai-env-provider-resolution.ts) and type-specific factories | `backend/ai/configuration.md#provider-settings` |
| `AIProviderConfig.capabilities` | `Partial<AIProviderCapabilities>` | Provider resolution/catalog validation | `backend/ai/configuration.md#capabilities` |
| `AIProviderConfig.adapter` | `AICustomProviderAdapter` | Custom-provider factory boundary | `backend/ai/configuration.md#custom-providers` |
| `AIStatusEndpointConfig.enabled` | `boolean` | [`resolveAIConfig`](../../../../src/ai/ai-env.ts) | `backend/ai/configuration.md#status-endpoint` |
| `AIStatusEndpointConfig.basePath` | `string` | [`resolveAIConfig`](../../../../src/ai/ai-env.ts), AI plugin | `backend/ai/configuration.md#status-endpoint` |
| `AIStatusEndpointConfig.read` | `AIStatusEndpointReadMode` | [`ai.plugin.ts`](../../../../src/ai/ai.plugin.ts) | `backend/ai/configuration.md#status-endpoint` |

### AI Provider Instance Settings

Each setting below is declared on
[`AIProviderInstanceSettings`](../../../../src/ai/ai-provider-types.ts).
Unsupported settings are rejected for the selected provider type during explicit
provider resolution; this record is not a bag of universally forwarded values.

| Field | Exact declared type | Owning provider/resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `teamIdOrSlug` | `string` | Gateway factory/catalog | `backend/ai/providers/gateway.md` |
| `authToken` | `string` | Anthropic resolution/factory | `backend/ai/providers/anthropic.md` |
| `workspaceId` | `string` | Anthropic AWS resolution/factory | `backend/ai/providers/anthropic-aws.md` |
| `region` | `string` | AWS/Bedrock provider factories | `backend/ai/providers/aws.md` |
| `runtimeBaseURL` | `string` | Bedrock runtime endpoint resolution | `backend/ai/providers/bedrock.md` |
| `agentRuntimeBaseURL` | `string` | Bedrock agent-runtime/reranking endpoint resolution | `backend/ai/providers/bedrock.md` |
| `accessKeyId` | `string` | AWS-authenticated provider factories | `backend/ai/providers/aws.md` |
| `secretAccessKey` | `string` | AWS-authenticated provider factories; server-only | `backend/ai/providers/aws.md` |
| `sessionToken` | `string` | AWS-authenticated provider factories; server-only | `backend/ai/providers/aws.md` |
| `credentialProvider` | `AIAwsCredentialProvider` | AWS-authenticated provider factories | `backend/ai/providers/aws.md` |
| `accessKey` | `string` | Kling compatibility resolution/factory | `backend/ai/providers/kling.md` |
| `secretKey` | `string` | Kling compatibility resolution/factory; server-only | `backend/ai/providers/kling.md` |
| `resourceName` | `string` | Azure factory | `backend/ai/providers/azure.md` |
| `tokenProvider` | `AIAzureTokenProvider` | Azure factory | `backend/ai/providers/azure.md` |
| `apiVersion` | `string` | Azure factory | `backend/ai/providers/azure.md` |
| `speechBaseURL` | `string` | Azure speech factory | `backend/ai/providers/azure.md` |
| `useDeploymentBasedUrls` | `boolean` | Azure factory | `backend/ai/providers/azure.md` |
| `project` | `string` | Google Vertex factory/catalog | `backend/ai/providers/google-vertex.md` |
| `location` | `string` | Google Vertex factory/catalog | `backend/ai/providers/google-vertex.md` |
| `googleAuthOptions` | `GoogleVertexProviderSettings['googleAuthOptions']` | Google Vertex factory | `backend/ai/providers/google-vertex.md` |
| `metadataCacheRefreshMillis` | `number` | Gateway factory | `backend/ai/providers/gateway.md` |
| `strictResponseInput` | `boolean` | Open Responses factory | `backend/ai/providers/open-responses.md` |
| `modelURL` | `string` | Baseten factory | `backend/ai/providers/baseten.md` |
| `performanceClient` | `BasetenProviderSettings['performanceClient']` | Baseten factory | `backend/ai/providers/baseten.md` |
| `embeddingBaseURL` | `string` | Alibaba factory | `backend/ai/providers/alibaba.md` |
| `videoBaseURL` | `string` | Alibaba/MiniMax factories | `backend/ai/providers/media.md` |
| `includeUsage` | `boolean` | Supporting provider factories | `backend/ai/configuration.md#provider-settings` |
| `pollIntervalMillis` | `number` | Asynchronous media provider factories | `backend/ai/media/video.md` |
| `pollTimeoutMillis` | `number` | Asynchronous media provider factories | `backend/ai/media/video.md` |
| `generateId` | `() => string` | Supporting provider factories | `backend/ai/configuration.md#provider-settings` |
| `version` | `string` | Cartesia factory | `backend/ai/providers/cartesia.md` |
| `webSocket` | `CartesiaProviderSettings['webSocket']` | Cartesia factory | `backend/ai/providers/cartesia.md` |

### AI Capability And Catalog Metadata Fields

| Type and field | Exact declared type | Owning evidence | Planned guide |
| --- | --- | --- | --- |
| `AIProviderCapabilities.text` | `boolean` (required) | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts), registry validation | `backend/ai/configuration.md#capabilities` |
| `AIProviderCapabilities.streaming` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.tools` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.vision` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.embeddings` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.images` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.transcription` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.speech` | `boolean` (required) | provider catalog/registry | same guide |
| `AIProviderCapabilities.reranking` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.video` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.files` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.fileMetadata` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.fileDownload` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.fileDelete` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.skills` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.realtime` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.evaluation` | `boolean` | provider catalog/registry | same guide |
| `AIProviderCapabilities.batch` | `boolean` | provider catalog/registry | same guide |
| `AIProviderSettingEnvKeys.runtimeBaseURL` | `readonly string[]` | provider catalog; static env-key metadata | `backend/ai/configuration.md#provider-environment` |
| `AIProviderSettingEnvKeys.agentRuntimeBaseURL` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.authToken` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.workspaceId` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.region` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.accessKeyId` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.secretAccessKey` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.sessionToken` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.accessKey` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.secretKey` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.resourceName` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.project` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderSettingEnvKeys.location` | `readonly string[]` | provider catalog; static env-key metadata | same guide |
| `AIProviderCatalogEntry.id` | `string` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); stable built-in provider id | `backend/ai/configuration.md#provider-catalog` |
| `AIProviderCatalogEntry.type` | `AIProviderType` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); adapter factory selection | same guide |
| `AIProviderCatalogEntry.displayName` | `string` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); public-safe status metadata | same guide |
| `AIProviderCatalogEntry.envKeys` | `readonly string[]` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); static auto-detection metadata | `backend/ai/configuration.md#provider-environment` |
| `AIProviderCatalogEntry.baseURL` | `string` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); static provider endpoint metadata | `backend/ai/configuration.md#provider-catalog` |
| `AIProviderCatalogEntry.activation` | `AIProviderActivationKind` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); environment activation policy | `backend/ai/configuration.md#provider-detection` |
| `AIProviderCatalogEntry.settingsEnvKeys` | `AIProviderSettingEnvKeys` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); provider-setting environment metadata | `backend/ai/configuration.md#provider-environment` |
| `AIProviderCatalogEntry.compatibleTypes` | `readonly AIProviderType[]` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); established-id compatibility admission | `backend/ai/configuration.md#provider-catalog` |
| `AIProviderCatalogEntry.capabilities` | `ResolvedAIProviderCapabilities` | [`AI_PROVIDER_CATALOG`](../../../../src/ai/ai-provider-catalog.ts); normalized static capability metadata | `backend/ai/configuration.md#capabilities` |

`AIProviderCapabilities` retains its legacy eight required fields; newer flags
remain optional for source compatibility and normalization produces
`ResolvedAIProviderCapabilities`. `AIProviderSettingEnvKeys` and
`AIProviderCatalogEntry` are public static catalog metadata, not additional
fields accepted inside one provider config. Capability claims are validated
against catalog/factory behavior, not inferred from model names.

## Vector Configuration

All declarations are exported by `/vector` and re-exported for managed app
configuration by `/server`. The authoritative resolver is
[`vector-config.ts`](../../../../src/vector/vector-config.ts).

| Type and field | Exact declared type | Resolver evidence | Planned guide |
| --- | --- | --- | --- |
| `VectorConfig.dataDir` | `string` | `resolveVectorConfig` | `backend/vector/configuration.md` |
| `VectorConfig.defaultIndex` | `string` | `resolveVectorConfig` | `backend/vector/configuration.md` |
| `VectorConfig.defaultDimensions` | `number` | `resolveVectorConfig` | `backend/vector/configuration.md` |
| `VectorConfig.indexes` | `Record<string, number \| VectorIndexConfig>` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.dimensions` | `number` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.path` | `string` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.vectorField` | `string` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.textField` | `string` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.metadataField` | `string` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.metadata` | `Record<string, VectorMetadataFieldInput>` | `resolveMetadataFields` | `backend/vector/indexes.md` |
| `VectorIndexConfig.metric` | `VectorMetric` | `normalizeChoice` in `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.indexType` | `VectorIndexType` | `normalizeChoice` in `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.readOnly` | `boolean` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.enableMMAP` | `boolean` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.insertBatchSize` | `number` | `resolveIndexes` | `backend/vector/indexes.md` |
| `VectorIndexConfig.query` | `VectorQueryTuningConfig` | `resolveIndexes`, then adapter query | `backend/vector/querying.md` |
| `VectorMetadataFieldConfig.type` | `VectorMetadataFieldType` (required) | `resolveMetadataFields` | `backend/vector/indexes.md` |
| `VectorMetadataFieldConfig.indexed` | `boolean` | `resolveMetadataFields` | `backend/vector/indexes.md` |
| `VectorMetadataFieldConfig.nullable` | `boolean` | `resolveMetadataFields` | `backend/vector/indexes.md` |
| `VectorMetadataFieldConfig.range` | `boolean` | `resolveMetadataFields` | `backend/vector/indexes.md` |
| `VectorQueryTuningConfig.ef` | `number` | Zvec adapter query mapping | `backend/vector/querying.md` |
| `VectorQueryTuningConfig.nprobe` | `number` | Zvec adapter query mapping | `backend/vector/querying.md` |
| `VectorQueryTuningConfig.listSize` | `number` | Zvec adapter query mapping | `backend/vector/querying.md` |
| `VectorQueryTuningConfig.linear` | `boolean` | Zvec adapter query mapping | `backend/vector/querying.md` |
| `VectorQueryTuningConfig.radius` | `number` | Zvec adapter query mapping | `backend/vector/querying.md` |

## SQLite, ReactiveDB, And System Database

`SQLiteStorageConfig` is public through `/persistence` and `/server`.
`ReactiveDBConfig` extends it through `/sync` and `/server`. The managed
`SystemDatabaseConfig` is the same hierarchy with `database?: never` so an
application cannot bypass the owned service/authority boundary with a raw handle.

| Type and field | Exact declared type | Resolver / construction evidence | Planned guide |
| --- | --- | --- | --- |
| `SQLiteStorageConfig.mode` | `SQLiteStorageMode \| LegacySQLiteStorageMode \| (string & {})` | [`resolveSQLiteStorageConfig`](../../../../src/persistence/storage-config.ts) | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.path` | `string` | `resolveSQLiteStorageConfig` | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.snapshotPath` | `string` | `resolveSQLiteStorageConfig` | `backend/persistence/hot-mode.md` |
| `SQLiteStorageConfig.snapshotEnabled` | `boolean` | `resolveSQLiteStorageConfig`; snapshot manager | `backend/persistence/hot-mode.md` |
| `SQLiteStorageConfig.snapshotIntervalMs` | `number` | `resolveSQLiteStorageConfig`; snapshot manager | `backend/persistence/hot-mode.md` |
| `SQLiteStorageConfig.hotMaxBytes` | `number` | `resolveSQLiteStorageConfig`; hot image admission | `backend/persistence/hot-mode.md` |
| `SQLiteStorageConfig.emitTelemetry` | `boolean` | `resolveSQLiteStorageConfig`; platform SQLite service | `backend/persistence/observability.md` |
| `SQLiteStorageConfig.cacheSize` | `number` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.mmapSize` | `number` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.walAutocheckpoint` | `number` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.pageSize` | `number` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.synchronous` | `SQLiteSynchronousMode` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.tempStore` | `SQLiteTempStoreMode` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.busyTimeout` | `number` | `resolveSQLiteStorageConfig`; SQLite PRAGMA application | `backend/persistence/configuration.md` |
| `SQLiteStorageConfig.statementCacheSize` | `number` | `resolveSQLiteStorageConfig`; statement cache | `backend/persistence/statement-cache.md` |
| `SQLiteStorageConfig.bufferPool` | `false \| BufferPoolConfig` | `resolveSQLiteStorageConfig`; buffer pool construction | `backend/persistence/configuration.md` |
| `BufferPoolConfig.maxPoolSize` | `number` | `resolveSQLiteStorageConfig` | `backend/persistence/configuration.md` |
| `BufferPoolConfig.preallocate` | `boolean` | `resolveSQLiteStorageConfig` | `backend/persistence/configuration.md` |
| `ReactiveDBConfig.observability` | `PlatformObservabilityRuntime \| null` | [`ReactiveDB`](../../../../src/sync/reactive-db.ts) construction; managed app injects runtime | `backend/reactive-db/configuration.md` |
| `ReactiveDBConfig.sqlite` | `PlatformSQLiteService` | `ReactiveDB` construction; preferred owned-service seam | `backend/reactive-db/configuration.md` |
| `ReactiveDBConfig.database` | `Database` | `ReactiveDB` direct construction; caller-owned raw handle | `backend/reactive-db/configuration.md` |
| `ReactiveDBConfig.mode` | `SQLiteStorageConfig['mode']` | persistence resolver compatibility path | `backend/reactive-db/configuration.md` |
| `ReactiveDBConfig.ownsDatabase` | `boolean` | `ReactiveDB` lifecycle construction | `backend/reactive-db/configuration.md` |
| `ReactiveDBConfig.clearChangesOnStart` | `boolean` | `ReactiveDB` startup | `backend/reactive-db/operations.md` |
| `ReactiveDBConfig.ringBufferDepth` | `number` | `ReactiveDB` change log/ring construction | `backend/reactive-db/realtime.md` |
| `ReactiveDBConfig.emitCode` | `ReactiveDBPlatformCodeEmitter` | `ReactiveDB` construction; managed app injects app-local emitter | `backend/reactive-db/observability.md` |
| `SystemDatabaseConfig.database` | `never` | [`resolveSystemDatabaseConfig`](../../../../src/frontend/server/system-database-config.ts) rejects raw handles and collisions | `backend/configuration/data-modes.md` |

Inherited `SQLiteStorageConfig` fields remain available on `ReactiveDBConfig` and
`SystemDatabaseConfig` except the explicitly forbidden raw `database` handle on
the system plane. The catalog does not duplicate inherited rows as new fields.

## Fabric Managed Topology

The managed tree is declared in
[`database-topology-types.ts`](../../../../src/frontend/server/database-topology-types.ts)
and validated without filesystem access by
[`database-topology-config.ts`](../../../../src/frontend/server/database-topology-config.ts).

| Type and field | Exact declared type | Resolver / admission evidence | Planned guide |
| --- | --- | --- | --- |
| `AppSingleDatabaseTopologyConfig.mode` | `'single'` | `resolveAppDatabaseTopology` | `backend/fabric/configuration.md` |
| `AppMultipleDatabaseTopologyConfig.mode` | `'multiple'` (required) | `resolveAppDatabaseTopology` | `backend/fabric/configuration.md` |
| `AppMultipleDatabaseTopologyConfig.rootDirectory` | `string` (required) | root-directory normalization and isolation checks | `backend/fabric/configuration.md` |
| `AppMultipleDatabaseTopologyConfig.realm` | `DatabaseRealm` (required) | realm normalization/schema-subset admission | `backend/fabric/realms.md` |
| `AppMultipleDatabaseTopologyConfig.actors` | `AppDatabaseActorConfig` (required) | `normalizeMultipleDatabaseActors` | `backend/fabric/actors.md` |
| `AppMultipleDatabaseTopologyConfig.tenantIsolation` | `AppTenantDataIsolation` | `resolveAppDatabaseTopology` and Guardian mode check | `backend/fabric/tenant-isolation.md` |
| `AppMultipleDatabaseTopologyConfig.placement` | `AppDatabasePlacementConfig` | `normalizeDatabasePlacementPolicy` | `backend/fabric/placement.md` |
| `AppMultipleDatabaseTopologyConfig.sqlite` | `DatabaseActorSQLiteConfig` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `AppMultipleDatabaseTopologyConfig.maxDatabases` | `number` | bounded integer normalization | `backend/fabric/capacity.md` |
| `AppMultipleDatabaseTopologyConfig.maxDatabaseFiles` | `number` | bounded integer normalization | `backend/fabric/capacity.md` |
| `AppMultipleDatabaseTopologyConfig.maxBlockedDatabases` | `number` | bounded integer normalization | `backend/fabric/recovery.md` |
| `AppMultipleDatabaseTopologyConfig.maxTenantSyncDatabases` | `number` | bounded integer/cross-field validation | `backend/fabric/sync.md` |
| `AppMultipleDatabaseTopologyConfig.maxTenantSyncBindingsPerDatabase` | `number` | bounded integer normalization | `backend/fabric/sync.md` |
| `AppMultipleDatabaseTopologyConfig.readers` | `boolean` | boolean validation and coordinator construction | `backend/fabric/concurrency.md` |
| `AppMultipleDatabaseTopologyConfig.maxQueuedPerDatabase` | `number` | bounded integer normalization | `backend/fabric/capacity.md` |
| `AppMultipleDatabaseTopologyConfig.maxQueuedTotal` | `number` | bounded integer normalization | `backend/fabric/capacity.md` |
| `AppMultipleDatabaseTopologyConfig.queueTimeoutMs` | `number` | bounded timer normalization | `backend/fabric/capacity.md` |
| `AppMultipleDatabaseTopologyConfig.operationTimeoutMs` | `number` | bounded timer normalization | `backend/fabric/capacity.md` |
| `AppMultipleDatabaseTopologyConfig.restart` | `DatabaseCoordinatorRestartPolicy` | `normalizeDatabaseCoordinatorRestartPolicy` | `backend/fabric/recovery.md` |
| `AppMultipleDatabaseTopologyConfig.idleTimeoutMs` | `number` | bounded integer normalization | `backend/fabric/lifecycle.md` |
| `AppMultipleDatabaseTopologyConfig.sweepIntervalMs` | `number \| false` | bounded timer normalization | `backend/fabric/lifecycle.md` |
| `AppDatabaseActorConfig.launch` | `DatabaseActorLaunch` (required) | actor launch normalization | `backend/fabric/actors.md` |
| `AppDatabaseActorConfig.env` | `Readonly<Record<string, string>>` | explicit child allowlist normalization | `backend/fabric/actors.md` |
| `AppDatabaseActorConfig.executor` | `DatabaseActorExecutorPolicy` | subprocess executor policy normalization | `backend/fabric/actors.md` |
| `DatabaseActorSourceLaunch.kind` | `'source'` | actor command builder | `backend/fabric/actors.md` |
| `DatabaseActorSourceLaunch.entrypoint` | `string \| URL` | actor command builder | `backend/fabric/actors.md` |
| `DatabaseActorSourceLaunch.runtimeExecutable` | `string` | actor command builder | `backend/fabric/actors.md` |
| `DatabaseActorBundleLaunch.kind` | `'bundle'` | actor command builder | `backend/fabric/actors.md` |
| `DatabaseActorBundleLaunch.entrypoint` | `string \| URL` | actor command builder | `backend/fabric/actors.md` |
| `DatabaseActorCommandPrefixLaunch.kind` | `'command-prefix'` | actor command builder | `backend/fabric/actors.md` |
| `DatabaseActorCommandPrefixLaunch.commandPrefix` | `readonly [string, ...string[]]` | actor command builder | `backend/fabric/actors.md` |
| `AppDatabasePlacementPolicyConfig.default` | `DatabasePlacement` (required) | `normalizeDatabasePlacementPolicy` | `backend/fabric/placement.md` |
| `AppDatabasePlacementPolicyConfig.select` | `DatabasePlacementSelector` | selector result validation and entry pinning | `backend/fabric/placement.md` |
| `AppDatabasePlacementPolicyConfig.hot` | `AppDatabaseHotPlacementConfig` | hot-policy normalization | `backend/fabric/placement.md` |
| `AppDatabaseHotPlacementConfig.durability` | `DatabaseHotDurability` | hot-policy normalization | `backend/fabric/placement.md` |
| `AppDatabaseHotPlacementConfig.maxBytes` | `number` (required) | hot-policy normalization | `backend/fabric/placement.md` |
| `AppDatabaseHotPlacementConfig.snapshotIntervalMs` | `number` | hot-policy normalization | `backend/fabric/placement.md` |
| `AppDatabaseHotPlacementConfig.snapshotTimeoutMs` | `number` | hot-policy normalization | `backend/fabric/placement.md` |
| `DatabaseCoordinatorRestartPolicy.initialDelayMs` | `number` | [`database-restart-policy.ts`](../../../../src/databases/database-restart-policy.ts) | `backend/fabric/recovery.md` |
| `DatabaseCoordinatorRestartPolicy.maxDelayMs` | `number` | `normalizeDatabaseCoordinatorRestartPolicy` | `backend/fabric/recovery.md` |
| `DatabaseCoordinatorRestartPolicy.circuitFailureThreshold` | `number` | `normalizeDatabaseCoordinatorRestartPolicy` | `backend/fabric/recovery.md` |
| `DatabaseCoordinatorRestartPolicy.circuitCooldownMs` | `number` | `normalizeDatabaseCoordinatorRestartPolicy` | `backend/fabric/recovery.md` |
| `DatabaseActorSQLiteConfig.cacheSize` | `number` | [`normalizeDatabaseActorSQLiteConfig`](../../../../src/databases/database-actor-protocol.ts) | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.mmapSize` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.walAutocheckpoint` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.pageSize` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.synchronous` | `'OFF' \| 'NORMAL' \| 'FULL' \| 'EXTRA'` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.tempStore` | `'DEFAULT' \| 'FILE' \| 'MEMORY'` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.busyTimeout` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.statementCacheSize` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.bufferPool` | `false \| { maxPoolSize?: number; preallocate?: boolean }` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.bufferPool.maxPoolSize` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.bufferPool.preallocate` | `boolean` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorSQLiteConfig.ringBufferDepth` | `number` | `normalizeDatabaseActorSQLiteConfig` | `backend/fabric/configuration.md` |
| `DatabaseActorExecutorPolicy.maxInFlight` | `number` | [`normalizeSubprocessDatabaseExecutorOptions`](../../../../src/databases/subprocess-database-executor-config.ts) | `backend/fabric/actors.md` |
| `DatabaseActorExecutorPolicy.startupTimeoutMs` | `number` | `normalizeSubprocessDatabaseExecutorOptions` | `backend/fabric/actors.md` |
| `DatabaseActorExecutorPolicy.operationTimeoutMs` | `number` | `normalizeSubprocessDatabaseExecutorOptions` | `backend/fabric/actors.md` |
| `DatabaseActorExecutorPolicy.shutdownAckTimeoutMs` | `number` | `normalizeSubprocessDatabaseExecutorOptions` | `backend/fabric/actors.md` |
| `DatabaseActorExecutorPolicy.shutdownExitTimeoutMs` | `number` | `normalizeSubprocessDatabaseExecutorOptions` | `backend/fabric/actors.md` |
| `DatabaseActorExecutorPolicy.sigtermTimeoutMs` | `number` | `normalizeSubprocessDatabaseExecutorOptions` | `backend/fabric/actors.md` |
| `DatabaseActorExecutorPolicy.sigkillTimeoutMs` | `number` | `normalizeSubprocessDatabaseExecutorOptions` | `backend/fabric/actors.md` |

### Fabric Direct/Internal Constructor Boundary

`DatabaseCoordinatorOptions` and `SubprocessDatabaseExecutorOptions` are
source-level constructors in `src/databases`, but the package manifest has no
`@zero/framework/databases` subpath and `/server` does not re-export them. They
are therefore **internal composition**, not a supported alternative to
`AppConfig.databaseTopology`.

| Internal type | Declared fields | Normalizer evidence | Documentation treatment |
| --- | --- | --- | --- |
| `DatabaseCoordinatorOptions` | `rootDirectory`, `realm`, `createExecutor`, `placement?`, `sqlite?`, `maxDatabases?`, `maxDatabaseFiles?`, `maxBlockedDatabases?`, `maxTenantSyncDatabases?`, `maxTenantSyncBindingsPerDatabase?`, `readers?`, `maxQueuedPerDatabase?`, `maxQueuedTotal?`, `queueTimeoutMs?`, `operationTimeoutMs?`, `restart?`, `idleTimeoutMs?`, `sweepIntervalMs?`, `observability?`, `authorityCommitCoordinator?`, `requireCommitAuthority?`, `actorAuthorityContext?`, `now?` | [`normalizeDatabaseCoordinatorConfig`](../../../../src/databases/database-coordinator-config.ts) | Architecture evidence only; do not publish as app config |
| `SubprocessDatabaseExecutorOptions` | `command`, `env`, `role`, `slot`, `maxInFlight?`, `startupTimeoutMs?`, `operationTimeoutMs?`, `shutdownAckTimeoutMs?`, `shutdownExitTimeoutMs?`, `sigtermTimeoutMs?`, `sigkillTimeoutMs?` | [`normalizeSubprocessDatabaseExecutorOptions`](../../../../src/databases/subprocess-database-executor-config.ts) | Architecture evidence only; app uses actor launch/policy types |

## Storage And Storage Studio Configuration

The managed declarations and resolver are in
[`storage-config.ts`](../../../../src/storage/storage-config.ts). Standalone
`StoragePluginConfig` and `StorageServiceOptions` are trusted service dependency
records; they must not be merged into `AppConfig.storage` examples.

| Type and field | Exact declared type | Resolver / policy evidence | Planned guide |
| --- | --- | --- | --- |
| `AppStorageConfig.signingSecret` | `string` | [`resolveAppStorageConfig`](../../../../src/storage/storage-config.ts); server-only/persisted-key fallback path | `backend/storage/configuration.md` |
| `AppStorageConfig.defaultPresignedTTL` | `number` | `resolveAppStorageConfig` | `backend/storage/configuration.md` |
| `AppStorageConfig.studio` | `StorageStudioConfig` | `resolveStorageStudioConfig` | `backend/storage/studio-configuration.md` |
| `StorageStudioConfig.enabled` | `boolean` | `resolveStorageStudioConfig` | `backend/storage/studio-configuration.md` |
| `StorageStudioConfig.organizationDrives` | `boolean` | `resolveStorageStudioConfig` | `backend/storage/studio-configuration.md` |
| `StorageStudioConfig.personalDrives` | `boolean` | `resolveStorageStudioConfig` | `backend/storage/studio-configuration.md` |
| `StorageStudioConfig.personalSelfService` | `boolean` | `resolveStorageStudioConfig` and cross-field check | `backend/storage/studio-configuration.md` |
| `StorageStudioConfig.isolation` | `StorageStudioIsolation` | `resolveStorageStudioConfig` | `backend/storage/studio-configuration.md` |
| `StorageStudioConfig.defaultGrants` | `readonly StorageStudioDefaultGrantConfig[]` | [`resolveStorageStudioDefaultGrants`](../../../../src/storage/storage-config-policy.ts) | `backend/storage/studio-permissions.md` |
| `StorageStudioConfig.limits` | `StorageStudioLimitsConfig` | [`resolveStorageStudioLimits`](../../../../src/storage/storage-config-policy.ts) | `backend/storage/studio-quotas.md` |
| `StorageStudioConfig.publicAccess` | `StorageStudioPublicAccessConfig` | [`resolveStorageStudioPublicAccess`](../../../../src/storage/storage-config-policy.ts) | `backend/storage/studio-permissions.md` |
| `StorageStudioConfig.maxCapabilityTTL` | `number` | `resolveStorageStudioConfig` and TTL cross-check | `backend/storage/studio-configuration.md` |
| `StorageStudioDefaultGrantConfig.grantType` | `GrantType` (required) | `resolveStorageStudioDefaultGrants` | `backend/storage/studio-permissions.md` |
| `StorageStudioDefaultGrantConfig.grantKey` | `string` | `resolveStorageStudioDefaultGrants` | `backend/storage/studio-permissions.md` |
| `StorageStudioDefaultGrantConfig.grantValue` | `string` (required) | `resolveStorageStudioDefaultGrants` | `backend/storage/studio-permissions.md` |
| `StorageStudioDefaultGrantConfig.permission` | `PermissionLevel` (required) | `resolveStorageStudioDefaultGrants` | `backend/storage/studio-permissions.md` |
| `StorageStudioLimitsConfig.maxOrganizationDrives` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.maxPersonalDrivesPerUser` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.maxObjectsPerDrive` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.defaultDriveSizeBytes` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.defaultFileSizeBytes` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.maxDriveSizeBytes` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.maxFileSizeBytes` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioLimitsConfig.maxConcurrentUploadBytes` | `number` | `resolveStorageStudioLimits` | `backend/storage/studio-quotas.md` |
| `StorageStudioPublicAccessConfig.allowPublicDrives` | `boolean` | `resolveStorageStudioPublicAccess` | `backend/storage/studio-permissions.md` |
| `StorageStudioPublicAccessConfig.allowPublicObjects` | `boolean` | `resolveStorageStudioPublicAccess` | `backend/storage/studio-permissions.md` |

Standalone `StorageServiceOptions` fields are `uploadGrantSecret`,
`defaultPresignedTTL`, `isPolicyTrustedProperty`, `tenancyMode`,
`prepareCapability`, `uploadAdmission`, `managedObjectPolicy`, and `aclAudit`.
They are exported through `/storage` as direct trusted construction options and
are consumed by [`StorageService`](../../../../src/storage/storage-service.ts),
not by the managed storage resolver. `StorageStudioServiceOptions` is a
source-internal dependency record (`db`, `storage`, resolved `config`,
`tenancyMode`, optional audit/provider/lifecycle fields) with no declared
package export; normal applications should use the managed Studio policy.

## Email Configuration

`EmailConfig` is managed by `AppConfig.email` and also exported through
`@zero/framework/email`. Runtime normalization/provider selection is in
[`runtime.ts`](../../../../src/email/runtime.ts); provider-specific Resend
fallbacks are in [`resend-email-provider.ts`](../../../../src/email/resend-email-provider.ts).

| Type and field | Exact declared type | Resolver / construction evidence | Planned guide |
| --- | --- | --- | --- |
| `EmailConfig.from` | `string` | `createEmailRuntime`, then `EmailService` message merge | `backend/email/configuration.md` |
| `EmailConfig.replyTo` | `string` | `createEmailRuntime`, then `EmailService` message merge | `backend/email/configuration.md` |
| `EmailConfig.provider` | `BuiltInEmailProvider \| EmailProvider` | `createEmailRuntime`/provider selection | `backend/email/configuration.md` |
| `EmailConfig.resend` | `ResendEmailProviderConfig` | Resend provider construction | `backend/email/providers/resend.md` |
| `ResendEmailProviderConfig.apiKey` | `string` | `ResendEmailProvider` construction; server-only | `backend/email/providers/resend.md` |
| `ResendEmailProviderConfig.baseUrl` | `string` | `ResendEmailProvider` construction | `backend/email/providers/resend.md` |

The custom `EmailProvider` object is a public dependency-inversion boundary,
not a serializable provider name. `configureEmail()` remains an ambient legacy
compatibility path; managed apps use an app-local runtime.

## KV Configuration

`KvServiceConfig` is accepted by managed `AppConfig.kv` and public standalone
`KvService` construction. Managed resolution first applies the app-level KV
switch in [`resolveKvConfig`](../../../../src/frontend/server/types.ts); service
construction and validation continue in
[`kv-service.ts`](../../../../src/kv/kv-service.ts) and its focused components.

| Type and field | Exact declared type | Resolver / construction evidence | Planned guide |
| --- | --- | --- | --- |
| `KvServiceConfig.baseDir` | `string` | app KV resolver, journal/checkpoint construction | `backend/kv/configuration.md` |
| `KvServiceConfig.durability` | `KvJournalDurability` | app KV resolver, `KvFileJournal` | `backend/kv/durability.md` |
| `KvServiceConfig.fsyncMs` | `number` | `KvService` lifecycle | `backend/kv/durability.md` |
| `KvServiceConfig.checkpointIntervalMs` | `number` | `KvService` lifecycle/checkpoint store | `backend/kv/durability.md` |
| `KvServiceConfig.corruptRecordPolicy` | `KvRecoveryCorruptRecordPolicy` | `KvService.start`, recovery | `backend/kv/recovery.md` |
| `KvServiceConfig.clock` | `KvClock` | `KvService`/memory engine construction | `backend/kv/configuration.md` |
| `KvServiceConfig.engine` | `KvMemoryEngine` | `KvService` standalone dependency injection | `backend/kv/configuration.md` |
| `KvServiceConfig.journal` | `KvFileJournal` | `KvService` standalone dependency injection | `backend/kv/durability.md` |
| `KvServiceConfig.checkpoint` | `KvCheckpointStore` | `KvService` standalone dependency injection | `backend/kv/durability.md` |
| `KvServiceConfig.memory` | `Omit<KvMemoryEngineOptions, 'clock'>` | `KvService` constructs memory engine | `backend/kv/memory.md` |
| `KvServiceConfig.emitCode` | `KvPlatformCodeEmitter` | `KvService` construction; managed app supplies app-local emitter | `backend/kv/observability.md` |
| `KvMemoryEngineOptions.defaultTtlMs` | `number \| null` | [`KvMemoryEngine`](../../../../src/kv/kv-memory-engine.ts) | `backend/kv/memory.md` |
| `KvMemoryEngineOptions.maxEntries` | `number` | `KvMemoryEngine` capacity/eviction | `backend/kv/memory.md` |
| `KvMemoryEngineOptions.maxBytes` | `number` | `KvMemoryEngine` capacity/eviction | `backend/kv/memory.md` |
| `KvMemoryEngineOptions.eviction` | `KvEvictionPolicy` | `KvMemoryEngine` capacity/eviction | `backend/kv/memory.md` |
| `KvMemoryEngineOptions.evictionRecency` | `KvEvictionRecency` | `KvMemoryEngine` capacity/eviction | `backend/kv/memory.md` |
| `KvMemoryEngineOptions.ttlBucketMs` | `number` | `KvMemoryEngine` TTL index | `backend/kv/memory.md` |

`KvMemoryEngineOptions.clock` is deliberately omitted from
`KvServiceConfig.memory` because `KvServiceConfig.clock` owns the shared service
clock. Per-call `KvSetOptions`, counter and limiter options are operation policy,
not startup configuration, and remain in the KV API guide.

## PDF Configuration

All managed fields below are declared in
[`pdf-types.ts`](../../../../src/pdf/pdf-types.ts), exported by `/pdf` and
`/server`, and resolved by
[`resolvePdfConfig`](../../../../src/pdf/pdf-config.ts).

| Type and field | Exact declared type | Resolver / policy evidence | Planned guide |
| --- | --- | --- | --- |
| `PdfConfig.renderer` | `PdfRenderer` | `validateRenderer`, then `PdfService` | `backend/pdf/configuration.md` |
| `PdfConfig.browser` | `PdfBrowserConfig` | `resolvePdfConfig` | `backend/pdf/browser.md` |
| `PdfConfig.resources` | `PdfResourcePolicyConfig` | `resolveResourcePolicy` | `backend/pdf/resources.md` |
| `PdfConfig.defaults` | `PdfPrintOptions` | `mergePdfPrintOptions`/`resolvePrintOptions` | `backend/pdf/rendering.md` |
| `PdfConfig.limits` | `PdfLimitsConfig` | `resolvePdfConfig` | `backend/pdf/limits.md` |
| `PdfConfig.waitForFonts` | `boolean` | `resolvePdfConfig`, renderer | `backend/pdf/rendering.md` |
| `PdfBrowserConfig.executablePath` | `string` | `resolvePdfConfig`; explicit config/environment resolution | `backend/pdf/browser.md` |
| `PdfBrowserConfig.headless` | `boolean` | `resolvePdfConfig` | `backend/pdf/browser.md` |
| `PdfBrowserConfig.launchArgs` | `readonly string[]` | `resolvePdfConfig` | `backend/pdf/browser.md` |
| `PdfBrowserConfig.launchTimeoutMs` | `number` | `resolvePdfConfig` | `backend/pdf/browser.md` |
| `PdfBrowserConfig.javaScriptEnabled` | `boolean` | `resolvePdfConfig`, browser renderer | `backend/pdf/security.md` |
| `PdfResourcePolicyConfig.remote` | `PdfRemoteResourceMode` | `resolveResourcePolicy` | `backend/pdf/resources.md` |
| `PdfResourcePolicyConfig.allowedOrigins` | `readonly string[]` | `resolveResourcePolicy`/origin normalization | `backend/pdf/resources.md` |
| `PdfResourcePolicyConfig.deniedBehavior` | `PdfDeniedResourceBehavior` | `resolveResourcePolicy`, browser request policy | `backend/pdf/resources.md` |
| `PdfResourcePolicyConfig.allowDataUrls` | `boolean` | `resolveResourcePolicy` | `backend/pdf/resources.md` |
| `PdfResourcePolicyConfig.allowBlobUrls` | `boolean` | `resolveResourcePolicy` | `backend/pdf/resources.md` |
| `PdfResourcePolicyConfig.blockPrivateNetworks` | `boolean` | `resolveResourcePolicy` | `backend/pdf/security.md` |
| `PdfLimitsConfig.maxHtmlBytes` | `number` | `resolvePdfConfig`, service input admission | `backend/pdf/limits.md` |
| `PdfLimitsConfig.maxCssBytes` | `number` | `resolvePdfConfig`, service input admission | `backend/pdf/limits.md` |
| `PdfLimitsConfig.maxOutputBytes` | `number` | `resolvePdfConfig`, renderer result admission | `backend/pdf/limits.md` |
| `PdfLimitsConfig.timeoutMs` | `number` | `resolvePdfConfig`, render queue/service | `backend/pdf/limits.md` |
| `PdfLimitsConfig.maxConcurrency` | `number` | `resolvePdfConfig`, render queue | `backend/pdf/limits.md` |
| `PdfLimitsConfig.maxQueue` | `number` | `resolvePdfConfig`, render queue | `backend/pdf/limits.md` |
| `PdfPrintOptions.format` | `PdfPageFormat \| string` | `resolvePrintOptions` | `backend/pdf/rendering.md` |
| `PdfPrintOptions.width` | `string \| number` | `resolvePrintOptions` and format conflict validation | `backend/pdf/rendering.md` |
| `PdfPrintOptions.height` | `string \| number` | `resolvePrintOptions` and format conflict validation | `backend/pdf/rendering.md` |
| `PdfPrintOptions.landscape` | `boolean` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfPrintOptions.printBackground` | `boolean` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfPrintOptions.preferCSSPageSize` | `boolean` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfPrintOptions.scale` | `number` | `resolvePrintOptions` range validation | `backend/pdf/rendering.md` |
| `PdfPrintOptions.pageRanges` | `string` | `resolvePrintOptions` syntax validation | `backend/pdf/rendering.md` |
| `PdfPrintOptions.margin` | `PdfMargins` | `resolvePrintOptions` | `backend/pdf/rendering.md` |
| `PdfPrintOptions.displayHeaderFooter` | `boolean` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfPrintOptions.headerTemplate` | `string` | `resolvePrintOptions`, input byte accounting | `backend/pdf/rendering.md` |
| `PdfPrintOptions.footerTemplate` | `string` | `resolvePrintOptions`, input byte accounting | `backend/pdf/rendering.md` |
| `PdfPrintOptions.tagged` | `boolean` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfPrintOptions.outline` | `boolean` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfMargins.top` | `string \| number` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfMargins.right` | `string \| number` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfMargins.bottom` | `string \| number` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |
| `PdfMargins.left` | `string \| number` | `resolvePrintOptions`, renderer | `backend/pdf/rendering.md` |

`PdfServiceOptions` is a public standalone constructor record with `renderer?`
and `storage?`. `PdfPluginConfig` additionally contains resolved config and
lifecycle wiring but is not exported from a declared package route. Neither
record adds keys accepted under managed `AppConfig.pdf`.

## Observability Configuration

Managed `AppConfig.observability` accepts `ObservabilityConfig | false`.
Declaration evidence is
[`observability/types.ts`](../../../../src/observability/types.ts); runtime and
endpoint handling are in [`sink.ts`](../../../../src/observability/sink.ts) and
[`plugin.ts`](../../../../src/observability/plugin.ts).

| Type and field | Exact declared type | Resolver / runtime evidence | Planned guide |
| --- | --- | --- | --- |
| `ObservabilityConfig.enabled` | `boolean` | observability runtime composition | `backend/observability/configuration.md` |
| `ObservabilityConfig.sink` | `PlatformSink` | observability runtime composition | `backend/observability/sinks.md` |
| `ObservabilityConfig.store` | `PlatformEventStore \| false` | observability runtime composition | `backend/observability/storage.md` |
| `ObservabilityConfig.console` | `boolean` | default/composite sink construction | `backend/observability/sinks.md` |
| `ObservabilityConfig.maxEvents` | `number` | in-memory store construction | `backend/observability/storage.md` |
| `ObservabilityConfig.endpoint` | `false \| ObservabilityEndpointConfig` | observability plugin | `backend/observability/endpoints.md` |
| `ObservabilityConfig.trace` | `false \| ObservabilityTraceConfig` | observability plugin/trace emission | `backend/observability/tracing.md` |
| `ObservabilityEndpointConfig.enabled` | `boolean` | observability plugin | `backend/observability/endpoints.md` |
| `ObservabilityEndpointConfig.basePath` | `string` | observability plugin | `backend/observability/endpoints.md` |
| `ObservabilityEndpointConfig.read` | `ObservabilityEndpointReadMode` | observability plugin access check | `backend/observability/endpoints.md` |
| `ObservabilityEndpointConfig.frontendIngest` | `boolean` | observability plugin | `backend/observability/endpoints.md` |
| `ObservabilityEndpointConfig.maxPayloadBytes` | `number` | observability plugin payload admission | `backend/observability/endpoints.md` |
| `ObservabilityTraceConfig.enabled` | `boolean` | trace plugin configuration | `backend/observability/tracing.md` |
| `ObservabilityTraceConfig.slowRequestMs` | `number` | trace emission | `backend/observability/tracing.md` |
| `ObservabilityTraceConfig.slowLifecycleMs` | `number` | trace emission | `backend/observability/tracing.md` |

`ObservabilityPluginConfig` (`config?`, `runtime?`, `authEnabled?`) is a public
standalone plugin wiring record. Managed applications pass only
`ObservabilityConfig`; the composition root supplies runtime and auth state.

## Torrent Workflow Configuration

Managed workflow setup uses `AppWorkflowsConfig`. Direct plugin/service options
are public from `/workflows` and `/server` but are trusted composition records,
not extra managed fields. Per-run `WorkflowStartOptions` are a public operation
policy and are listed because they establish immutable persisted run policy.

| Type and field | Exact declared type | Resolver / runtime evidence | Classification and planned guide |
| --- | --- | --- | --- |
| `AppWorkflowsConfig.register` | `(registry, context) => void \| Promise<void>` | managed app workflow composition awaits registration before recovery/publication | Managed · `backend/torrent/configuration.md` |
| `AppWorkflowsConfig.onServiceCreated` | `(service: WorkflowService) => void` | managed app workflow publication seam | Managed · `backend/torrent/configuration.md` |
| `AppWorkflowsConfig.shutdownGraceMs` | `number` | workflow plugin/service lifecycle | Managed · `backend/torrent/lifecycle.md` |
| `AppWorkflowsConfig.interactionAuthority` | `WorkflowInteractionAuthority` | workflow service/interaction gate | Managed · `backend/torrent/interactions.md` |
| `WorkflowPluginConfig.db` | `ReactiveDB` (required) | [`workflow-plugin-runtime.ts`](../../../../src/workflows/workflow-plugin-runtime.ts) | Public standalone · `backend/torrent/configuration.md#standalone-plugin` |
| `WorkflowPluginConfig.runtime` | `ZeroAppRuntime` | workflow plugin runtime owner | Public standalone · same guide |
| `WorkflowPluginConfig.scheduler` | `SchedulerService` | workflow plugin runtime owner | Public standalone · same guide |
| `WorkflowPluginConfig.register` | `(registry) => void \| Promise<void>` | workflow plugin runtime owner | Public standalone · same guide |
| `WorkflowPluginConfig.onRegistryCreated` | `(registry) => void` | compatibility registration hook | Public standalone · same guide |
| `WorkflowPluginConfig.getTokenService` | `() => TokenService \| null` | workflow plugin runtime owner | Public standalone · same guide |
| `WorkflowPluginConfig.authorization` | `AuthMiddlewareAuthorizationOptions` | workflow plugin runtime owner | Public standalone · same guide |
| `WorkflowPluginConfig.ensureAuthReady` | `() => Promise<void>` | workflow plugin initialization | Public standalone · same guide |
| `WorkflowPluginConfig.executionServices` | `WorkflowExecutionServiceProvider` | workflow plugin/service execution context | Public standalone · same guide |
| `WorkflowPluginConfig.shutdownGraceMs` | `number` | workflow plugin/service lifecycle | Public standalone · `backend/torrent/lifecycle.md` |
| `WorkflowPluginConfig.interactionAuthority` | `WorkflowInteractionAuthority` | workflow interaction service | Public standalone · `backend/torrent/interactions.md` |
| `WorkflowPluginConfig.onInitializerCreated` | `(initialize) => void` | managed startup wiring | Public standalone/managed seam · same guide |
| `WorkflowPluginConfig.onServiceCreated` | `(service) => void` | publication wiring | Public standalone/managed seam · same guide |
| `WorkflowStartOptions.version` | `number` | [`validateWorkflowStartOptions`](../../../../src/workflows/workflow-start-options.ts) | Public operation · `backend/torrent/versioning.md` |
| `WorkflowStartOptions.initialMemory` | `Readonly<Record<string, unknown>>` | `validateWorkflowStartOptions`; graph-only trusted service start | Public operation · `backend/torrent/memory.md` |
| `WorkflowStartOptions.memoryLimits` | `Partial<WorkflowMemoryLimits>` | `validateWorkflowStartOptions`, persisted policy | Public operation · `backend/torrent/memory.md` |
| `WorkflowMemoryLimits.maxKeyBytes` | `number` | [`resolveWorkflowMemoryLimits`](../../../../src/workflows/workflow-memory-policy.ts) | Public operation · `backend/torrent/memory.md` |
| `WorkflowMemoryLimits.maxValueBytes` | `number` | `resolveWorkflowMemoryLimits` | Public operation · `backend/torrent/memory.md` |
| `WorkflowMemoryLimits.maxEntries` | `number` | `resolveWorkflowMemoryLimits` | Public operation · `backend/torrent/memory.md` |
| `WorkflowMemoryLimits.maxTotalBytes` | `number` | `resolveWorkflowMemoryLimits` | Public operation · `backend/torrent/memory.md` |
| `WorkflowServiceOptions.clock` | `WorkflowClock` | [`WorkflowService`](../../../../src/workflows/workflow-service.ts) construction | Public standalone · `backend/torrent/configuration.md#service` |
| `WorkflowServiceOptions.runtime` | `WorkflowRuntimeStore` | `WorkflowService` compatibility construction | Public standalone · same guide |
| `WorkflowServiceOptions.wakeTimer` | `WorkflowWakeTimer \| false` | `WorkflowService` construction | Public standalone · same guide |
| `WorkflowServiceOptions.shutdownGraceMs` | `number` | `WorkflowService` lifecycle | Public standalone · `backend/torrent/lifecycle.md` |
| `WorkflowServiceOptions.interactionAuthority` | `WorkflowInteractionAuthority` | `WorkflowService` construction | Public standalone · `backend/torrent/interactions.md` |
| `WorkflowServiceOptions.tenancyMode` | `'single' \| 'multi'` | `WorkflowService` authority/scoping | Public standalone · `backend/torrent/security.md` |
| `WorkflowServiceOptions.authorityStore` | `WorkflowExecutionAuthorityStore` | `WorkflowService` authority capture | Public standalone · `backend/torrent/security.md` |
| `WorkflowServiceOptions.authorityProvider` | `WorkflowExecutionAuthorityProvider \| null` | `WorkflowService` live authority | Public standalone · `backend/torrent/security.md` |
| `WorkflowServiceOptions.serviceProvider` | `WorkflowExecutionServiceProvider \| null` | `WorkflowService` execution services | Public standalone · `backend/torrent/configuration.md#service` |
| `WorkflowServiceOptions.observability` | `WorkflowObservability` | `WorkflowService` event boundary | Public standalone · `backend/torrent/observability.md` |
| `WorkflowServiceOptions.runtimeOwnership` | `WorkflowRuntimeOwnershipOptions` | runtime owner lease | Public standalone · `backend/torrent/recovery.md` |
| `WorkflowServiceOptions.onRuntimeOwnershipLost` | `(error: WorkflowError) => void \| Promise<void>` | plugin-owner lifecycle callback; annotated internal | Exported type contains internal seam; architecture-only |

`initialMemory` and `memoryLimits` are not projected by the HTTP start contract
and legacy sequential workflows reject them. They are trusted graph service
options, immutable and restart-persistent once admitted.

## Doctor And CLI Options

### Doctor Programmatic And App Hints

`PlatformDoctorOptions` and `UsageAuditOptions` are public through `/doctor` and
`/server`. `AppDoctorConfig` is the narrower managed app hint already cataloged
above. Doctor config discovery imports the selected trusted module and then
discovers conventional resource modules; it is not a side-effect-free parser.

| Type and field | Exact declared type | Resolver / command evidence | Classification and planned guide |
| --- | --- | --- | --- |
| `PlatformDoctorOptions.strict` | `boolean` | [`platform-doctor.ts`](../../../../src/doctor/platform-doctor.ts) | Public standalone · `cli/doctor/configuration.md` |
| `PlatformDoctorOptions.env` | `Record<string, string \| undefined>` | provider/config Doctor checks | Public standalone; values must remain secret-safe · same guide |
| `PlatformDoctorOptions.projectRoot` | `string` | usage audit | Public standalone · same guide |
| `PlatformDoctorOptions.usageAudit` | `boolean \| UsageAuditOptions` | usage audit normalization | Public standalone · same guide |
| `UsageAuditOptions.enabled` | `boolean` | usage audit normalization | Public standalone · `cli/doctor/usage-audit.md` |
| `UsageAuditOptions.include` | `string[]` | usage audit source selection | Public standalone · same guide |
| `UsageAuditOptions.exclude` | `string[]` | usage audit source selection | Public standalone · same guide |
| `UsageAuditOptions.maxFileLines` | `number` | usage audit normalization | Public standalone · same guide |
| `UsageAuditOptions.rules` | `Record<string, UsageAuditRuleSeverity>` | usage audit normalization | Public standalone · same guide |
| `UsageAuditOptions.allow` | `UsageAuditAllowEntry[]` | usage audit normalization | Public standalone · same guide |
| `UsageAuditAllowEntry.code` | `string` | usage audit allow matching | Public standalone · same guide |
| `UsageAuditAllowEntry.path` | `string` | usage audit allow matching | Public standalone · same guide |

The Doctor CLI parser in [`doctor/run.ts`](../../../../src/doctor/run.ts)
accepts `--config`, `--strict`, `--json`, `--no-usage-audit`,
`--max-file-lines`, repeatable `--usage-include`, repeatable `--usage-exclude`,
and `--help`/`-h`. These shell flags map into the programmatic options above;
`--config` selects a trusted module to import and `--json` controls output rather
than platform configuration.

### Scaffold And Updater Invocation

| Type and field | Exact declared type | Consumption evidence | Classification and planned guide |
| --- | --- | --- | --- |
| `ScaffoldZeroAppOptions.targetDir` | `string` (required) | [`scaffoldZeroApp`](../../../../src/create-zero/scaffold.ts) | CLI invocation · `cli/tooling/scaffolding.md` |
| `ScaffoldZeroAppOptions.packageName` | `string` | `scaffoldZeroApp` | CLI invocation · same guide |
| `ScaffoldZeroAppOptions.force` | `boolean` | safe scaffold path/swap | CLI invocation · same guide |
| `ScaffoldZeroAppOptions.prepareStagedApp` | `(stagingDir) => Promise<void>` | staged scaffold preparation | Programmatic invocation seam · same guide |
| `ScaffoldZeroAppOptions.zeroDependency` | `string` | generated package manifest | Programmatic invocation seam · same guide |
| `ScaffoldZeroAppOptions.templateDir` | `string` | safe scaffold source resolution | Programmatic invocation seam · same guide |
| `ZeroUpdateOptions.projectDir` | `string` (required) | [`runZeroUpdate`](../../../../src/update/run.ts) | CLI invocation · `cli/tooling/updating.md` |
| `ZeroUpdateOptions.mode` | `ZeroUpdateMode` | updater mode selection | CLI invocation · same guide |
| `ZeroUpdateOptions.localFrameworkDir` | `string` | local archive mode | CLI invocation · same guide |
| `ZeroUpdateOptions.latest` | `boolean` | registry target selection | CLI invocation · same guide |
| `ZeroUpdateOptions.dryRun` | `boolean` | updater plan boundary | CLI invocation · same guide |
| `ZeroUpdateOptions.check` | `boolean` | opt-in app typecheck/Doctor after install | CLI invocation · same guide |
| `ZeroUpdateOptions.skipChecks` | `boolean` | compatibility spelling for safe default | CLI invocation · same guide |

`UpdateCommandOptions`, `ZeroUpdateDependencies`, and result records are
programmatic dependency/result contracts, not user configuration. The updater
refreshes the managed framework archive and its dependency metadata while
preserving app-owned source/config and unrelated dependencies; it does not turn
runtime feature config into CLI flags.

## Resolver, Environment, And Runtime-Origin Follow-Up

This catalog deliberately does not invent one platform-wide precedence rule.
The final configuration references must derive each rule from the owning
resolver. Source inspection already establishes examples of intentionally
different behavior:

| Configuration path | Source-observed origin/precedence boundary | Evidence |
| --- | --- | --- |
| `vector.dataDir` | Environment is consulted before explicit config | [`vector-config.ts`](../../../../src/vector/vector-config.ts) |
| `vector.defaultDimensions` | Explicit config is consulted before environment | [`vector-config.ts`](../../../../src/vector/vector-config.ts) |
| `pdf.browser.executablePath` | Explicit config is consulted before environment | [`pdf-config.ts`](../../../../src/pdf/pdf-config.ts) |
| `storage.signingSecret` | Explicit config, then environment, then a persisted generated key at storage startup | [`storage-config.ts`](../../../../src/storage/storage-config.ts) and storage startup |
| AI providers/aliases | Provider-specific explicit/environment resolution; `null` can suppress ambient API-key/base-URL fallback | [`ai-env-provider-resolution.ts`](../../../../src/ai/ai-env-provider-resolution.ts), [`ai-env-selection.ts`](../../../../src/ai/ai-env-selection.ts) |
| `email.from` / `email.replyTo` | Explicit non-blank config is consulted before `EMAIL_FROM` / `EMAIL_REPLY_TO` | [`runtime.ts`](../../../../src/email/runtime.ts) |
| Email Resend key | Explicit Resend config or server environment during provider construction | [`resend-email-provider.ts`](../../../../src/email/resend-email-provider.ts) |

The reader-facing configuration guide still needs, per field, verified defaults,
accepted runtime values, restart behavior, Doctor parity, redaction/projection,
and cross-feature constraints. This ledger records field coverage and owning
evidence; it is not a substitute for those guides.

## Unresolved And Deliberately Excluded Items

- The provider catalog describes supported adapters and environment key families;
  there is no implemented live Gateway model/pricing catalog or database-backed
  AI provider configuration control plane. Keep both as roadmap material.
- Direct plugin/service dependency records frequently expose callbacks, stores,
  runtime containers, and resolved config. They are not additional keys for the
  corresponding managed `AppConfig` object.
- `DatabaseCoordinatorOptions` and `SubprocessDatabaseExecutorOptions` remain
  source-internal despite being exported by the internal `src/databases` barrel.
  Package reachability, not a source `export`, defines the public contract.
- Type comments that state a default remain unverified until the owning resolver
  or constructor and its focused test are reconciled. No default should be copied
  from this ledger without that check.
- No generic environment-to-config merge, hot reload, flattened config file
  discovery, redacted resolved-config projection, or static no-execution config
  inspection API is implemented merely because it is desirable documentation
  tooling.

## Completion Review

- [x] Public reachability checked against declared package routes.
- [x] Managed, standalone, per-operation, internal, and CLI options separated.
- [x] Main requested configuration hierarchies have field-level declaration and
  owning resolver/construction evidence.
- [x] Secrets and trusted callbacks identified without recording values.
- [x] Planned guide ownership recorded without placeholder links.
- [ ] Final guides verify every default, enum/range, precedence rule,
  interaction, startup/read time, Doctor behavior, and client projection.
- [ ] Independent review reconciles this ledger against exact-package type
  declarations before publication.
- [ ] Internal `_work` material remains excluded from the public documentation
  projection.

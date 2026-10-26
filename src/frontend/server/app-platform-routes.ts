/** Data, extension, health, and page-route composition for a Zero app. */

import type { Elysia } from 'elysia';

import {
  hasPageSessionCredential,
  resolvePageSessionAuth,
} from '../../auth/page-session';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import type { NormalizedAuthBehaviorConfig } from '../../auth/types';
import { resolveDataStudioInstallation } from '../../data-studio/data-studio-installation';
import { createDataStudioRouter } from '../../data-studio/data-studio-router';
import type { EmailRuntime } from '../../email';
import { EmailInboxService } from '../../email/inbox/inbox-service';
import { createEmailInboxRouter } from '../../email/inbox/inbox-router';
import { emailInboxConfigIssues } from '../../email/inbox/inbox-config';
import { resolve } from 'node:path';
import { emitPlatformCodeTo } from '../../observability';
import {
  createResourceCrudPlugin,
  type ResourceRegistry,
} from '../../resources';
import {
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_DATABASE_MANAGER,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createDataQueryPlugin } from '../../sync/data-query.plugin';
import type { ReactiveDB } from '../../sync/reactive-db';
import type { SyncPolicy } from '../../sync/sync-policy';
import { resolveGenericDataQueryableTables } from './app-platform-tables';
import type { AppIdentityProjectionRuntime } from './identity-projection-runtime';
import { createResourceTenantDatabaseAccess } from './request-database-client';
import { createRouterPlugin } from './router-plugin';
import { loadServerRoutePlugins } from './server-route-loader';
import {
  getAppStopHooks,
  type AppStopHook,
} from './app-stop-lifecycle';
import { createServerExtensionApp, type ZeroServerExtensionMountable } from './server-extensions';
import type { ResolvedAppFrontendAssets } from './server-plugin-build-types';
import { resolveBrowserSyncTablePlanes } from './sync-client-topology';
import type { ResolvedConfig } from './types';
import { createSeoRuntime } from '../../seo/runtime';
import { loggingPageRecovery } from './app-logging-page-recovery';

interface MountPlatformRoutesInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly syncDB: ReactiveDB;
  readonly config: ResolvedConfig;
  readonly syncPolicy: SyncPolicy;
  readonly resourceRegistry: ResourceRegistry;
  readonly resourceAuthConfig: NormalizedAuthBehaviorConfig;
  readonly emailRuntime: EmailRuntime;
  readonly clientEntry?: string;
  readonly cssPath?: string;
  readonly identityProjectionRuntime: AppIdentityProjectionRuntime | null;
  readonly serverExtensions?: readonly ZeroServerExtensionMountable[];
  readonly frontend?: ResolvedAppFrontendAssets;
}

/**
 * Mount request-facing routes after every service dependency is available.
 *
 * Returns the app-owned extension stop hooks so the composition root can drain
 * them while Guardian, Fabric, and the rest of the app-local runtime remain
 * available. Built-in route hooks are deliberately excluded from that phase.
 */
export async function mountPlatformRoutes({
  app,
  runtime,
  syncDB,
  config,
  syncPolicy,
  resourceRegistry,
  resourceAuthConfig,
  emailRuntime,
  clientEntry,
  cssPath,
  identityProjectionRuntime,
  serverExtensions,
  frontend,
}: MountPlatformRoutesInput): Promise<readonly AppStopHook[]> {
  const seo = createSeoRuntime(config.seo, config.app.publicUrl);
  const getAuthStore = () => runtime.get(ZERO_AUTH_STORE);
  const getTokenService = () => runtime.get(ZERO_AUTH_TOKEN_SERVICE);
  const getRequestCredentialResolver = () => (
    runtime.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER)
  );
  const getAuthorizationKernel = () => runtime.get(ZERO_AUTHORIZATION_KERNEL);
  const getRoleAssignments = () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE);
  const observabilityRuntime = runtime.require(ZERO_OBSERVABILITY_RUNTIME);

  if (config.logging && config.auth !== false) {
    const { createLoggingRouter } = await import('../../logging/logging-router');
    app.use(await createServerExtensionApp({ name: 'zero.logging', extensions: [createLoggingRouter({ pageRecovery: loggingPageRecovery(runtime, config.app.publicUrl) })], runtime }) as any);
  }
  if (config.email && config.email.inbox) {
    const issues = emailInboxConfigIssues(config); if (issues.length) throw new Error(`[email.inbox] ${issues.join(' ')}`);
    const inbox = config.email.inbox;
    if (resourceAuthConfig.tenancy.mode === 'multi' && !inbox.accounts) throw new Error('[email.inbox] Multi-tenant mail requires an authorized accounts resolver.');
    if (!inbox.accounts && !emailRuntime.mailbox) throw new Error('[email.inbox] Configure email.imap or supply an accounts resolver.');
    const statePath = inbox.statePath === ':memory:' ? ':memory:' : resolve(config.projectRoot, inbox.statePath);
    const service = new EmailInboxService({ ...inbox, statePath }, emailRuntime);
    runtime.addCleanup(() => service.close());
    app.use(await createServerExtensionApp({ name: 'zero.email-inbox', extensions: [createEmailInboxRouter(service)], runtime }) as any);
  }

  app.use(createDataQueryPlugin({
    queryableTables: resolveGenericDataQueryableTables(config.lazyTables),
    tableColumns: config.tableColumns,
    policy: syncPolicy,
    getTokenService: config.auth !== false ? getTokenService : undefined,
    getRequestCredentialResolver: config.auth !== false
      ? getRequestCredentialResolver
      : undefined,
    getUserStore: config.auth !== false ? getAuthStore : undefined,
    getAuthorizationKernel: config.auth !== false
      ? getAuthorizationKernel
      : undefined,
    getRoleAssignments: config.auth !== false ? getRoleAssignments : undefined,
    getDB: () => syncDB,
    getDatabaseManager: () => runtime.get(ZERO_DATABASE_MANAGER),
    resourceRegistry,
    resourceAuthConfig,
    tenancyMode: resourceAuthConfig.tenancy.mode,
    managedTables: new Set(Object.keys(config.tables)),
    observability: runtime.get(ZERO_OBSERVABILITY_RUNTIME),
  }));

  if (config.resourceRoutes !== false) {
    app.use(createResourceCrudPlugin({
      registry: resourceRegistry,
      tables: config.tables,
      authConfig: resourceAuthConfig,
      tenancyMode: resourceAuthConfig.tenancy.mode,
      getTokenService: config.auth !== false ? getTokenService : undefined,
      getRequestCredentialResolver: config.auth !== false
        ? getRequestCredentialResolver
        : undefined,
      getUserStore: config.auth !== false ? getAuthStore : undefined,
      getAuthorizationKernel: config.auth !== false
        ? getAuthorizationKernel
        : undefined,
      getRoleAssignments: config.auth !== false ? getRoleAssignments : undefined,
      getDB: () => syncDB,
      observability: runtime.get(ZERO_OBSERVABILITY_RUNTIME),
      getTenantDatabaseClient: ({ scope, assertCurrentAuthoritySync }) =>
        createResourceTenantDatabaseAccess({
          manager: runtime.get(ZERO_DATABASE_MANAGER),
          scope: trustedSystemServiceDataScope({
            scopeKind: 'tenant',
            tenantId: scope.tenantId,
          }),
          assertCurrentAuthoritySync,
        }),
      ensureIdentityAnchors: identityProjectionRuntime
        ? ({ resource, authContext }) =>
            identityProjectionRuntime.ensureApplicationIdentityAnchors(
              resource.table,
              authContext,
            )
        : undefined,
      emitCode: (definition, options) => emitPlatformCodeTo(
        runtime.require(ZERO_OBSERVABILITY_RUNTIME),
        definition,
        options,
      ),
      ...config.resourceRoutes,
    }));
  }

  if (resolveDataStudioInstallation(
    config.tables,
    resourceRegistry,
    config.databaseTopology.mode === 'multiple'
      ? config.databaseTopology.realm
      : null,
    config.declaredSyncModes,
  )) {
    app.use(await createServerExtensionApp({
      name: 'zero.data-studio',
      extensions: [createDataStudioRouter()],
      runtime,
    }) as any);
  }

  const frontendContext = { seo, projectRoot: config.projectRoot, appDir: config.appDir, appIdentity: config.app, generatedDir: config.generatedDir, pluginBuildFiles: config.pluginBuildFiles, frontend: frontend ?? Object.freeze({ plugins: Object.freeze({}) }) };
  const serverRoutePlugins = serverExtensions === undefined ? await loadServerRoutePlugins({
    runtime,
    frontendContext,
    extensionDirs: [
      { kind: 'plugins', dir: config.serverPluginsDir },
      { kind: 'middleware', dir: config.serverMiddlewareDir },
      { kind: 'endpoints', dir: config.serverEndpointsDir },
      { kind: 'routes', dir: config.serverRoutesDir },
    ],
  }) : serverExtensions.length === 0 ? [] : [await createServerExtensionApp({
    extensions: [...serverExtensions], runtime,
    frontendContext,
  })];
  const hooksBeforeAppExtensions = new Set(getAppStopHooks(app));
  for (const serverRoutePlugin of serverRoutePlugins) {
    app.use(serverRoutePlugin as any);
  }
  const appExtensionStopHooks = getAppStopHooks(app).filter(
    (hook) => !hooksBeforeAppExtensions.has(hook),
  );

  app.get('/api/health', () => ({ status: 'ok', uptime: process.uptime() }));

  // The file router is the final catch-all. Request URLs remain derived at
  // runtime so this composition is independent of its eventual listener.
  app.use(createRouterPlugin({
    seo,
    observability: observabilityRuntime,
    appDir: config.appDir,
    outDir: config.outDir,
    clientEntry,
    cssPath,
    assetFiles: config.frontendAssetFiles,
    platformConfig: {
      url: '',
      auth: config.auth !== false,
      email: emailRuntime.enabled,
      stateSync: config.stateSync,
      presence: config.auth !== false && config.auth.presence?.enabled === true,
      vectorVisualization: config.vectorVisualization !== false,
      logging: config.logging !== false,
      loggingRequired: config.logging !== false && config.logging.policy.complianceRequested,
      loggingPolicyVersion: config.logging !== false ? config.logging.policyVersion : undefined,
      tableSyncModes: config.resolvedSyncModes,
      tableSyncPlanes: resolveBrowserSyncTablePlanes(
        Object.keys(config.tables),
        resourceRegistry,
      ),
      managedTableNames: Object.keys(config.tables).sort(),
      publicPaths: config.publicPaths,
      routeAuth: config.routeAuth,
      loginPath: config.loginPath,
      postLoginPath: config.postLoginPath,
    },
    ...(config.auth !== false
      ? {
          authorization: {
            getKernel: getAuthorizationKernel,
            getPropertyStore: getAuthStore,
            getRoleAssignments,
          },
          authGuard: {
            routeAuth: config.routeAuth,
            publicPaths: config.publicPaths,
            loginPath: config.loginPath,
            postLoginPath: config.postLoginPath,
            resolvePageAuth: async (request: Request) => {
              const auth = await resolvePageSessionAuth(request, getTokenService());
              return auth ? { ...auth } : null;
            },
            hasPageCredential: (request: Request) => hasPageSessionCredential(request, getTokenService()),
          },
        }
      : {}),
    ...(config.sitemap
      ? {
          sitemap: {
            config: config.sitemap,
            publicUrl: config.app.publicUrl,
            routeAuth: config.routeAuth,
            publicPaths: config.publicPaths,
          },
        }
      : {}),
  }));

  return appExtensionStopHooks;
}

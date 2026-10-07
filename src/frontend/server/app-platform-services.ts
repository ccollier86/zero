/** Runtime-backed service plugin composition mounted before application routes. */

import type { Elysia } from 'elysia';

import { createAIPlugin } from '../../ai';
import { isPolicyTrustedUserProperty } from '../../auth/auth-config';
import {
  createAuthMiddleware,
  type AuthMiddlewareAuthorizationOptions,
} from '../../auth/auth.middleware';
import { createAuthPlugin } from '../../auth/auth.plugin';
import type { AuthRuntime } from '../../auth/auth-runtime';
import type { TokenService } from '../../auth/token-service';
import {
  AuthError,
  type NormalizedAuthBehaviorConfig,
} from '../../auth/types';
import type { EmailRuntime } from '../../email';
import { createKvPlugin } from '../../kv';
import { createNotificationPlugin } from '../../notifications/notification.plugin';
import { createObservabilityPlugin } from '../../observability';
import { createPdfPlugin } from '../../pdf';
import { createRoomPlugin } from '../../rooms/room.plugin';
import {
  ZERO_AUTH_AUDIT_SERVICE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_AI_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME,
} from '../../runtime/service-keys';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import { createSchedulerPlugin } from '../../scheduler';
import { SchedulerService } from '../../scheduler/scheduler-service';
import { createStoragePlugin } from '../../storage/storage.plugin';
import type { ReactiveDB } from '../../sync/reactive-db';
import { createPlatformTokenPlugin } from '../../tokens';
import { createVectorPlugin } from '../../vector';
import { createWorkflowPlugin } from '../../workflows';
import {
  NOT_REQUIRED_DATA_REALM_READINESS,
  type AppIdentityProjectionRuntime,
} from './identity-projection-runtime';
import type { ResolvedConfig } from './types';
import { createWorkflowExecutionServiceProvider } from './workflow-execution-services';
import { PresenceService, ZERO_GUARDIAN_PRESENCE } from '../../presence/presence-service';
import { ManagedPresencePublisher } from '../../presence/presence-managed-publisher';
import { createPresencePlugin } from '../../presence/presence.plugin';
import { composeManagedUserAvatars } from './app-user-avatars';
import { trustedSystemServiceDataScope } from '../../auth/service-data-scope';
import { ZERO_DATABASE_MANAGER } from '../../runtime/service-keys';
import { createAuthPlatformCodeEmitter } from '../../auth/auth-observability';

interface MountPlatformServicesInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly systemDB: ReactiveDB;
  readonly config: ResolvedConfig;
  readonly resourceAuthConfig: NormalizedAuthBehaviorConfig;
  readonly emailRuntime: EmailRuntime;
  readonly identityProjectionRuntime: AppIdentityProjectionRuntime | null;
}

/** Mount tokens, auth, and the platform's optional runtime services in order. */
export async function mountPlatformServices({
  app,
  runtime,
  systemDB,
  config,
  resourceAuthConfig,
  emailRuntime,
  identityProjectionRuntime,
}: MountPlatformServicesInput): Promise<void> {
  const getAuthStore = () => runtime.get(ZERO_AUTH_STORE);
  const getTokenService = () => runtime.get(ZERO_AUTH_TOKEN_SERVICE);
  const getRequestCredentialResolver = () => (
    runtime.get(ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER)
  );
  const authorization = {
    getRequestCredentialResolver,
    getAuthorizationKernel: () => runtime.get(ZERO_AUTHORIZATION_KERNEL),
    getPropertyStore: getAuthStore,
    getRoleAssignments: () => runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE),
  };
  const managedStartup: { auth: AuthRuntime | null } = { auth: null };
  const managedInitializers: Array<() => Promise<void>> = [];

  app.use(createPlatformTokenPlugin({ db: systemDB, runtime }));

  if (config.auth !== false) {
    app.use(
      createAuthPlugin({
        db: systemDB,
        runtime,
        emailRuntime,
        accessTokenTTL: config.auth.accessTokenTTL,
        refreshTokenTTL: config.auth.refreshTokenTTL,
        audit: config.auth.audit,
        tenancy: config.auth.tenancy,
        authorization: config.auth.authorization,
        bootstrap: config.auth.bootstrap,
        registration: config.auth.registration,
        requestAdmission: config.auth.requestAdmission,
        account: config.auth.account,
        mfa: config.auth.mfa,
        accountEmails: config.auth.accountEmails,
        branding: config.auth.branding,
        emails: config.auth.emails,
        userProperties: config.auth.userProperties,
        strictUserProperties: config.auth.strictUserProperties,
        nativeApps: config.auth.nativeApps,
        apiKeys: config.auth.apiKeys,
        userProfile: config.auth.userProfile,
        presence: config.auth.presence,
        profileSchemaInstallAllowed: config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral',
        profileContactSchemaInstallAllowed: config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral',
        profileCompletionSchemaInstallAllowed: config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral',
        presenceSchemaInstallAllowed: config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral',
        phoneVerificationAdapter: config.auth.phoneVerificationAdapter,
        identityProjection: identityProjectionRuntime?.lifecycle,
        dataRealmReadiness: identityProjectionRuntime
          ?? NOT_REQUIRED_DATA_REALM_READINESS,
        nativeIssuer: resourceAuthConfig.nativeApps.issuer
          ?? nativeIssuerFromPublicUrl(config.app.publicUrl),
        nativeAudience: config.app.publicUrl?.replace(/\/+$/, ''),
        onRuntimeCreated(created) {
          managedStartup.auth = created;
        },
        loginPath: config.loginPath,
        registrationPath: config.registrationPath,
      }),
    );

    app.use(createAuthMiddleware(getTokenService, {
      getRequestCredentialResolver,
      getAuthorizationKernel: authorization.getAuthorizationKernel,
      getPropertyStore: getAuthStore,
      getRoleAssignments: authorization.getRoleAssignments,
    }));
  }

  const observabilityRuntime = runtime.require(ZERO_OBSERVABILITY_RUNTIME);
  app.use(createObservabilityPlugin({
    config: config.observability,
    runtime: observabilityRuntime,
    authEnabled: config.auth !== false,
  }));

  if (config.ai !== false) {
    app.use(createAIPlugin({
      config: config.ai,
      authEnabled: config.auth !== false,
      runtime,
    }));
  }
  if (config.vector !== false) {
    app.use(createVectorPlugin({ config: config.vector, runtime }));
  }
  if (config.pdf !== false) {
    app.use(createPdfPlugin({ config: config.pdf, runtime }));
  }
  if (config.kv !== false) {
    app.use(createKvPlugin({
      ...config.kv,
      runtime,
      onInitializerCreated(initialize) {
        managedInitializers.push(initialize);
      },
    }));
  }

  const scheduler = new SchedulerService();
  app.use(createSchedulerPlugin({
    runtime,
    getTokenService,
    service: scheduler,
  }));

  if (config.auth !== false) {
    const presencePolicy = resourceAuthConfig.presence;
    let presence: PresenceService | null = null;
    app.use(createPresencePlugin({ getService: () => presence, getTokenService, authorization }));
    managedInitializers.push(async () => {
      if (presencePolicy.enabled) await managedStartup.auth!.start();
      const manager = runtime.require(ZERO_DATABASE_MANAGER);
      if (presencePolicy.enabled) manager.start();
      const installAllowed = config.migrate || manager.systemRuntime.sqlite.mode === 'ephemeral';
      const publisher = presencePolicy.enabled ? new ManagedPresencePublisher(manager,
        config.migrate || manager.appRuntime.sqlite.mode === 'ephemeral', resourceAuthConfig.tenancy.mode)
        : { publish: async () => { throw new AuthError('Presence is disabled', 'AUTH_PRESENCE_DISABLED', 404); }, isReady: () => false };
      presence = new PresenceService(systemDB, presencePolicy, resourceAuthConfig.tenancy.mode, publisher, installAllowed,
        Date.now, crypto.randomUUID(), createAuthPlatformCodeEmitter(runtime));
      runtime.set(ZERO_GUARDIAN_PRESENCE, presence);
      const removeAdmission = presencePolicy.enabled && resourceAuthConfig.tenancy.mode === 'multi'
        ? manager.installTenantPresenceAdmission(tenantId => presence!.ensureScope(trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId }))) : null;
      runtime.addCleanup(async () => { removeAdmission?.(); await presence?.close(); runtime.clear(ZERO_GUARDIAN_PRESENCE, presence ?? undefined); });
      await presence.initialize();
    });
    app.use(createNotificationPlugin({
      db: systemDB,
      runtime,
      getTokenService,
      authorization,
      getScheduler: () => scheduler,
    }));
    app.use(createRoomPlugin({
      db: systemDB,
      runtime,
      getTokenService,
      authorization,
    }));
    const avatars = composeManagedUserAvatars(runtime, systemDB, resourceAuthConfig.userProfile,
      config.migrate || runtime.require(ZERO_DATABASE_MANAGER).systemRuntime.sqlite.mode === 'ephemeral');
    if (resourceAuthConfig.userProfile.enabled && resourceAuthConfig.userProfile.avatars.enabled) {
      managedInitializers.push(() => managedStartup.auth!.start());
    }
    app.use(avatars.plugin);
    app.use(createStoragePlugin({
      db: systemDB,
      localDir: config.storageDir,
      signingSecret: config.storage.signingSecret,
      onServiceCreated: avatars.onStorageCreated,
      captureUploadGrantCommitFence: avatars.captureUploadGrantCommitFence,
      defaultPresignedTTL: config.storage.defaultPresignedTTL,
      studio: config.storage.studio,
      runtime,
      getTokenService,
      authorization,
      getUserProperties: (userId) => getAuthStore()?.getProperties(userId) ?? {},
      getAuditService: () => runtime.get(ZERO_AUTH_AUDIT_SERVICE),
      isPolicyTrustedProperty: (key) => {
        const field = resourceAuthConfig.userProperties[key];
        return field ? isPolicyTrustedUserProperty(field) : false;
      },
    }));
    if (config.workflows !== false) {
      mountWorkflowService({
        app,
        runtime,
        systemDB,
        scheduler,
        managedInitializers,
        getTokenService,
        authorization,
        managedStartup,
        workflowConfig: config.workflows,
      });
    }
  }

  // Managed createApp() composition must settle async service recovery before
  // the app is published. Elysia's Bun adapter does not await onStart promises;
  // the plugin reuses this same single-flight initializer when listen() runs.
  await Promise.all(managedInitializers.map((initialize) => initialize()));
}

interface WorkflowMountInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly systemDB: ReactiveDB;
  readonly scheduler: SchedulerService;
  readonly managedInitializers: Array<() => Promise<void>>;
  readonly getTokenService: () => TokenService | null;
  readonly authorization: AuthMiddlewareAuthorizationOptions;
  readonly workflowConfig: Exclude<ResolvedConfig['workflows'], false>;
  readonly managedStartup: {
    auth: AuthRuntime | null;
  };
}

function mountWorkflowService({
  app,
  runtime,
  systemDB,
  scheduler,
  managedInitializers,
  getTokenService,
  authorization,
  managedStartup,
  workflowConfig,
}: WorkflowMountInput): void {
  app.use(createWorkflowPlugin({
    db: systemDB,
    runtime,
    scheduler,
    register: workflowConfig.register
      ? (registry) => workflowConfig.register?.(registry, {
        ai: runtime.get(ZERO_AI_SERVICE),
      })
      : undefined,
    onServiceCreated: workflowConfig.onServiceCreated,
    shutdownGraceMs: workflowConfig.shutdownGraceMs,
    interactionAuthority: workflowConfig.interactionAuthority,
    executionServices: createWorkflowExecutionServiceProvider({ runtime }),
    ensureAuthReady: async () => {
      if (!managedStartup.auth) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }
      await managedStartup.auth.start();
    },
    getTokenService,
    authorization,
  }, {
    managedStartup: true,
    onInitializerCreated(initialize) {
      managedInitializers.push(initialize);
    },
  }));
}

function nativeIssuerFromPublicUrl(publicUrl: string | undefined): string | undefined {
  return publicUrl ? `${publicUrl.replace(/\/+$/, '')}/auth` : undefined;
}

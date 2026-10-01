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
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_REQUEST_CREDENTIAL_RESOLVER,
  ZERO_AUTH_STORE,
  ZERO_AUTH_TOKEN_SERVICE,
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
import type { WorkflowService } from '../../workflows/workflow-service';
import {
  NOT_REQUIRED_DATA_REALM_READINESS,
  type AppIdentityProjectionRuntime,
} from './identity-projection-runtime';
import type { ResolvedConfig } from './types';
import { createWorkflowExecutionServiceProvider } from './workflow-execution-services';

interface MountPlatformServicesInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly systemDB: ReactiveDB;
  readonly config: ResolvedConfig;
  readonly resourceAuthConfig: NormalizedAuthBehaviorConfig;
  readonly emailRuntime: EmailRuntime;
  readonly identityProjectionRuntime: AppIdentityProjectionRuntime | null;
}

export interface MountedPlatformServices {
  /** Finish fallible async owners before createApp publishes a listenable app. */
  start(): Promise<void>;
}

/** Mount tokens, auth, and the platform's optional runtime services in order. */
export function mountPlatformServices({
  app,
  runtime,
  systemDB,
  config,
  resourceAuthConfig,
  emailRuntime,
  identityProjectionRuntime,
}: MountPlatformServicesInput): MountedPlatformServices {
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
  const managedStartup: {
    auth: AuthRuntime | null;
    kv: (() => Promise<void>) | null;
    workflows: (() => Promise<void>) | null;
  } = { auth: null, kv: null, workflows: null };

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
        managedStartup.kv = initialize;
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
    app.use(createStoragePlugin({
      db: systemDB,
      localDir: config.storageDir,
      signingSecret: config.storage.signingSecret,
      defaultPresignedTTL: config.storage.defaultPresignedTTL,
      runtime,
      getTokenService,
      authorization,
      getUserProperties: (userId) => getAuthStore()?.getProperties(userId) ?? {},
      isPolicyTrustedProperty: (key) => {
        const field = resourceAuthConfig.userProperties[key];
        return field ? isPolicyTrustedUserProperty(field) : false;
      },
    }));
    mountWorkflowService({
      app,
      runtime,
      systemDB,
      scheduler,
      getTokenService,
      authorization,
      managedStartup,
    });
  }

  return {
    async start() {
      await managedStartup.auth?.start();
      await managedStartup.kv?.();
      await managedStartup.workflows?.();
    },
  };
}

interface WorkflowMountInput {
  readonly app: Elysia;
  readonly runtime: ZeroAppRuntime;
  readonly systemDB: ReactiveDB;
  readonly scheduler: SchedulerService;
  readonly getTokenService: () => TokenService | null;
  readonly authorization: AuthMiddlewareAuthorizationOptions;
  readonly managedStartup: {
    auth: AuthRuntime | null;
    kv: (() => Promise<void>) | null;
    workflows: (() => Promise<void>) | null;
  };
}

function mountWorkflowService({
  app,
  runtime,
  systemDB,
  scheduler,
  getTokenService,
  authorization,
  managedStartup,
}: WorkflowMountInput): void {
  let workflowService: WorkflowService | null = null;
  app.use(createWorkflowPlugin({
    db: systemDB,
    runtime,
    executionServices: createWorkflowExecutionServiceProvider({ runtime }),
    ensureAuthReady: async () => {
      if (!managedStartup.auth) {
        throw new AuthError('Auth not initialized', 'AUTH_NOT_READY', 503);
      }
      await managedStartup.auth.start();
    },
    getTokenService,
    authorization,
    onServiceCreated(service) {
      workflowService = service;
    },
    onInitializerCreated(initialize) {
      managedStartup.workflows = initialize;
    },
  }));

  scheduler.register({
    name: 'workflow-retries',
    pattern: '* * * * *',
    run: async () => {
      if (workflowService) await workflowService.pollRetries();
    },
  });
  scheduler.register({
    name: 'workflow-timeouts',
    pattern: '* * * * *',
    run: () => {
      if (workflowService) workflowService.pollTimeouts();
    },
  });
}

function nativeIssuerFromPublicUrl(publicUrl: string | undefined): string | undefined {
  return publicUrl ? `${publicUrl.replace(/\/+$/, '')}/auth` : undefined;
}

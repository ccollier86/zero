/**
 * server-services.ts
 *
 * Owns the app-facing `zero` backend service context for package-mode server
 * code. Managed apps bind this surface to a concrete ZeroAppRuntime; the
 * no-argument path remains only for standalone compatibility.
 */

import {
  getAuthorizationKernel,
  getAuthorizationRoleService,
  getAuthStore,
  getTokenService,
} from '../../auth/auth.plugin';
import type { AuthorizationKernel } from '../../auth/authorization-kernel';
import type { AuthorizationRoleService } from '../../auth/authorization-role-service';
import type { TokenService } from '../../auth/token-service';
import type { UserStore } from '../../auth/user-store';
import type { EmailService } from '../../email';
import { getEmailRuntime, getEmailService } from '../../email';
import type { EmailRuntime } from '../../email/types';
import type { NotificationService } from '../../notifications/notification-service';
import { getNotificationService } from '../../notifications';
import type { RoomService } from '../../rooms/room-service';
import { getRoomService } from '../../rooms';
import {
  emitPlatformCode,
  emitPlatformCodeTo,
  emitPlatformEvent,
  emitPlatformEventTo,
  errorPlatform,
  getObservabilityRuntime,
  getPlatformEventStore,
  getPlatformSink,
  logPlatformInfo,
  warnPlatform,
  type PlatformEventStore,
  type PlatformObservabilityRuntime,
  type PlatformSink,
} from '../../observability';
import type { SchedulerService } from '../../scheduler/scheduler-service';
import { getScheduler } from '../../scheduler';
import type { ReactiveDB } from '../../sync';
import { getSyncDB } from '../../sync';
import type { AIService } from '../../ai';
import { getAI } from '../../ai';
import type { VectorService } from '../../vector';
import { getVectorStore } from '../../vector';
import type { StorageService } from '../../storage';
import { getStorageService } from '../../storage';
import type { WorkflowRegistry, WorkflowService } from '../../workflows';
import { getWorkflowRegistry, getWorkflowService } from '../../workflows';
import type { ResourceRegistry } from '../../resources';
import { getResourceRegistry } from '../../resources';
import type { PlatformTokenService } from '../../tokens';
import { getPlatformTokenService } from '../../tokens';
import type { KvCounterService, KvLimiterService, KvService } from '../../kv';
import { getKvService } from '../../kv';
import type { PlatformSQLiteService } from '../../persistence';
import { getPlatformSQLiteService } from '../../persistence';
import type { DatabaseManager } from '../../databases/database-manager';
import type { PdfService } from '../../pdf';
import { getPdfService } from '../../pdf';
import type { ZeroAppRuntime } from '../../runtime/zero-app-runtime';
import {
  ZERO_AI_SERVICE,
  ZERO_AUTH_STORE,
  ZERO_AUTHORIZATION_KERNEL,
  ZERO_AUTHORIZATION_ROLE_SERVICE,
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_DATABASE_MANAGER,
  ZERO_EMAIL_RUNTIME,
  ZERO_KV_SERVICE,
  ZERO_NOTIFICATION_SERVICE,
  ZERO_OBSERVABILITY_RUNTIME,
  ZERO_PDF_SERVICE,
  ZERO_PLATFORM_TOKEN_SERVICE,
  ZERO_RESOURCE_REGISTRY,
  ZERO_ROOM_SERVICE,
  ZERO_SCHEDULER_SERVICE,
  ZERO_SQLITE_SERVICE,
  ZERO_STORAGE_SERVICE,
  ZERO_SYNC_DB,
  ZERO_VECTOR_SERVICE,
  ZERO_WORKFLOW_REGISTRY,
  ZERO_WORKFLOW_SERVICE,
} from '../../runtime/service-keys';

/** Auth services exposed under `zero.auth` in app-owned backend code. */
export interface ServerAuthServices {
  /** Immutable app-local authorization compiler/evaluator. */
  readonly authorization: AuthorizationKernel | null;
  /** Explicit alias for `authorization`. */
  readonly authorizationKernel: AuthorizationKernel | null;
  /** Headless advanced role-assignment service, or null outside advanced mode. */
  readonly roles: AuthorizationRoleService | null;
  /** Explicit alias for `roles`. */
  readonly roleService: AuthorizationRoleService | null;
  /** Current auth user store, or null when auth is disabled or not started. */
  readonly store: UserStore | null;
  /** Explicit alias for `store` when user-oriented naming is clearer. */
  readonly userStore: UserStore | null;
  /** Current token service, or null when auth is disabled or not started. */
  readonly tokens: TokenService | null;
  /** Explicit alias for `tokens` when service-oriented naming is clearer. */
  readonly tokenService: TokenService | null;
  /** Resolve the current auth user store lazily. */
  readonly getStore: typeof getAuthStore;
  /** Resolve the current auth user store lazily. */
  readonly getUserStore: typeof getAuthStore;
  /** Compatibility getter retained from the Phase 1 backend context. */
  readonly getTokenService: typeof getTokenService;
  /** Resolve the app-local authorization kernel lazily. */
  readonly getAuthorizationKernel: typeof getAuthorizationKernel;
  /** Resolve the app-local advanced role service lazily. */
  readonly getRoleService: typeof getAuthorizationRoleService;
}

/** Observability helpers exposed under `zero.observability`. */
export interface ServerObservabilityServices {
  /** Current observability runtime configuration and adapters. */
  readonly runtime: PlatformObservabilityRuntime;
  /** Current write sink. */
  readonly sink: PlatformSink;
  /** Current readable event store, when configured. */
  readonly store: PlatformEventStore | null;
  /** Resolve the active observability runtime lazily. */
  readonly getRuntime: typeof getObservabilityRuntime;
  /** Resolve the active write sink lazily. */
  readonly getSink: typeof getPlatformSink;
  /** Resolve the active readable event store lazily. */
  readonly getStore: typeof getPlatformEventStore;
  /** Emit a stable platform code. */
  readonly emitCode: typeof emitPlatformCode;
  /** Emit a custom platform event. */
  readonly emitEvent: typeof emitPlatformEvent;
  /** Emit a stable platform code at error level. */
  readonly error: typeof errorPlatform;
  /** Emit a stable platform code at info level. */
  readonly info: typeof logPlatformInfo;
  /** Emit a stable platform code at warning level. */
  readonly warn: typeof warnPlatform;
}

/** Platform services exposed under `zero` in app-owned server route handlers. */
export interface ServerRouteServices {
  /** Primary reactive database handle for app-owned server code. */
  readonly db: ReactiveDB;
  /** Backwards-compatible alias for the primary reactive database handle. */
  readonly syncDB: ReactiveDB;
  /** App-local database runtime manager, when managed database topology is mounted. */
  readonly databases: DatabaseManager | null;
  /** Shared platform SQLite foundation for backend-only SQL access. */
  readonly sql: PlatformSQLiteService | null;
  /** Explicit alias for the shared platform SQLite foundation. */
  readonly sqlite: PlatformSQLiteService | null;
  /** Auth store/token helpers. Values are null when auth is disabled. */
  readonly auth: ServerAuthServices;
  /** Generic platform action/resume token service. */
  readonly tokens: PlatformTokenService | null;
  /** Platform KV/cache service, when mounted. */
  readonly kv: KvService | null;
  /** Platform counter helpers, when KV is mounted. */
  readonly counter: KvCounterService | null;
  /** Platform rate limiter helpers, when KV is mounted. */
  readonly limiter: KvLimiterService | null;
  /** Internal AI service, when configured. */
  readonly ai: AIService | null;
  /** Primary vector store handle for app-owned server code, when configured. */
  readonly vector: VectorService | null;
  /** Backwards-compatible alias for the primary vector store handle. */
  readonly vectors: VectorService | null;
  /** Browser-grade PDF rendering service, when configured. */
  readonly pdf: PdfService | null;
  /** Email sending service. Uses a noop provider when email is disabled. */
  readonly email: EmailService;
  /** Active email runtime for provider/status inspection. */
  readonly emailRuntime: EmailRuntime;
  /** Storage service, when auth/storage are enabled. */
  readonly storage: StorageService | null;
  /** Notification service, when auth/notifications are enabled. */
  readonly notifications: NotificationService | null;
  /** Room service, when auth/rooms are enabled. */
  readonly rooms: RoomService | null;
  /** Scheduler service, when mounted. */
  readonly scheduler: SchedulerService | null;
  /** Workflow service, when auth/workflows are enabled. */
  readonly workflows: WorkflowService | null;
  /** Backwards-compatible alias for workflow registration. */
  readonly workflowRegistry: WorkflowRegistry | null;
  /** Registered app resource definitions and policy metadata. */
  readonly resources: ResourceRegistry;
  /** Observability emitters, sinks, and runtime inspection. */
  readonly observability: ServerObservabilityServices;
}

/**
 * Return a platform service context for backend code.
 *
 * Optional services resolve to null when disabled or not started. `db` and
 * `syncDB` intentionally throw if ReactiveDB is unavailable because app-owned
 * server routes must be mounted after the sync plugin.
 */
export function getServerRouteServices(runtime?: ZeroAppRuntime): ServerRouteServices {
  return createServerRouteServices(runtime);
}

/**
 * Create a lazy service context for route/plugin setup code.
 *
 * The returned object uses property getters instead of captured singleton
 * values, so app-owned setup can safely hold onto `zero` before every optional
 * platform plugin has completed startup.
 */
export function createLazyServerRouteServices(runtime?: ZeroAppRuntime): ServerRouteServices {
  return createServerRouteServices(runtime);
}

function createServerRouteServices(runtime?: ZeroAppRuntime): ServerRouteServices {
  return {
    get db() {
      return requireSyncDB(runtime);
    },
    get syncDB() {
      return requireSyncDB(runtime);
    },
    get databases() {
      return runtime ? runtime.get(ZERO_DATABASE_MANAGER) : null;
    },
    get sql() {
      return runtime
        ? runtime.get(ZERO_SQLITE_SERVICE)
        : getPlatformSQLiteService();
    },
    get sqlite() {
      return runtime
        ? runtime.get(ZERO_SQLITE_SERVICE)
        : getPlatformSQLiteService();
    },
    auth: createServerAuthServices(runtime),
    get tokens() {
      return runtime
        ? runtime.get(ZERO_PLATFORM_TOKEN_SERVICE)
        : getPlatformTokenService();
    },
    get kv() {
      return runtime ? runtime.get(ZERO_KV_SERVICE) : getKvService();
    },
    get counter() {
      return (runtime ? runtime.get(ZERO_KV_SERVICE) : getKvService())?.counters ?? null;
    },
    get limiter() {
      return (runtime ? runtime.get(ZERO_KV_SERVICE) : getKvService())?.limiter ?? null;
    },
    get ai() {
      return runtime ? runtime.get(ZERO_AI_SERVICE) : getAI();
    },
    get vector() {
      return runtime ? runtime.get(ZERO_VECTOR_SERVICE) : getVectorStore();
    },
    get vectors() {
      return runtime ? runtime.get(ZERO_VECTOR_SERVICE) : getVectorStore();
    },
    get pdf() {
      return runtime ? runtime.get(ZERO_PDF_SERVICE) : getPdfService();
    },
    get email() {
      if (!runtime) return getEmailService();
      return runtime.require(ZERO_EMAIL_RUNTIME).service as EmailService;
    },
    get emailRuntime() {
      return runtime ? runtime.require(ZERO_EMAIL_RUNTIME) : getEmailRuntime();
    },
    get storage() {
      return runtime ? runtime.get(ZERO_STORAGE_SERVICE) : getStorageService();
    },
    get notifications() {
      return runtime
        ? runtime.get(ZERO_NOTIFICATION_SERVICE)
        : getNotificationService();
    },
    get rooms() {
      return runtime ? runtime.get(ZERO_ROOM_SERVICE) : getRoomService();
    },
    get scheduler() {
      return runtime ? runtime.get(ZERO_SCHEDULER_SERVICE) : getScheduler();
    },
    get workflows() {
      return runtime ? runtime.get(ZERO_WORKFLOW_SERVICE) : getWorkflowService();
    },
    get workflowRegistry() {
      return runtime
        ? runtime.get(ZERO_WORKFLOW_REGISTRY)
        : getWorkflowRegistry();
    },
    get resources() {
      return runtime
        ? runtime.require(ZERO_RESOURCE_REGISTRY)
        : getResourceRegistry();
    },
    observability: createServerObservabilityServices(runtime),
  };
}

function createServerAuthServices(runtime?: ZeroAppRuntime): ServerAuthServices {
  const resolveStore = (): UserStore | null => runtime
    ? runtime.get(ZERO_AUTH_STORE)
    : getAuthStore();
  const resolveTokens = (): TokenService | null => runtime
    ? runtime.get(ZERO_AUTH_TOKEN_SERVICE)
    : getTokenService();
  const resolveAuthorization = (): AuthorizationKernel | null => runtime
    ? runtime.get(ZERO_AUTHORIZATION_KERNEL)
    : getAuthorizationKernel();
  const resolveRoles = (): AuthorizationRoleService | null => runtime
    ? runtime.get(ZERO_AUTHORIZATION_ROLE_SERVICE)
    : getAuthorizationRoleService();

  return {
    get authorization() {
      return resolveAuthorization();
    },
    get authorizationKernel() {
      return resolveAuthorization();
    },
    get roles() {
      return resolveRoles();
    },
    get roleService() {
      return resolveRoles();
    },
    get store() {
      return resolveStore();
    },
    get userStore() {
      return resolveStore();
    },
    get tokens() {
      return resolveTokens();
    },
    get tokenService() {
      return resolveTokens();
    },
    getStore: resolveStore,
    getUserStore: resolveStore,
    getTokenService: resolveTokens,
    getAuthorizationKernel: resolveAuthorization,
    getRoleService: resolveRoles,
  };
}

function createServerObservabilityServices(runtime?: ZeroAppRuntime): ServerObservabilityServices {
  const resolveRuntime = (): PlatformObservabilityRuntime => runtime
    ? runtime.require(ZERO_OBSERVABILITY_RUNTIME)
    : getObservabilityRuntime();
  const resolveSink = (): PlatformSink => resolveRuntime().sink;
  const resolveStore = (): PlatformEventStore | null => resolveRuntime().store;

  return {
    get runtime() {
      return resolveRuntime();
    },
    get sink() {
      return resolveSink();
    },
    get store() {
      return resolveStore();
    },
    getRuntime: resolveRuntime,
    getSink: resolveSink,
    getStore: resolveStore,
    emitCode: runtime
      ? (definition, options) => emitPlatformCodeTo(resolveRuntime(), definition, options)
      : emitPlatformCode,
    emitEvent: runtime
      ? (input) => emitPlatformEventTo(resolveRuntime(), input)
      : emitPlatformEvent,
    error: runtime
      ? (definition, options = {}) => emitPlatformCodeTo(resolveRuntime(), definition, {
          ...options,
          level: 'error',
        })
      : errorPlatform,
    info: runtime
      ? (definition, options = {}) => emitPlatformCodeTo(resolveRuntime(), definition, {
          ...options,
          level: 'info',
        })
      : logPlatformInfo,
    warn: runtime
      ? (definition, options = {}) => emitPlatformCodeTo(resolveRuntime(), definition, {
          ...options,
          level: 'warn',
        })
      : warnPlatform,
  };
}

function requireSyncDB(runtime?: ZeroAppRuntime): ReactiveDB {
  const syncDB = runtime ? runtime.get(ZERO_SYNC_DB) : getSyncDB();
  if (!syncDB) {
    throw new Error('[server-services] ReactiveDB is unavailable. Mount app routes through createApp() after the sync plugin.');
  }

  return syncDB;
}

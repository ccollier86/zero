/**
 * server-services.ts
 *
 * Owns the app-facing `zero` backend service context for package-mode server
 * code. This file resolves existing platform singleton boundaries into a
 * stable API surface; it does not mount Elysia plugins or register routes.
 */

import { getAuthStore, getTokenService } from '../../auth/auth.plugin';
import type { TokenService } from '../../auth/token-service';
import type { UserStore } from '../../auth/user-store';
import type { EmailService } from '../../email';
import { getEmailRuntime, getEmailService } from '../../email';
import type { EmailRuntime } from '../../email/types';
import type { NotificationService } from '../../notifications/notification-service';
import { getNotificationService } from '../../notifications';
import {
  emitPlatformCode,
  emitPlatformEvent,
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

/** Auth services exposed under `zero.auth` in app-owned backend code. */
export interface ServerAuthServices {
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
  /** Email sending service. Uses a noop provider when email is disabled. */
  readonly email: EmailService;
  /** Active email runtime for provider/status inspection. */
  readonly emailRuntime: EmailRuntime;
  /** Storage service, when auth/storage are enabled. */
  readonly storage: StorageService | null;
  /** Notification service, when auth/notifications are enabled. */
  readonly notifications: NotificationService | null;
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
 * Return the current process-wide platform service context for backend code.
 *
 * Optional services resolve to null when disabled or not started. `db` and
 * `syncDB` intentionally throw if ReactiveDB is unavailable because app-owned
 * server routes must be mounted after the sync plugin.
 */
export function getServerRouteServices(): ServerRouteServices {
  return createServerRouteServices();
}

/**
 * Create a lazy service context for route/plugin setup code.
 *
 * The returned object uses property getters instead of captured singleton
 * values, so app-owned setup can safely hold onto `zero` before every optional
 * platform plugin has completed startup.
 */
export function createLazyServerRouteServices(): ServerRouteServices {
  return createServerRouteServices();
}

function createServerRouteServices(): ServerRouteServices {
  return {
    get db() {
      return requireSyncDB();
    },
    get syncDB() {
      return requireSyncDB();
    },
    get sql() {
      return getPlatformSQLiteService();
    },
    get sqlite() {
      return getPlatformSQLiteService();
    },
    auth: createServerAuthServices(),
    get tokens() {
      return getPlatformTokenService();
    },
    get kv() {
      return getKvService();
    },
    get counter() {
      return getKvService()?.counters ?? null;
    },
    get limiter() {
      return getKvService()?.limiter ?? null;
    },
    get ai() {
      return getAI();
    },
    get vector() {
      return getVectorStore();
    },
    get vectors() {
      return getVectorStore();
    },
    get email() {
      return getEmailService();
    },
    get emailRuntime() {
      return getEmailRuntime();
    },
    get storage() {
      return getStorageService();
    },
    get notifications() {
      return getNotificationService();
    },
    get scheduler() {
      return getScheduler();
    },
    get workflows() {
      return getWorkflowService();
    },
    get workflowRegistry() {
      return getWorkflowRegistry();
    },
    get resources() {
      return getResourceRegistry();
    },
    observability: createServerObservabilityServices(),
  };
}

function createServerAuthServices(): ServerAuthServices {
  return {
    get store() {
      return getAuthStore();
    },
    get userStore() {
      return getAuthStore();
    },
    get tokens() {
      return getTokenService();
    },
    get tokenService() {
      return getTokenService();
    },
    getStore: getAuthStore,
    getUserStore: getAuthStore,
    getTokenService,
  };
}

function createServerObservabilityServices(): ServerObservabilityServices {
  return {
    get runtime() {
      return getObservabilityRuntime();
    },
    get sink() {
      return getPlatformSink();
    },
    get store() {
      return getPlatformEventStore();
    },
    getRuntime: getObservabilityRuntime,
    getSink: getPlatformSink,
    getStore: getPlatformEventStore,
    emitCode: emitPlatformCode,
    emitEvent: emitPlatformEvent,
    error: errorPlatform,
    info: logPlatformInfo,
    warn: warnPlatform,
  };
}

function requireSyncDB(): ReactiveDB {
  const syncDB = getSyncDB();
  if (!syncDB) {
    throw new Error('[server-services] ReactiveDB is unavailable. Mount app routes through createApp() after the sync plugin.');
  }

  return syncDB;
}

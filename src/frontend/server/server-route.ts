/**
 * server-route.ts
 *
 * Provides the app-owned Elysia route factory for package-mode apps. This file
 * owns route-context ergonomics only; platform services remain initialized by
 * createApp() and are resolved through their existing singleton boundaries.
 */

import { Elysia } from 'elysia';
import type { ElysiaConfig } from 'elysia';

import { createAuthMiddleware } from '../../auth/auth.middleware';
import { getTokenService } from '../../auth/auth.plugin';
import type { EmailService } from '../../email';
import { getEmailService } from '../../email';
import type { NotificationService } from '../../notifications/notification-service';
import { getNotificationService } from '../../notifications';
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

/** Platform services exposed under `zero` in app-owned server route handlers. */
export interface ServerRouteServices {
  syncDB: ReactiveDB;
  ai: AIService | null;
  vectors: VectorService | null;
  email: EmailService;
  notifications: NotificationService | null;
  scheduler: SchedulerService | null;
  storage: StorageService | null;
  workflowRegistry: WorkflowRegistry | null;
  workflows: WorkflowService | null;
}

/** Options accepted by createServerRoute(). */
export type ServerRouteOptions = ElysiaConfig<string>;

/**
 * Create an app-owned Elysia route plugin with Zero service helpers.
 *
 * The returned instance includes auth middleware for typed `authContext`,
 * `requireAuth()`, and `requireAdmin()` helpers, plus a `zero` object containing
 * server-only platform services. Mount these plugins through createApp()'s
 * `serverRoutesDir` loader or directly with `app.use()`.
 */
export function createServerRoute(options?: ServerRouteOptions) {
  return new Elysia(options)
    .use(createAuthMiddleware(getTokenService))
    .resolve({ as: 'global' }, function resolveZeroRouteServices() {
      return {
        zero: getServerRouteServices(),
      };
    });
}

/** Resolve the current process-wide platform services for a route request. */
function getServerRouteServices(): ServerRouteServices {
  const syncDB = getSyncDB();
  if (!syncDB) {
    throw new Error('[server-route] ReactiveDB is unavailable. Mount app routes through createApp() after the sync plugin.');
  }

  return {
    syncDB,
    ai: getAI(),
    vectors: getVectorStore(),
    email: getEmailService(),
    notifications: getNotificationService(),
    scheduler: getScheduler(),
    storage: getStorageService(),
    workflowRegistry: getWorkflowRegistry(),
    workflows: getWorkflowService(),
  };
}

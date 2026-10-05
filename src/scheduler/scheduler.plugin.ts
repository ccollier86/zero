/**
 * Mounts Scheduler's named Elysia plugin, live admin guards and lifecycle.
 * The service owns cron behavior; this transport preserves existing HTTP error
 * contracts and cleans up failed app-local composition before publishing it.
 */

import { Elysia, t } from 'elysia';
import { SchedulerService } from './scheduler-service';
import { SchedulerError } from './scheduler-error';
import { AuthError } from '../auth/types';
import { getPublicAuthErrorMessage } from '../auth/auth-error-response';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { getTokenService } from '../auth/auth.plugin';
import type { SchedulerPluginConfig } from './types';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { CompatibilityProviderRegistry } from '../runtime/compatibility-provider-registry';
import {
  ZERO_AUTH_TOKEN_SERVICE,
  ZERO_SCHEDULER_SERVICE,
} from '../runtime/service-keys';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { TokenService } from '../auth/token-service';

// ─── Legacy Compatibility Getter ─────────────────────────────────────────────

const schedulerProviders = new CompatibilityProviderRegistry<SchedulerService>(
  'Scheduler service',
);

/**
 * Get the only unambiguous SchedulerService compatibility provider.
 * Managed app code should prefer its app-bound `zero.scheduler` service.
 *
 * @example
 * ```ts
 * const scheduler = getScheduler()!;
 * scheduler.register({
 *   name: 'cleanup-expired-notifications',
 *   pattern: '0 0 * * * *',
 *   run: () => getNotificationService()!.deleteExpired(),
 * });
 * ```
 */
export function getScheduler(): SchedulerService | null {
  return schedulerProviders.get();
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Generic scheduler Elysia plugin.
 *
 * Uses auth middleware (resolve-based) — requireAdmin is typed,
 * available directly from context. No casts needed.
 *
 * Mount early in the plugin chain (after auth middleware).
 */
export interface SchedulerPluginRuntimeConfig {
  /** App-local runtime used by managed createApp() composition. */
  runtime?: ZeroAppRuntime;
  /** Explicit auth dependency; defaults to the legacy compatibility getter. */
  getTokenService?: () => TokenService | null;
  /** Composition callback for app factories and advanced integrations. */
  onServiceCreated?: (service: SchedulerService) => void;
  /** Optional prebuilt service for tests or custom composition. */
  service?: SchedulerService;
}

export function createSchedulerPlugin(
  config?: SchedulerPluginConfig & SchedulerPluginRuntimeConfig,
) {
  const prefix = config?.prefix ?? '/scheduler';
  const scheduler = config?.service ?? new SchedulerService();
  const getSchedulerTokenService = config?.getTokenService
    ?? (config?.runtime
      ? () => config.runtime!.get(ZERO_AUTH_TOKEN_SERVICE)
      : getTokenService);
  const owner = {};
  let registration: ReturnType<typeof schedulerProviders.register> | null = null;
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      scheduler.stopAll();
    } finally {
      config?.runtime?.clear(ZERO_SCHEDULER_SERVICE, scheduler);
      registration?.unregister();
      registration = null;
    }
  };
  let removeRuntimeCleanup: (() => void) | undefined;
  try {
    config?.runtime?.set(ZERO_SCHEDULER_SERVICE, scheduler);
    removeRuntimeCleanup = config?.runtime?.addCleanup(cleanup);
    config?.onServiceCreated?.(scheduler);
  } catch (error) {
    removeRuntimeCleanup?.();
    cleanup();
    throw error;
  }

  return new Elysia({ name: 'scheduler', prefix })

    .use(createAuthMiddleware(getSchedulerTokenService))

    .onStart(() => {
      if (cleanedUp) {
        throw new SchedulerError('SCHEDULER_STOPPED', '[scheduler] Cannot start after its app runtime has stopped.');
      }
      registration = schedulerProviders.register(owner, () => scheduler);
      emitPlatformCode(OBS_CODES.SCHEDULER_STARTED);
    })

    .onStop(() => {
      cleanup();
      emitPlatformCode(OBS_CODES.SCHEDULER_STOPPED);
    })

    .derive({ as: 'global' }, () => ({
      scheduler,
    }))

    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: getPublicAuthErrorMessage(error), code: error.code };
      }
      if (error instanceof SchedulerError) {
        set.status = error.code === 'SCHEDULER_JOB_BUSY' ? 409 : 400;
        return { error: error.message, code: error.code };
      }
    })

    // ─── GET / — List all jobs (admin) ────────────────
    .get('/', ({ requireAdmin }) => {
      requireAdmin();
      return { jobs: scheduler.listJobs() };
    })

    // ─── GET /:name — Single job status (admin) ──────
    .get(
      '/:name',
      ({ requireAdmin, params }) => {
        requireAdmin();
        const status = scheduler.getStatus(params.name);
        if (!status) throw new AuthError('Job not found', 'NOT_FOUND', 404);
        return { job: status };
      },
      { params: t.Object({ name: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:name/pause — Pause a job (admin) ─────
    .post(
      '/:name/pause',
      ({ requireAdmin, params }) => {
        requireAdmin();
        const ok = scheduler.pause(params.name);
        if (!ok) throw new AuthError('Job not found', 'NOT_FOUND', 404);
        return { ok: true };
      },
      { params: t.Object({ name: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:name/resume — Resume a job (admin) ───
    .post(
      '/:name/resume',
      ({ requireAdmin, params }) => {
        requireAdmin();
        const ok = scheduler.resume(params.name);
        if (!ok) throw new AuthError('Job not found', 'NOT_FOUND', 404);
        return { ok: true };
      },
      { params: t.Object({ name: t.String({ minLength: 1 }) }) }
    )

    // ─── POST /:name/trigger — Trigger now (admin) ───
    .post(
      '/:name/trigger',
      ({ requireAdmin, params }) => {
        requireAdmin();
        const ok = scheduler.trigger(params.name);
        if (!ok) {
          if (!scheduler.has(params.name)) throw new AuthError('Job not found', 'NOT_FOUND', 404);
          throw new SchedulerError('SCHEDULER_JOB_BUSY', 'Job is already running.');
        }
        return { ok: true };
      },
      { params: t.Object({ name: t.String({ minLength: 1 }) }) }
    );
}

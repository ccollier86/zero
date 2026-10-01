import { Elysia, t } from 'elysia';
import { SchedulerService } from './scheduler-service';
import { AuthError } from '../auth/types';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { getTokenService } from '../auth/auth.plugin';
import type { SchedulerPluginConfig } from './types';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── Module-Level Singleton ──────────────────────────────────────────────────

let _scheduler: SchedulerService | null = null;

/**
 * Get the SchedulerService instance. Returns null if the plugin hasn't started.
 * Use this from any plugin to register scheduled jobs.
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
  return _scheduler;
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
export function createSchedulerPlugin(config?: SchedulerPluginConfig) {
  const prefix = config?.prefix ?? '/scheduler';
  let ownedScheduler: SchedulerService | null = null;

  return new Elysia({ name: 'scheduler', prefix })

    .use(createAuthMiddleware(getTokenService))

    .onStart(() => {
      ownedScheduler = new SchedulerService();
      _scheduler = ownedScheduler;
      emitPlatformCode(OBS_CODES.SCHEDULER_STARTED);
    })

    .onStop(() => {
      if (!ownedScheduler) return;
      ownedScheduler.stopAll();
      if (_scheduler === ownedScheduler) _scheduler = null;
      ownedScheduler = null;
      emitPlatformCode(OBS_CODES.SCHEDULER_STOPPED);
    })

    .derive({ as: 'global' }, () => ({
      scheduler: _scheduler,
    }))

    .onError(({ error, set }) => {
      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
    })

    // ─── GET / — List all jobs (admin) ────────────────
    .get('/', ({ requireAdmin }) => {
      requireAdmin();
      return { jobs: _scheduler!.listJobs() };
    })

    // ─── GET /:name — Single job status (admin) ──────
    .get(
      '/:name',
      ({ requireAdmin, params }) => {
        requireAdmin();
        const status = _scheduler!.getStatus(params.name);
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
        const ok = _scheduler!.pause(params.name);
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
        const ok = _scheduler!.resume(params.name);
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
        const ok = _scheduler!.trigger(params.name);
        if (!ok) throw new AuthError('Job not found', 'NOT_FOUND', 404);
        return { ok: true };
      },
      { params: t.Object({ name: t.String({ minLength: 1 }) }) }
    );
}

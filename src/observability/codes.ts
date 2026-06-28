/**
 * codes.ts
 *
 * Central registry for Zero observability event codes and formatted prefixes.
 * Platform modules should import these constants instead of inventing ad-hoc
 * strings, keeping logs, warnings, and errors stable across releases.
 */

import type { PlatformCodeDefinition, PlatformEventLevel } from './types';

/** Define a stable platform event code. */
function code(
  category: string,
  name: string,
  level: PlatformEventLevel,
  message: string
): PlatformCodeDefinition {
  return {
    category,
    code: `${category}.${name}`,
    prefix: `ZERO_${category}_${name}`.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase(),
    level,
    message,
  };
}

/** Stable platform observability codes. */
export const OBS_CODES = {
  APP_CLIENT_BUNDLE_READY: code('app', 'client_bundle.ready', 'info', 'Client bundle is ready.'),
  APP_CLIENT_BUNDLE_FAILED: code('app', 'client_bundle.failed', 'warn', 'Client bundle build failed; SSR-only mode is active.'),
  APP_LISTENING: code('app', 'listening', 'info', 'Application server is listening.'),
  APP_SHUTDOWN_SIGNAL: code('app', 'shutdown.signal', 'info', 'Shutdown signal received.'),
  APP_REQUEST_FAILED: code('app', 'request.failed', 'error', 'Request failed.'),
  APP_REQUEST_SLOW: code('app', 'request.slow', 'warn', 'Request exceeded the configured slow threshold.'),
  APP_LIFECYCLE_FAILED: code('app', 'lifecycle.failed', 'error', 'Elysia lifecycle handler failed.'),
  APP_LIFECYCLE_SLOW: code('app', 'lifecycle.slow', 'warn', 'Elysia lifecycle handler exceeded the configured slow threshold.'),

  OBSERVABILITY_FRONTEND_INGESTED: code('observability', 'frontend.ingested', 'debug', 'Frontend observability event ingested.'),
  OBSERVABILITY_FRONTEND_REJECTED: code('observability', 'frontend.rejected', 'warn', 'Frontend observability event rejected.'),
  OBSERVABILITY_ACCESS_DENIED: code('observability', 'access.denied', 'warn', 'Observability endpoint access denied.'),

  SYNC_STARTED: code('sync', 'started', 'info', 'Sync engine started.'),
  SYNC_STOPPED: code('sync', 'stopped', 'info', 'Sync engine stopped.'),
  SYNC_CHANGE_LISTENER_FAILED: code('sync', 'change_listener.failed', 'error', 'ReactiveDB change listener failed.'),
  SYNC_MODE_AUTO_LAZY: code('sync', 'mode.auto_lazy', 'warn', 'Table auto-resolved to lazy sync.'),
  SYNC_MODE_FULL_OVER_LIMIT: code('sync', 'mode.full_over_limit', 'warn', 'Explicit full-sync table exceeds the auto-lazy row limit.'),
  SYNC_MODE_WARN_OVER_LIMIT: code('sync', 'mode.warn_over_limit', 'warn', 'Auto table exceeded the row limit but warning mode kept full sync.'),
  SYNC_POLICY_CALLBACK_FAILED: code('sync', 'policy.callback_failed', 'warn', 'Sync policy callback failed; request was denied.'),

  AUTH_STARTED: code('auth', 'started', 'info', 'Auth plugin started.'),
  AUTH_STOPPED: code('auth', 'stopped', 'info', 'Auth plugin stopped.'),

  STORAGE_STARTED: code('storage', 'started', 'info', 'Storage plugin started.'),
  STORAGE_STOPPED: code('storage', 'stopped', 'info', 'Storage plugin stopped.'),

  NOTIFICATIONS_STARTED: code('notifications', 'started', 'info', 'Notifications plugin started.'),
  NOTIFICATIONS_STOPPED: code('notifications', 'stopped', 'info', 'Notifications plugin stopped.'),
  NOTIFICATIONS_CLEANUP: code('notifications', 'cleanup.expired', 'info', 'Expired notifications were cleaned up.'),

  ROOMS_STARTED: code('rooms', 'started', 'info', 'Rooms plugin started.'),
  ROOMS_STOPPED: code('rooms', 'stopped', 'info', 'Rooms plugin stopped.'),

  SCHEDULER_STARTED: code('scheduler', 'started', 'info', 'Scheduler started.'),
  SCHEDULER_STOPPED: code('scheduler', 'stopped', 'info', 'Scheduler stopped.'),
  SCHEDULER_ALL_STOPPED: code('scheduler', 'all_stopped', 'info', 'All scheduler jobs stopped.'),
  SCHEDULER_JOB_REGISTERED: code('scheduler', 'job.registered', 'info', 'Scheduler job registered.'),
  SCHEDULER_JOB_UNREGISTERED: code('scheduler', 'job.unregistered', 'info', 'Scheduler job unregistered.'),
  SCHEDULER_JOB_FAILED: code('scheduler', 'job.failed', 'error', 'Scheduler job failed.'),
  SCHEDULER_JOB_UNHANDLED_FAILED: code('scheduler', 'job.unhandled_failed', 'error', 'Scheduler job threw an unhandled error.'),

  WORKFLOWS_INITIALIZED: code('workflows', 'initialized', 'info', 'Workflow plugin initialized.'),
  WORKFLOWS_RECOVERED: code('workflows', 'recovered', 'info', 'In-flight workflow steps recovered.'),

  ROUTER_LAYOUT_CONFIG_FAILED: code('router', 'layout_config.failed', 'warn', 'Router layout config import failed.'),
  RENDERER_PAGE_EXPORT_MISSING: code('renderer', 'page_export.missing', 'error', 'Page module has no default export.'),
  RENDERER_SSR_ERROR: code('renderer', 'ssr.error', 'error', 'Streaming SSR reported an error.'),
  RENDERER_FATAL_ERROR: code('renderer', 'fatal.error', 'error', 'Route rendering failed.'),

  FRONTEND_RENDER_ERROR: code('frontend', 'render.error', 'error', 'Frontend render error caught by ErrorBoundary.'),
  FRONTEND_HYDRATE_FAILED: code('frontend', 'hydrate.failed', 'error', 'Hydration failed.'),
  FRONTEND_HYDRATE_MISSING_ROOT: code('frontend', 'hydrate.missing_root', 'error', 'Hydration root element is missing.'),
  FRONTEND_HYDRATE_MISSING_ROUTE_DATA: code('frontend', 'hydrate.missing_route_data', 'error', 'Hydration route data is missing.'),
  FRONTEND_HYDRATE_MISSING_MANIFEST_ENTRY: code('frontend', 'hydrate.missing_manifest_entry', 'error', 'Hydration manifest entry is missing.'),
  FRONTEND_HYDRATE_MISSING_PAGE_EXPORT: code('frontend', 'hydrate.missing_page_export', 'error', 'Hydration page module has no default export.'),
  FRONTEND_NOTIFICATION_RECEIPT_FAILED: code('frontend', 'notification.receipt_failed', 'error', 'Notification receipt action failed.'),

  MIGRATOR_LOG: code('migrations', 'log', 'info', 'Migration runner emitted a log message.'),
  MIGRATOR_FAILED: code('migrations', 'failed', 'error', 'Migration failed.'),
} as const;

export type ObservabilityCodeName = keyof typeof OBS_CODES;

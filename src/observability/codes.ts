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
  AUTH_FIRST_ADMIN_BOOTSTRAPPED: code('auth', 'first_admin.bootstrapped', 'info', 'First admin user bootstrapped.'),
  AUTH_REGISTRATION_DISABLED: code('auth', 'registration.disabled', 'warn', 'Registration request rejected by auth policy.'),
  AUTH_ADMIN_USER_CREATED: code('auth', 'admin.user_created', 'info', 'Admin created a user.'),
  AUTH_ADMIN_USER_UPDATED: code('auth', 'admin.user_updated', 'info', 'Admin updated a user.'),
  AUTH_ADMIN_USER_DELETED: code('auth', 'admin.user_deleted', 'warn', 'Admin deleted a user.'),
  AUTH_ADMIN_PASSWORD_RESET: code('auth', 'admin.password_reset', 'warn', 'Admin reset a user password.'),
  AUTH_ADMIN_SETUP_EMAIL_SENT: code('auth', 'admin.setup_email_sent', 'info', 'Admin sent an account setup email.'),
  AUTH_ADMIN_PASSWORD_RESET_EMAIL_SENT: code('auth', 'admin.password_reset_email_sent', 'warn', 'Admin sent a password reset email.'),
  AUTH_USER_PROPERTY_REJECTED: code('auth', 'user_property.rejected', 'warn', 'User property mutation rejected.'),
  AUTH_ACTION_TOKEN_CREATED: code('auth', 'action_token.created', 'info', 'Auth action token created.'),
  AUTH_ACTION_TOKEN_CONSUMED: code('auth', 'action_token.consumed', 'info', 'Auth action token consumed.'),
  AUTH_ACTION_TOKEN_REJECTED: code('auth', 'action_token.rejected', 'warn', 'Auth action token rejected.'),
  AUTH_PASSWORD_RESET_REQUESTED: code('auth', 'password_reset.requested', 'info', 'Password reset requested.'),
  AUTH_PASSWORD_RESET_COMPLETED: code('auth', 'password_reset.completed', 'info', 'Password reset completed.'),
  AUTH_ACCOUNT_SUSPENDED: code('auth', 'account.suspended', 'warn', 'Auth account suspended.'),
  AUTH_ACCOUNT_REACTIVATED: code('auth', 'account.reactivated', 'info', 'Auth account reactivated.'),

  EMAIL_CONFIGURED: code('email', 'configured', 'info', 'Email runtime configured.'),
  EMAIL_SEND_REQUESTED: code('email', 'send.requested', 'info', 'Email send requested.'),
  EMAIL_SENT: code('email', 'sent', 'info', 'Email sent.'),
  EMAIL_SEND_FAILED: code('email', 'send.failed', 'error', 'Email send failed.'),
  EMAIL_CONSOLE_PREVIEW: code('email', 'console.preview', 'info', 'Console email provider captured a preview.'),

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

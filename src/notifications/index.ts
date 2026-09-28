// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  NotificationType,
  NotificationPriority,
  NotificationTarget,
  NotificationRecord,
  NotificationReceiptRecord,
  CreateNotificationParams,
} from './types';
export { NOTIFICATION_TABLES } from './types';

// ─── Service ─────────────────────────────────────────────────────────────────
export { NotificationService } from './notification-service';

// ─── Plugin ──────────────────────────────────────────────────────────────────
export { createNotificationPlugin, getNotificationService } from './notification.plugin';
export type { NotificationPluginConfig } from './notification.plugin';
export {
  NOTIFICATION_MANAGE_PERMISSION,
  canManageNotificationScope,
  notificationAudienceRoles,
} from './notification-access';

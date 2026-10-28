/** Notification provider, presentation and contracts. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Notifications: Provider ─────────────────────────────────────────────
export { NotificationProvider, useNotificationContext } from '../../client/notification-provider';
export type { NotificationProviderProps } from '../../client/notification-provider';
export { NotificationFeedbackProvider, useNotificationSounds, useNotificationConversation, useNotificationInterruption } from '../../client/notification-feedback-provider';
export type { NotificationFeedbackProviderProps } from '../../client/notification-feedback-provider';
export type { NotificationSoundOptions, NotificationSoundStatus } from '../../client/notification-audio';
export { isConversationSurfaceActive } from '../../client/notification-feedback';

// ─── Notifications: UI Components ────────────────────────────────────────
export { NotificationBadge } from '../../../components/ui/notification-badge';
export type { NotificationBadgeProps } from '../../../components/ui/notification-badge';
export { NotificationItem, formatRelativeTime } from '../../../components/ui/notification-item';
export type { NotificationItemProps, NotificationItemType } from '../../../components/ui/notification-item';
export { NotificationList } from '../../../components/ui/notification-list';
export type { NotificationListProps, NotificationListItem } from '../../../components/ui/notification-list';
export { NotificationDropdown } from '../../../components/ui/notification-dropdown';
export type { NotificationDropdownProps } from '../../../components/ui/notification-dropdown';
export { NotificationCenter } from '../../../components/ui/notification-center';
export type { NotificationCenterProps } from '../../../components/ui/notification-center';

// ─── Notifications: Config (types only) ─────────────────────────────────
export type {
  NotificationType,
  NotificationPriority,
  NotificationTarget,
} from '../../../notifications/types';

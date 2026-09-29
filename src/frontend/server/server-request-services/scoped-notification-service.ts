import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import {
  canManageNotificationScope,
  notificationAudienceRoles,
} from '../../../notifications/notification-access';
import type { NotificationService } from '../../../notifications/notification-service';
import {
  forbidden,
  notFound,
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

type ScopedNotificationMethods = Pick<
  NotificationService,
  | 'create'
  | 'broadcast'
  | 'notify'
  | 'notifyUsers'
  | 'notifyRole'
  | 'getById'
  | 'getByIdForUser'
  | 'get'
  | 'getForUser'
  | 'list'
  | 'getUnreadCount'
  | 'getReceipts'
  | 'markSeen'
  | 'markRead'
  | 'dismiss'
  | 'markAllRead'
  | 'markAllSeen'
  | 'deleteNotification'
  | 'delete'
>;

type DeniedNotificationMember = 'deleteExpired';

const NOTIFICATION_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  NotificationService,
  keyof ScopedNotificationMethods,
  DeniedNotificationMember
> = true;
void NOTIFICATION_SERVICE_INVENTORY;

const DENIED_NOTIFICATION_MEMBERS: ReadonlySet<DeniedNotificationMember> = new Set([
  'deleteExpired',
]);

export function createScopedNotificationService(
  service: NotificationService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): NotificationService {
  const auth = access.context;
  const roles = notificationAudienceRoles(access, scope);
  const canManage = canManageNotificationScope(access, scope, privilegedSystem);
  const requireActor = (userId: string): void => {
    if (privilegedSystem) return;
    if (!auth || userId !== auth.userId) throw forbidden('Notification user mismatch');
  };
  const actorNotification = (id: string) => {
    if (!auth) return service.getById(id, scope);
    return service.getByIdForUser(id, auth.userId, roles, scope);
  };
  const listForActor = () => {
    if (!auth) return [];
    return service.getForUser(auth.userId, roles, scope);
  };
  const requireVisible = (id: string) => {
    const notification = actorNotification(id);
    if (!notification) throw notFound('Notification not found');
    return notification;
  };
  const requireManager = (id: string) => {
    if (!canManage) throw forbidden('Notification management is not permitted');
    const notification = service.getById(id, scope);
    if (!notification) throw notFound('Notification not found');
    return notification;
  };
  const requireCreateAuthority = (): void => {
    if (!canManage) throw forbidden('Notification management is not permitted');
  };
  const methods: ScopedNotificationMethods = {
    create(params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.create(params, senderId ?? auth?.userId, scope);
    },
    broadcast(params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.broadcast(params, senderId ?? auth?.userId, scope);
    },
    notify(userId, params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.notify(userId, params, senderId ?? auth?.userId, scope);
    },
    notifyUsers(userIds, params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.notifyUsers(userIds, params, senderId ?? auth?.userId, scope);
    },
    notifyRole(role, params, senderId) {
      requireCreateAuthority();
      if (senderId) requireActor(senderId);
      assertCurrentAuthoritySync();
      return service.notifyRole(role, params, senderId ?? auth?.userId, scope);
    },
    getById: actorNotification,
    getByIdForUser(id, userId) {
      requireActor(userId);
      return actorNotification(id);
    },
    get: actorNotification,
    getForUser(userId) {
      requireActor(userId);
      return listForActor();
    },
    list(userId) {
      requireActor(userId);
      return listForActor();
    },
    getUnreadCount(userId) {
      requireActor(userId);
      return listForActor().filter((notification) => !notification.receipt?.read_at
        && !notification.receipt?.dismissed_at).length;
    },
    getReceipts(id) {
      requireManager(id);
      return service.getReceipts(id, scope);
    },
    markSeen(id, userId) {
      requireActor(userId);
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.markSeen(id, userId, scope);
    },
    markRead(id, userId) {
      requireActor(userId);
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.markRead(id, userId, scope);
    },
    dismiss(id, userId) {
      requireActor(userId);
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.dismiss(id, userId, scope);
    },
    markAllRead(userId) {
      requireActor(userId);
      assertCurrentAuthoritySync();
      return service.markAllRead(userId, roles, scope);
    },
    markAllSeen(userId) {
      requireActor(userId);
      assertCurrentAuthoritySync();
      return service.markAllSeen(userId, roles, scope);
    },
    deleteNotification(id) {
      requireManager(id);
      assertCurrentAuthoritySync();
      return service.deleteNotification(id, scope);
    },
    delete(id) {
      requireManager(id);
      assertCurrentAuthoritySync();
      return service.delete(id, scope);
    },
  };
  return restrictedServiceProxy(
    service,
    methods,
    DENIED_NOTIFICATION_MEMBERS,
    'Notification',
  );
}

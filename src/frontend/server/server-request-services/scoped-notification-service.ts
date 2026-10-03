/**
 * Scope-safe NotificationService projection for requests and workflow steps.
 *
 * This module owns actor/manager filtering and per-operation authority fences;
 * notification persistence and transport remain in NotificationService.
 */

import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import {
  canManageNotificationScope,
  notificationAudienceRoles,
} from '../../../notifications/notification-access';
import type { NotificationService } from '../../../notifications/notification-service';
import type {
  CreateNotificationParams,
  NotificationReceiptRecord,
  NotificationRecord,
} from '../../../notifications/types';
import {
  forbidden,
  notFound,
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

export type ScopedNotificationRecord = NotificationRecord & {
  readonly receipt: NotificationReceiptRecord | null;
};

/** Notification operations sealed to the current actor and data scope. */
export interface ScopedNotificationService {
  create(params: CreateNotificationParams): NotificationRecord;
  broadcast(params: CreateNotificationParams): NotificationRecord;
  notify(userId: string, params: CreateNotificationParams): NotificationRecord;
  notifyUsers(userIds: string[], params: CreateNotificationParams): NotificationRecord;
  notifyRole(role: string, params: CreateNotificationParams): NotificationRecord;
  getById(notificationId: string): NotificationRecord | null;
  get(notificationId: string): NotificationRecord | null;
  getForUser(): ScopedNotificationRecord[];
  list(): ScopedNotificationRecord[];
  getUnreadCount(): number;
  getReceipts(notificationId: string): NotificationReceiptRecord[];
  markSeen(notificationId: string): void;
  markRead(notificationId: string): void;
  dismiss(notificationId: string): void;
  markAllRead(): void;
  markAllSeen(): void;
  deleteNotification(notificationId: string): boolean;
  delete(notificationId: string): boolean;
}

type DeniedNotificationMember = 'deleteExpired' | 'getByIdForUser';

const NOTIFICATION_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  NotificationService,
  keyof ScopedNotificationService,
  DeniedNotificationMember
> = true;
void NOTIFICATION_SERVICE_INVENTORY;

const DENIED_NOTIFICATION_MEMBERS: ReadonlySet<DeniedNotificationMember> = new Set([
  'deleteExpired',
  'getByIdForUser',
]);

export function createScopedNotificationService(
  service: NotificationService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): ScopedNotificationService {
  const auth = access.context;
  const roles = notificationAudienceRoles(access, scope);
  const canManage = canManageNotificationScope(access, scope, privilegedSystem);
  const actorNotification = (id: string) => {
    assertCurrentAuthoritySync();
    if (!auth) return service.getById(id, scope);
    return service.getByIdForUser(id, auth.userId, roles, scope);
  };
  const listForActor = () => {
    assertCurrentAuthoritySync();
    if (!auth) return [];
    return service.getForUser(auth.userId, roles, scope);
  };
  const requireVisible = (id: string) => {
    const notification = actorNotification(id);
    if (!notification) throw notFound('Notification not found');
    return notification;
  };
  const requireManager = (id: string) => {
    assertCurrentAuthoritySync();
    if (!canManage) throw forbidden('Notification management is not permitted');
    const notification = service.getById(id, scope);
    if (!notification) throw notFound('Notification not found');
    return notification;
  };
  const requireCreateAuthority = (): void => {
    if (!canManage) throw forbidden('Notification management is not permitted');
  };
  const methods: ScopedNotificationService = {
    create(params) {
      requireCreateAuthority();
      assertCurrentAuthoritySync();
      return service.create(params, auth?.userId, scope, assertCurrentAuthoritySync);
    },
    broadcast(params) {
      requireCreateAuthority();
      assertCurrentAuthoritySync();
      return service.broadcast(params, auth?.userId, scope, assertCurrentAuthoritySync);
    },
    notify(userId, params) {
      requireCreateAuthority();
      assertCurrentAuthoritySync();
      return service.notify(userId, params, auth?.userId, scope, assertCurrentAuthoritySync);
    },
    notifyUsers(userIds, params) {
      requireCreateAuthority();
      assertCurrentAuthoritySync();
      return service.notifyUsers(userIds, params, auth?.userId, scope, assertCurrentAuthoritySync);
    },
    notifyRole(role, params) {
      requireCreateAuthority();
      assertCurrentAuthoritySync();
      return service.notifyRole(role, params, auth?.userId, scope, assertCurrentAuthoritySync);
    },
    getById: actorNotification,
    get: actorNotification,
    getForUser() {
      return listForActor();
    },
    list() {
      return listForActor();
    },
    getUnreadCount() {
      return listForActor().filter((notification) => !notification.receipt?.read_at
        && !notification.receipt?.dismissed_at).length;
    },
    getReceipts(id) {
      requireManager(id);
      return service.getReceipts(id, scope);
    },
    markSeen(id) {
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.markSeen(
        id,
        requireActorId(auth),
        scope,
        assertCurrentAuthoritySync,
      );
    },
    markRead(id) {
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.markRead(
        id,
        requireActorId(auth),
        scope,
        assertCurrentAuthoritySync,
      );
    },
    dismiss(id) {
      requireVisible(id);
      assertCurrentAuthoritySync();
      return service.dismiss(
        id,
        requireActorId(auth),
        scope,
        assertCurrentAuthoritySync,
      );
    },
    markAllRead() {
      assertCurrentAuthoritySync();
      return service.markAllRead(
        requireActorId(auth),
        roles,
        scope,
        assertCurrentAuthoritySync,
      );
    },
    markAllSeen() {
      assertCurrentAuthoritySync();
      return service.markAllSeen(
        requireActorId(auth),
        roles,
        scope,
        assertCurrentAuthoritySync,
      );
    },
    deleteNotification(id) {
      requireManager(id);
      assertCurrentAuthoritySync();
      return service.deleteNotification(id, scope, assertCurrentAuthoritySync);
    },
    delete(id) {
      requireManager(id);
      assertCurrentAuthoritySync();
      return service.delete(id, scope, assertCurrentAuthoritySync);
    },
  };
  return restrictedServiceProxy(
    service,
    methods,
    DENIED_NOTIFICATION_MEMBERS,
    'Notification',
  );
}

function requireActorId(
  auth: RequestAuthorizationAccess['context'],
): string {
  if (!auth) throw forbidden('Notification actor is required');
  return auth.userId;
}

import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import { canManageRoomScope } from '../../../rooms/room-access';
import type { RoomService } from '../../../rooms/room-service';
import {
  forbidden,
  notFound,
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

type ScopedRoomMethods = Pick<
  RoomService,
  | 'create'
  | 'join'
  | 'leave'
  | 'getRoom'
  | 'getMembers'
  | 'getMember'
  | 'getRoomsForUser'
  | 'isMember'
  | 'delete'
>;

const ROOM_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  RoomService,
  keyof ScopedRoomMethods,
  never
> = true;
void ROOM_SERVICE_INVENTORY;

export function createScopedRoomService(
  service: RoomService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): RoomService {
  const auth = access.context;
  const canManage = canManageRoomScope(access, scope, privilegedSystem);
  const requireActor = (userId: string): void => {
    if (privilegedSystem) return;
    if (!auth || userId !== auth.userId) throw forbidden('Room user mismatch');
  };
  const requireReadable = (roomId: string) => {
    const room = service.getRoom(roomId, scope);
    if (!room
      || (!privilegedSystem && (!auth || !service.isMember(roomId, auth.userId, scope)))) {
      throw notFound('Room not found');
    }
    return room;
  };
  const methods: ScopedRoomMethods = {
    create(createdBy, params) {
      requireActor(createdBy);
      assertCurrentAuthoritySync();
      return service.create(createdBy, params, scope);
    },
    join(roomId, userId, role) {
      requireActor(userId);
      if (privilegedSystem) {
        assertCurrentAuthoritySync();
        return service.join(roomId, userId, role, scope);
      }
      requireReadable(roomId);
      return service.getMember(roomId, userId, scope)!;
    },
    leave(roomId, userId) {
      requireActor(userId);
      assertCurrentAuthoritySync();
      return service.leave(roomId, userId, scope);
    },
    getRoom(roomId) {
      try {
        return requireReadable(roomId);
      } catch {
        return null;
      }
    },
    getMembers(roomId) {
      requireReadable(roomId);
      return service.getMembers(roomId, scope);
    },
    getMember(roomId, userId) {
      requireReadable(roomId);
      return service.getMember(roomId, userId, scope);
    },
    getRoomsForUser(userId) {
      requireActor(userId);
      return service.getRoomsForUser(userId, scope);
    },
    isMember(roomId, userId) {
      requireReadable(roomId);
      return service.isMember(roomId, userId, scope);
    },
    delete(roomId) {
      const room = service.getRoom(roomId, scope);
      if (!room
        || (!canManage && (!auth || room.created_by !== auth.userId))) {
        throw notFound('Room not found');
      }
      assertCurrentAuthoritySync();
      return service.delete(roomId, scope);
    },
  };
  return restrictedServiceProxy(service, methods, new Set(), 'Room');
}

/**
 * Scope-safe RoomService projection for requests and workflow steps.
 *
 * This module owns membership visibility and per-operation authority fences;
 * room persistence remains in RoomService.
 */

import type { RequestAuthorizationAccess } from '../../../auth/authorization-access';
import type { ServiceDataScope } from '../../../auth/service-data-scope';
import { AuthError } from '../../../auth/types';
import { canManageRoomScope } from '../../../rooms/room-access';
import type { RoomService } from '../../../rooms/room-service';
import type {
  CreateRoomParams,
  RoomMemberRecord,
  RoomRecord,
} from '../../../rooms/types';
import {
  forbidden,
  notFound,
  restrictedServiceProxy,
  type CompleteServiceMemberInventory,
} from './restricted-service-proxy';

/** Room operations sealed to the current actor and data scope. */
export interface ScopedRoomService {
  create(params: CreateRoomParams): RoomRecord;
  leave(roomId: string): boolean;
  getRoom(roomId: string): RoomRecord | null;
  getMembers(roomId: string): RoomMemberRecord[];
  getMember(roomId: string, userId: string): RoomMemberRecord | null;
  getRoomsForUser(): RoomRecord[];
  isMember(roomId: string, userId: string): boolean;
  delete(roomId: string): boolean;
}

type DeniedRoomMember = 'join';

const ROOM_SERVICE_INVENTORY: CompleteServiceMemberInventory<
  RoomService,
  keyof ScopedRoomService,
  DeniedRoomMember
> = true;
void ROOM_SERVICE_INVENTORY;

export function createScopedRoomService(
  service: RoomService,
  scope: ServiceDataScope,
  access: RequestAuthorizationAccess,
  assertCurrentAuthoritySync: () => void,
  privilegedSystem: boolean,
): ScopedRoomService {
  const auth = access.context;
  const canManage = canManageRoomScope(access, scope, privilegedSystem);
  const requireReadable = (roomId: string) => {
    const room = service.getRoom(roomId, scope);
    if (!room
      || (!privilegedSystem && (!auth || !service.isMember(roomId, auth.userId, scope)))) {
      throw notFound('Room not found');
    }
    return room;
  };
  const methods: ScopedRoomService = {
    create(params) {
      assertCurrentAuthoritySync();
      return service.create(
        requireActorId(auth),
        params,
        scope,
        assertCurrentAuthoritySync,
      );
    },
    leave(roomId) {
      assertCurrentAuthoritySync();
      return service.leave(
        roomId,
        requireActorId(auth),
        scope,
        assertCurrentAuthoritySync,
      );
    },
    getRoom(roomId) {
      // Keep the authority fence outside the not-found normalization below;
      // stale execution authority must never be converted into a null result.
      assertCurrentAuthoritySync();
      try {
        return requireReadable(roomId);
      } catch (error) {
        if (error instanceof AuthError && error.code === 'NOT_FOUND') return null;
        throw error;
      }
    },
    getMembers(roomId) {
      assertCurrentAuthoritySync();
      requireReadable(roomId);
      return service.getMembers(roomId, scope);
    },
    getMember(roomId, userId) {
      assertCurrentAuthoritySync();
      requireReadable(roomId);
      return service.getMember(roomId, userId, scope);
    },
    getRoomsForUser() {
      assertCurrentAuthoritySync();
      return service.getRoomsForUser(requireActorId(auth), scope);
    },
    isMember(roomId, userId) {
      assertCurrentAuthoritySync();
      requireReadable(roomId);
      return service.isMember(roomId, userId, scope);
    },
    delete(roomId) {
      assertCurrentAuthoritySync();
      const room = service.getRoom(roomId, scope);
      if (!room
        || (!canManage && (!auth || room.created_by !== auth.userId))) {
        throw notFound('Room not found');
      }
      assertCurrentAuthoritySync();
      return service.delete(roomId, scope, assertCurrentAuthoritySync);
    },
  };
  return restrictedServiceProxy(service, methods, new Set<DeniedRoomMember>(['join']), 'Room');
}

function requireActorId(auth: RequestAuthorizationAccess['context']): string {
  if (!auth) throw forbidden('Room actor is required');
  return auth.userId;
}

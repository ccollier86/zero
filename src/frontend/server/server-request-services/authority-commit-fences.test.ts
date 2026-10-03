import { describe, expect, test } from 'bun:test';

import { NotificationService } from '../../../notifications/notification-service';
import { defineNotificationTables } from '../../../notifications/notification.plugin';
import { RoomService } from '../../../rooms/room-service';
import { defineRoomTables } from '../../../rooms/room.plugin';
import { createReactiveDB } from '../../../sync/reactive-db';

describe('authority commit fences', () => {
  test('rolls back notification creation, receipts, and deletion inside the writer transaction', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineNotificationTables(db);
      const service = new NotificationService(db);
      const revoked = new Error('authority revoked');
      const rejectCommit = () => {
        expect(db.getRawDatabase().inTransaction).toBeTrue();
        throw revoked;
      };

      expect(() => service.create(
        { title: 'blocked' },
        'owner',
        undefined,
        rejectCommit,
      )).toThrow(revoked);
      expect(service.getForUser('reader', [])).toEqual([]);

      const notification = service.notify('reader', { title: 'visible' }, 'owner');
      expect(() => service.markRead(
        notification.notification_id,
        'reader',
        undefined,
        rejectCommit,
      )).toThrow(revoked);
      expect(service.getForUser('reader', [])[0]?.receipt).toBeNull();

      expect(() => service.deleteNotification(
        notification.notification_id,
        undefined,
        rejectCommit,
      )).toThrow(revoked);
      expect(service.getById(notification.notification_id)).not.toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('rolls back room creation, leave, and deletion inside the writer transaction', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineRoomTables(db);
      const service = new RoomService(db);
      const revoked = new Error('authority revoked');
      const rejectCommit = () => {
        expect(db.getRawDatabase().inTransaction).toBeTrue();
        throw revoked;
      };

      expect(() => service.create(
        'owner',
        { name: 'blocked' },
        undefined,
        rejectCommit,
      )).toThrow(revoked);
      expect(service.getRoomsForUser('owner')).toEqual([]);

      const room = service.create('owner', { name: 'active' });
      service.join(room.room_id, 'member');
      expect(() => service.leave(
        room.room_id,
        'member',
        undefined,
        rejectCommit,
      )).toThrow(revoked);
      expect(service.isMember(room.room_id, 'member')).toBeTrue();

      expect(() => service.delete(room.room_id, undefined, rejectCommit)).toThrow(revoked);
      expect(service.getRoom(room.room_id)).not.toBeNull();
      expect(service.getMembers(room.room_id)).toHaveLength(2);
    } finally {
      db.dispose();
    }
  });
});

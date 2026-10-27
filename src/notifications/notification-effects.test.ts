/** Native in-memory receiver transactions and permanent duplicate receipts. These are not cross-database/worker deployment tests. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineNotificationTables } from './notification.plugin';
import { NotificationService } from './notification-service';
import { migration } from '../migrations/definitions/051_notification_effect_receipts';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { Database } from 'bun:sqlite';

function fixture() {
  const db = createReactiveDB({ mode: 'memory' }); defineNotificationTables(db);
  // The migration consumes the same synchronous SQLite surface used by core migration boot.
  migration.up({ exec: (sql: string) => db.exec(sql), query: (sql: string) => db.prepare(sql) } as unknown as Database);
  return { db, service: new NotificationService(db) };
}
test('notice deletion cannot resurrect an accepted effect; audience order is canonical and changed input conflicts', () => {
  const { db, service } = fixture();
  try {
    const effect = service.notifyUsersOnce('messaging:job-one', ['user-b', 'user-a'], { title: 'New message', actionUrl: '/app/messages' });
    expect(effect).toMatchObject({ duplicate: false, retained: true });
    expect(service.notifyUsersOnce('messaging:job-one', ['user-a', 'user-b'], { actionUrl: '/app/messages', title: 'New message' })).toEqual({ ...effect, duplicate: true });
    expect(() => service.notifyUsersOnce('messaging:job-one', ['user-a'], { title: 'New message', actionUrl: '/app/messages' })).toThrow('different input');
    service.deleteNotification(effect.notificationId!);
    expect(service.notifyUsersOnce('messaging:job-one', ['user-a', 'user-b'], { title: 'New message', actionUrl: '/app/messages' })).toEqual({ notificationId: effect.notificationId, duplicate: true, retained: false });
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()).toEqual({ count: 0 });
    expect(() => db.exec('DELETE FROM _notification_effect_receipts')).toThrow('immutable');
  } finally { db.dispose(); }
});
test('receiver rollback is atomic, empty audiences stay empty, and scope does not share effect receipts', () => {
  const { db, service } = fixture();
  try {
    let fences = 0;
    expect(() => service.notifyUsersOnce('rollback', ['user-a'], { title: 'New message' }, undefined, applicationServiceDataScope(), () => { if (++fences === 3) throw new Error('Synthetic revoked commit.'); })).toThrow('Synthetic revoked commit.');
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM _notification_effect_receipts').get()).toEqual({ count: 0 });
    expect(service.notifyUsersOnce('empty', [], { title: 'New message' })).toEqual({ notificationId: null, duplicate: false, retained: false });
    expect(service.notifyUsersOnce('empty', [], { title: 'New message' }).duplicate).toBe(true);
    const tenant = trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'tenant-one' });
    const a = service.notifyUsersOnce('same', ['user-a'], { title: 'New message' });
    const b = service.notifyUsersOnce('same', ['user-a'], { title: 'New message' }, undefined, tenant);
    expect(a.notificationId).not.toBe(b.notificationId); expect(service.getById(b.notificationId!, tenant)?.tenant_id).toBe('tenant-one');
  } finally { db.dispose(); }
});
test('effect inputs reject getters, metadata, unbounded audiences and external navigation before publication', () => {
  const { db, service } = fixture();
  try {
    let invoked = false;
    expect(() => service.notifyUsersOnce('accessor', ['user-a'], { get title() { invoked = true; return 'bad'; } })).toThrow('invalid'); expect(invoked).toBe(false);
    const users = ['user-a']; Object.defineProperty(users, '0', { enumerable: true, get() { invoked = true; return 'user-a'; } });
    expect(() => service.notifyUsersOnce('audience-accessor', users, { title: 'New' })).toThrow('invalid'); expect(invoked).toBe(false);
    expect(() => service.notifyUsersOnce('metadata', ['user-a'], { title: 'New', metadata: { text: 'not accepted' } } as never)).toThrow('invalid');
    expect(() => service.notifyUsersOnce('url', ['user-a'], { title: 'New', actionUrl: '//hostile.example/path' })).toThrow('invalid');
    expect(() => service.notifyUsersOnce('capacity', Array.from({ length: 101 }, (_, i) => 'user-' + i), { title: 'New' })).toThrow('invalid');
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()).toEqual({ count: 0 });
  } finally { db.dispose(); }
});

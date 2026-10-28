/** Native in-memory receiver transactions and permanent duplicate receipts. These are not cross-database/worker deployment tests. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineNotificationTables } from './notification.plugin';
import { NotificationService } from './notification-service';
import { migration } from '../migrations/definitions/051_notification_effect_receipts';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from '../auth/service-data-scope';
import type { Database } from 'bun:sqlite';
import { notificationChatPresentation } from './presentation';

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

test('a current recipient policy narrows first publication atomically but never changes or repeats an accepted audience', () => {
  const { db, service } = fixture();
  try {
    let admitted = 'user-a', evaluations = 0;
    const filter = (id: string) => { evaluations++; return id === admitted; };
    const first = service.notifyUsersOnce('narrowed', ['user-a', 'user-b'], { title: 'New message' }, undefined, applicationServiceDataScope(), undefined, filter);
    expect(JSON.parse(service.getById(first.notificationId!)!.target_value!)).toEqual(['user-a']); expect(evaluations).toBe(2);
    admitted = 'user-b'; const replay = service.notifyUsersOnce('narrowed', ['user-a', 'user-b'], { title: 'New message' }, undefined, applicationServiceDataScope(), undefined, filter);
    expect(replay).toEqual({ ...first, duplicate: true }); expect(evaluations).toBe(2);
    expect(JSON.parse(service.getById(first.notificationId!)!.target_value!)).toEqual(['user-a']);
    expect(service.notifyUsersOnce('none-eligible', ['user-a'], { title: 'New message' }, undefined, applicationServiceDataScope(), undefined, () => false)).toEqual({ notificationId: null, duplicate: false, retained: false });
    expect(() => service.notifyUsersOnce('async-policy', ['user-a'], { title: 'New message' }, undefined, applicationServiceDataScope(), undefined, (async () => true) as never)).toThrow('synchronous');
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()).toEqual({ count: 1 });
  } finally { db.dispose(); }
});

test('missing or changed immutable receipt controls fail before native publication and are not silently repaired', () => {
  const { db, service } = fixture();
  try {
    service.notifyUsersOnce('qualified-schema', ['user-a'], { title: 'New message' });
    db.exec('DROP TRIGGER notification_effect_receipt_no_delete');
    expect(() => service.notifyUsersOnce('missing-control', ['user-a'], { title: 'New message' })).toThrow('reviewed SYSTEM migration');
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()).toEqual({ count: 1 });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='notification_effect_receipt_no_delete'").get()).toBeNull();
  } finally { db.dispose(); }
});

test('chat cues bind opaque identities, reject content/accessors and preserve old receipts unchanged', () => {
  const { db, service } = fixture();
  try {
    const presentation = { kind: 'chat' as const, conversationId: 'conversation-one', messageId: 'message-one' };
    const first = service.notifyUsersOnce('chat-cue', ['user-a'], { title: 'New message', presentation });
    expect(notificationChatPresentation(service.getById(first.notificationId!)!.metadata)).toEqual(presentation);
    expect(service.notifyUsersOnce('chat-cue', ['user-a'], { title: 'New message', presentation }).duplicate).toBe(true);
    expect(service.notifyUsersOnce('chat-cue', ['user-a'], { title: 'New message', presentation: { messageId: 'message-one', conversationId: 'conversation-one', kind: 'chat' } }).duplicate).toBe(true);
    expect(() => service.notifyUsersOnce('chat-cue', ['user-a'], { title: 'New message', presentation: { ...presentation, messageId: 'message-two' } })).toThrow('different input');
    const legacy = service.notifyUsersOnce('old-cue', ['user-a'], { title: 'New message' });
    expect(service.notifyUsersOnce('old-cue', ['user-a'], { title: 'New message', presentation })).toEqual({ ...legacy, duplicate: true });
    expect(service.getById(legacy.notificationId!)!.metadata).toBeNull();
    service.deleteNotification(legacy.notificationId!);
    expect(service.notifyUsersOnce('old-cue', ['user-a'], { title: 'New message', presentation })).toEqual({ ...legacy, duplicate: true, retained: false });
    let invoked = false;
    expect(() => service.notifyUsersOnce('cue-getter', ['user-a'], { title: 'New', presentation: { ...presentation, get messageId() { invoked = true; return 'message-two'; } } })).toThrow('invalid');
    expect(invoked).toBe(false);
    expect(() => service.notifyUsersOnce('cue-content', ['user-a'], { title: 'New', presentation: { ...presentation, text: 'Never cross the private boundary' } } as never)).toThrow('invalid');
    expect(notificationChatPresentation('{"zero":{"version":9,"kind":"chat","conversationId":"c","messageId":"m"}}')).toBeNull();
    expect(notificationChatPresentation('not-json')).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM notifications').get()).toEqual({ count: 1 });
  } finally { db.dispose(); }
});

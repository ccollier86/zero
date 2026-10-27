/** Permanent native notification effect receipts. One SYSTEM transaction owns the notice and receipt; deletion never grants permission to resend. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import type { ReactiveDB } from '../sync/reactive-db';
import type { ServiceDataScope } from '../auth/service-data-scope';
import { serviceDataScopeKey } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import { invokeSynchronousAuthCallback } from '../auth/auth-synchronous-callback';
import type { CreateNotificationParams, NotificationRecord } from './types';

export type NotificationOnceParams = Omit<CreateNotificationParams, 'metadata'>;
export interface NotificationEffectReceipt { readonly notificationId: string | null; readonly duplicate: boolean; readonly retained: boolean }
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
/** Metadata-free, bounded destination effect. Empty audiences are remembered without broadcasting an empty notice. */
export function publishNotificationOnce(db: ReactiveDB, effectId: string, userIds: readonly string[], params: NotificationOnceParams,
  senderId: string | undefined, scope: ServiceDataScope, check: (() => void) | undefined,
  publish: (users: string[], captured: NotificationOnceParams) => NotificationRecord): NotificationEffectReceipt {
  if (typeof effectId !== 'string' || !identifier.test(effectId) || senderId !== undefined && (typeof senderId !== 'string' || !identifier.test(senderId))) throw invalid();
  const users = captureUsers(userIds), captured = capture(params), scopeId = serviceDataScopeKey(scope);
  const fence = () => { if (check) invokeSynchronousAuthCallback(check, { component: 'notifications', invariant: 'effect-commit-authority', message: 'Notification effect authority must be synchronous.', createError: invalid }); };
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const id = digest([scopeId, effectId]), fingerprint = digest([scopeId, users, captured, senderId ?? null]);
  return db.transaction(() => {
    fence();
    const existing = db.prepare('SELECT request_hash,notification_id FROM _notification_effect_receipts WHERE id=? AND scope_id=?').get(id, scopeId) as { request_hash: string; notification_id: string | null } | null;
    if (existing) {
      if (existing.request_hash !== fingerprint) throw new AuthError('The notification effect identity was reused with different input.', 'NOTIFICATION_EFFECT_CONFLICT', 409);
      const retained = existing.notification_id !== null && !!db.prepare('SELECT 1 FROM notifications WHERE notification_id=? AND tenant_id IS ?').get(existing.notification_id, scope.tenantId);
      fence(); return { notificationId: existing.notification_id, duplicate: true, retained };
    }
    const notificationId = users.length ? publish(users, captured).notification_id : null;
    fence(); db.prepare('INSERT INTO _notification_effect_receipts(id,scope_id,request_hash,notification_id,created_at) VALUES(?,?,?,?,?)').run(id, scopeId, fingerprint, notificationId, Date.now()); fence();
    return { notificationId, duplicate: false, retained: notificationId !== null };
  });
}
function capture(value: NotificationOnceParams): NotificationOnceParams {
  if (!value || typeof value !== 'object' || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), allowed = ['type', 'priority', 'title', 'body', 'actionUrl', 'expiresAt'];
  for (const key of Reflect.ownKeys(descriptors)) if (typeof key !== 'string' || !allowed.includes(key) || !descriptors[key]!.enumerable || !('value' in descriptors[key]!)) throw invalid();
  const r = Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
  const text = (item: unknown, max: number) => typeof item === 'string' && item.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(item);
  if (!text(r.title, 200) || !(r.title as string).trim() || r.body !== undefined && !text(r.body, 1000)
    || r.type !== undefined && !['info', 'warning', 'success', 'error', 'system'].includes(r.type)
    || r.priority !== undefined && !['low', 'normal', 'high', 'urgent'].includes(r.priority)
    || r.actionUrl !== undefined && (!text(r.actionUrl, 1024) || !r.actionUrl.startsWith('/') || r.actionUrl.startsWith('//') || /[\\\r\n]/u.test(r.actionUrl))
    || r.expiresAt !== undefined && (!Number.isSafeInteger(r.expiresAt) || r.expiresAt < 0)) throw invalid();
  return Object.freeze({ title: r.title, type: r.type ?? 'info', priority: r.priority ?? 'normal', ...(r.body === undefined ? {} : { body: r.body }),
    ...(r.actionUrl === undefined ? {} : { actionUrl: r.actionUrl }), ...(r.expiresAt === undefined ? {} : { expiresAt: r.expiresAt }) });
}
function captureUsers(value: readonly string[]): string[] {
  if (!value || typeof value !== 'object' || types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(length) || length < 0 || length > 100 || Reflect.ownKeys(descriptors).length !== length + 1) throw invalid();
  const users: string[] = [];
  for (let i = 0; i < length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor?.enumerable || !('value' in descriptor) || typeof descriptor.value !== 'string' || !identifier.test(descriptor.value)) throw invalid();
    users.push(descriptor.value);
  }
  return [...new Set(users)].sort();
}
function invalid() { return new AuthError('The notification effect input is invalid.', 'NOTIFICATION_INPUT_INVALID', 422); }

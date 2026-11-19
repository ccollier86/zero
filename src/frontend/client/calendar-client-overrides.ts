/** Browser-only structural admission. Opaque review tokens are never decoded or treated as authority. */
import type { CalendarAppointmentOverride, CalendarOverrideGrantInput, CalendarOverrideGrantView, CalendarOverrideReview } from '../../calendar/contracts';
function invalid(): never { throw new Error('Invalid calendar exception request or acknowledgment.'); }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid();
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined;
    if (typeof key !== 'string' || !fields.includes(key) || !descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value === undefined) return invalid();
    result[key] = descriptor.value;
  }
  if (Object.keys(result).length !== fields.length) return invalid(); return result;
}
function categories(value: unknown, required = false): readonly 'appointment-overlap'[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 1 || required && value.length !== 1
    || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  if (value.length) { const descriptor = Object.getOwnPropertyDescriptor(value, '0'); if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || descriptor.value !== 'appointment-overlap') return invalid(); }
  return Object.freeze(value.length ? ['appointment-overlap'] as const : []);
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) return invalid(); return value;
}
function token(value: unknown): string {
  if (typeof value !== 'string' || value.length > 256 || !/^co1\.[0-9]{1,16}\.[0-9]{1,16}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return invalid(); return value;
}
export function calendarOverrideInput(value: unknown): CalendarAppointmentOverride {
  const row = record(value, ['policyVersion', 'decisionToken', 'reason']);
  if (row.policyVersion !== 'appointment-overlap-v1' || typeof row.reason !== 'string' || row.reason.length > 1024
    || /[\u0000-\u001f\u007f]/.test(row.reason) || !row.reason.trim()) return invalid();
  return Object.freeze({ policyVersion: row.policyVersion, decisionToken: token(row.decisionToken), reason: row.reason.trim() });
}
export function calendarOverrideReview(value: unknown): CalendarOverrideReview {
  if (!value || typeof value !== 'object') return invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, 'status'); if (!descriptor || !('value' in descriptor)) return invalid();
  if (descriptor.value === 'clear' || descriptor.value === 'non-reviewable') { const row = record(value, ['status']); return Object.freeze({ status: row.status as 'clear' | 'non-reviewable' }); }
  const row = record(value, ['status', 'categories', 'policyVersion', 'decisionToken', 'expiresAt']);
  if (row.status !== 'reviewable' || row.policyVersion !== 'appointment-overlap-v1' || typeof row.expiresAt !== 'string' || row.expiresAt.length > 27) return invalid();
  const expiry = new Date(row.expiresAt); if (!Number.isFinite(expiry.getTime()) || expiry.toISOString() !== row.expiresAt) return invalid();
  categories(row.categories, true);
  return Object.freeze({ status: 'reviewable', categories: Object.freeze(['appointment-overlap'] as const), policyVersion: row.policyVersion,
    decisionToken: token(row.decisionToken), expiresAt: row.expiresAt });
}
export function calendarOverrideGrantsInput(value: unknown): CalendarOverrideGrantInput {
  const row = record(value, ['categories']); return Object.freeze({ categories: categories(row.categories) });
}
export function calendarOverrideGrantsView(value: unknown, resourceId: string, userId: string): CalendarOverrideGrantView {
  const row = record(value, ['resourceId', 'userId', 'resourceRevision', 'categories']);
  if (id(row.resourceId) !== resourceId || id(row.userId) !== userId || !Number.isSafeInteger(row.resourceRevision) || Number(row.resourceRevision) < 1) return invalid();
  return Object.freeze({ resourceId, userId, resourceRevision: Number(row.resourceRevision), categories: categories(row.categories) });
}

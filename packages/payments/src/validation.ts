import { invalid } from './errors';
import type { BillingSubject } from '@zero/framework/payments';

export function inputObject(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => {
    const field = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key !== 'string' || !keys.includes(key) || !('value' in field) || !field.enumerable;
  })) invalid('Unexpected payment input. Use plain data and the documented facade fields only.');
}
/** Capture flat command intent before the first await; callers may retain/mutate their object. */
export function snapshotInput<T extends object>(value: T, keys: readonly string[]): Readonly<T> {
  inputObject(value, keys);
  const copy = { ...value };
  if (Object.values(copy).some(item => item !== undefined && (item === null || !['string', 'number', 'boolean'].includes(typeof item)))) invalid('Payment input fields must be scalar values.');
  return Object.freeze(copy);
}
export function operationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) invalid('Use a stable operationId of 8–128 letters, digits, hyphens or underscores.');
  return value;
}
/** Trusted migration helpers still capture and validate their owner before asynchronous provider work. */
export function trustedSubject(input: BillingSubject): BillingSubject {
  const value = snapshotInput(input, ['kind', 'id', 'tenantId']);
  if (!['user', 'organization'].includes(value.kind) || typeof value.id !== 'string' || !value.id || value.id.length > 256 || value.tenantId !== undefined && (value.kind !== 'user' || typeof value.tenantId !== 'string' || !value.tenantId || value.tenantId.length > 256)) invalid('Invalid trusted billing subject.');
  return value;
}
export function resourceId(value: unknown, prefix: string): string {
  if (typeof value !== 'string' || !new RegExp(`^${prefix}_[a-zA-Z0-9_]{1,200}$`).test(value)) invalid('Invalid payment resource ID.');
  return value;
}
export function pageInput(input: { limit?: number; after?: string } = {}): { limit: number; starting_after?: string } {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || input.after !== undefined && (typeof input.after !== 'string' || !/^[a-zA-Z0-9_]{1,220}$/.test(input.after))) invalid('Invalid payment pagination.');
  return { limit, ...(input.after ? { starting_after: input.after } : {}) };
}

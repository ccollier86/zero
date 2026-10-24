import { invalid } from './errors';

export function inputObject(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid('Unexpected payment input. Use the documented facade fields only.');
}
export function operationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(value)) invalid('Use a stable operationId of 8–128 letters, digits, hyphens or underscores.');
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

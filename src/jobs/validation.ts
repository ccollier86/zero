/** Bounded detached job data and canonical hashes. No executable, scope authority or provider configuration comes from clients. */
import { createHash } from 'node:crypto';
import { stableStringify } from '../migrations/schema-snapshot';
import { workerRecord, workerValue, type WorkerValue } from '../workers/worker-value';
import { JobsError } from './error';
export type JobValue = WorkerValue;
export function jobRecord(input: unknown, fields?: readonly string[]): Record<string, unknown> {
  try { return workerRecord(input, fields); } catch { throw new JobsError('JOBS_INPUT_INVALID'); }
}
export function jobValue(input: unknown): JobValue { try { return workerValue(input); } catch { throw new JobsError('JOBS_INPUT_INVALID'); } }
export function jobJson(input: unknown): string { return stableStringify(jobValue(input)); }
export function jobHash(input: unknown): string { return createHash('sha256').update(jobJson(input)).digest('hex'); }
export function jobText(input: unknown, limit = 256): string {
  if (typeof input !== 'string' || !input || input.length > limit || /[\u0000-\u001f\u007f]/.test(input)) throw new JobsError('JOBS_INPUT_INVALID');
  return input;
}
export function jobKey(input: unknown): string {
  const key = jobText(input, 128); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new JobsError('JOBS_INPUT_INVALID'); return key;
}
export function jobInteger(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max) throw new JobsError('JOBS_INPUT_INVALID'); return input;
}
export function jobTime(input: unknown): number {
  const value = jobInteger(input); if (!Number.isFinite(new Date(value).getTime())) throw new JobsError('JOBS_INPUT_INVALID'); return value;
}
/** Scope is an already admitted opaque identity, not a path. Physical routing uses its hash and live broker authority. */
export function jobScope(input: unknown): string {
  const id = jobText(input, 263);
  if (id !== 'application' && (!id.startsWith('tenant:') || id.length <= 7 || id.slice(7).trim() !== id.slice(7))) throw new JobsError('JOBS_INPUT_INVALID');
  return id;
}
export function jobInput(input: unknown): JobValue {
  const value = jobValue(input); if (Buffer.byteLength(jobJson(value)) > 32 * 1024) throw new JobsError('JOBS_INPUT_INVALID'); return value;
}

/** Bounded JSON-only worker contracts. Never inspect getters or serialize handles/code. */
import { isDatabaseExecutorValue, readDatabaseExecutorDataRecord } from '../databases/database-executor-validation';
import { WorkerError } from './worker-error';

export type WorkerValue = null | boolean | number | string | WorkerValue[] | { [key: string]: WorkerValue };
export const WORKER_VALUE_MAX_BYTES = 1024 * 1024;

export function workerRecord(value: unknown, fields?: readonly string[]): Record<string, unknown> {
  const result = readDatabaseExecutorDataRecord(value);
  if (!result || fields && Object.keys(result).some(key => !fields.includes(key))) throw invalid();
  return result;
}

export function workerValue(value: unknown): WorkerValue {
  // Validate structural budgets before walking, cloning or encoding. The shared
  // protocol validator rejects accessors, proxies, cycles and huge containers.
  if (!isDatabaseExecutorValue(value)) throw invalid();
  let nodes = 0;
  const clone = (input: unknown, depth: number): WorkerValue => {
    if (++nodes > 10_000 || depth > 24) throw invalid();
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return Object.is(input, -0) ? 0 : input;
    if (Array.isArray(input)) return input.map(child => clone(child, depth + 1));
    const record = workerRecord(input), result: Record<string, WorkerValue> = Object.create(null);
    for (const [key, child] of Object.entries(record)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw invalid();
      result[key] = clone(child, depth + 1);
    }
    return result;
  };
  const result = clone(value, 0);
  if (Buffer.byteLength(JSON.stringify(result)) > WORKER_VALUE_MAX_BYTES) throw invalid();
  return result;
}
function invalid() { return new WorkerError('WORKER_TASK_INVALID', 'Worker input or result is not bounded portable JSON.'); }

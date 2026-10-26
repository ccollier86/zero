/** Browser-safe validation of public export receipts. No server, crypto-provider or filesystem imports. */
import type { LoggingExportJob } from './logging-export-contracts';

export function readLoggingExportJob(value: unknown): LoggingExportJob {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid logging export receipt.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const fields = ['id', 'stream', 'state', 'createdAt', 'expiresAt', 'completedAt', 'highWaterOrdinal', 'count', 'complete', 'nextBeforeOrdinal', 'sha256'];
  if (Reflect.ownKeys(descriptors).length !== fields.length || fields.some(k => !descriptors[k]?.enumerable || !('value' in descriptors[k]!))) throw new Error('Invalid logging export receipt.');
  const j = Object.fromEntries(fields.map(k => [k, descriptors[k]!.value]));
  const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (typeof j.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(j.id) || !['audit', 'operational'].includes(j.stream)
    || !['pending', 'ready', 'failed', 'expired'].includes(j.state) || !integer(j.createdAt) || !integer(j.expiresAt) || j.expiresAt <= j.createdAt
    || !integer(j.highWaterOrdinal) || !integer(j.count) || j.count > 1000 || typeof j.complete !== 'boolean'
    || j.completedAt !== null && (!integer(j.completedAt) || j.completedAt < j.createdAt || j.completedAt >= j.expiresAt)
    || j.nextBeforeOrdinal !== null && (!integer(j.nextBeforeOrdinal) || j.nextBeforeOrdinal > j.highWaterOrdinal)
    || j.sha256 !== null && (typeof j.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(j.sha256))
    || j.state === 'ready' && (j.sha256 === null || j.completedAt === null || j.complete !== (j.nextBeforeOrdinal === null))
    || j.state === 'pending' && (j.sha256 !== null || j.completedAt !== null || j.count !== 0 || j.complete || j.nextBeforeOrdinal !== null)) throw new Error('Invalid logging export receipt.');
  return Object.freeze(j as unknown as LoggingExportJob);
}

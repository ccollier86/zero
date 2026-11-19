/** Native, realm-owned writer admission. Only detached policy data crosses bind IPC. */
import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { stableStringify } from '../migrations/schema-snapshot';
import type { Row } from '../sync/types';
import { DatabaseError } from './database-error';
import { cloneDatabaseSerializableValue, type DatabaseSerializableValue, type DatabaseWriteOperation } from './database-operations';
import type { DatabaseWriterReceiptRetentionCounts } from './database-receipt-contract';
import type { DatabaseRealm } from './database-realm';

export interface DatabaseWriterAdmissionContext {
  /** Revocable tracked primary-key reads only; no raw SQL, handles or mutations. */
  readonly get: (table: string, id: string) => Row | null;
  readonly policy: DatabaseSerializableValue;
  readonly receipts: DatabaseWriterReceiptRetentionCounts;
}
export interface DatabaseWriterAdmissionDefinition {
  /** Explicit code semantics, included in realm identity. */
  readonly id: string;
  readonly normalizeBinding: (value: DatabaseSerializableValue | undefined) => DatabaseSerializableValue;
  readonly snapshot: (context: DatabaseWriterAdmissionContext) => DatabaseSerializableValue;
  /** Runs after domain mutation and before receipt insertion, inside the same root transaction. */
  readonly validate: (context: DatabaseWriterAdmissionContext, operation: DatabaseWriteOperation, before: DatabaseSerializableValue) => undefined;
  /** Bounded aggregate-only projection. Realm code must not return identities or content. */
  readonly project: (context: DatabaseWriterAdmissionContext) => DatabaseSerializableValue;
}
export interface DatabaseWriterAdmissionInspection {
  readonly policyFingerprint: string | null;
  readonly receipts: DatabaseWriterReceiptRetentionCounts;
  readonly admission: DatabaseSerializableValue;
}
const FUNCTIONS = ['normalizeBinding', 'snapshot', 'validate', 'project'] as const;
export function admitDatabaseWriterAdmission(value: unknown): DatabaseWriterAdmissionDefinition | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || utilTypes.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== 5 || Object.keys(descriptors).some(key => !['id', ...FUNCTIONS].includes(key))
    || Object.values(descriptors).some(d => !Object.hasOwn(d, 'value'))) throw invalid();
  const r = value as DatabaseWriterAdmissionDefinition;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(r.id)
    || FUNCTIONS.some(key => typeof r[key] !== 'function' || utilTypes.isAsyncFunction(r[key]) || utilTypes.isGeneratorFunction(r[key]))) throw invalid();
  return Object.freeze({ id: r.id, normalizeBinding: r.normalizeBinding, snapshot: r.snapshot, validate: r.validate, project: r.project });
}
export function synchronousAdmissionValue(value: unknown): DatabaseSerializableValue {
  if (utilTypes.isPromise(value)) { void Promise.resolve(value).catch(() => undefined); throw invalid(); }
  const result = cloneDatabaseSerializableValue(value);
  if (Buffer.byteLength(stableStringify(result)) > 16_384) throw invalid();
  return freeze(result);
}
export function normalizeDatabaseWriterAdmission(realm: DatabaseRealm, value?: DatabaseSerializableValue): DatabaseSerializableValue | undefined {
  if (!realm.writerAdmission) {
    if (value !== undefined) throw invalid();
    return undefined;
  }
  const detached = value === undefined ? undefined : synchronousAdmissionValue(value);
  try { return synchronousAdmissionValue(realm.writerAdmission.normalizeBinding(detached)); }
  catch { throw invalid(); }
}
export function databaseWriterAdmissionFingerprint(realm: DatabaseRealm, policy: DatabaseSerializableValue | undefined): string | undefined {
  if (!realm.writerAdmission || policy === undefined) return undefined;
  return createHash('sha256').update('zero.writer-admission.v1\0').update(realm.writerAdmission.id).update('\0').update(stableStringify(policy)).digest('hex');
}
function freeze<T extends DatabaseSerializableValue>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function invalid() { return new DatabaseError('DATABASE_CONFIG_INVALID', 'Native database writer admission is invalid.', { outcome: 'not-started', retryable: false }); }

/** Producer boundary for the private aggregate-only actor operation. */
export function validateDatabaseWriterAdmissionInspection(value: unknown): DatabaseWriterAdmissionInspection {
  try {
    const record = synchronousAdmissionValue(value) as unknown as DatabaseWriterAdmissionInspection;
    if (!record || typeof record !== 'object' || Object.keys(record).sort().join(',') !== 'admission,policyFingerprint,receipts'
      || record.policyFingerprint !== null && (typeof record.policyFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.policyFingerprint))) throw invalid();
    const r = record.receipts;
    const fields = ['totalKeys', 'retainedResults', 'expiredTombstones', 'retainedResultBytes', 'keyLimit', 'retainedLimit', 'retainedByteLimit', 'resultByteLimit'];
    if (!r || typeof r !== 'object' || Object.keys(r).length !== fields.length
      || fields.some(key => !Number.isSafeInteger((r as unknown as Record<string, number>)[key]) || (r as unknown as Record<string, number>)[key]! < 0)
      || r.totalKeys !== r.retainedResults + r.expiredTombstones || r.totalKeys > r.keyLimit || r.keyLimit < 1 || r.keyLimit > 1_000_000
      || r.retainedLimit < 1 || r.retainedLimit > 10_000 || r.retainedByteLimit < 1 || r.retainedByteLimit > 67_108_864
      || r.resultByteLimit < 1 || r.resultByteLimit > 8_388_608 || r.retainedResults > r.retainedLimit || r.retainedResultBytes > r.retainedByteLimit) throw invalid();
    return record;
  } catch {
    throw new DatabaseError('DATABASE_PROTOCOL_ERROR', 'Native writer admission inspection result is invalid.', { retryable: false, outcome: 'unknown' });
  }
}

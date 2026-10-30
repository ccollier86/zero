/** Descriptor-safe actor boundary for historical results. This is not a general record serializer. */
import type { LoggingDeriveResultInput, LoggingResultManifest, LoggingResultReceipt } from './logging-result-contracts';
import { LOGGING_RESULT_MAX_RECORDS } from './logging-result-contracts';
import { loggingArray, loggingByteLength, loggingChoice, loggingId, loggingRecord, loggingTime, invalid } from './logging-validation';
import { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';
import { loggingTableTarget } from './logging-table-target';

export function normalizeLoggingResultManifest(raw: unknown): LoggingResultManifest {
  const r = loggingRecord(raw, ['version', 'id', 'kind', 'table', 'preparedAt', 'criteriaDigest', 'records', 'complete', 'sources']);
  if (r.version !== 1 || typeof r.table !== 'string' || !r.table || r.table.length > 1024 || /[\u0000-\u001f\u007f]/.test(r.table)
    || typeof r.criteriaDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.criteriaDigest) || typeof r.complete !== 'boolean') invalid();
  const kind = loggingChoice(r.kind, ['record', 'list'] as const), type = loggingTableTarget(r.table);
  const records = loggingArray(r.records, LOGGING_RESULT_MAX_RECORDS).map(raw => {
    const item = loggingRecord(raw, ['type', 'id', 'revision', 'values']);
    if (item.type !== type) invalid();
    const values = loggingRecord(item.values);
    if (Object.keys(values).length > 32) invalid();
    for (const [key, value] of Object.entries(values))
      if (!key || key.length > 256 || /[\u0000-\u001f\u007f]/.test(key) || LOGGING_SENSITIVE_FIELD.test(key) || !isLoggingApprovedScalar(value)) invalid();
    return Object.freeze({ type, id: loggingId(item.id)!, revision: loggingId(item.revision)!, values: Object.freeze(values) }) as LoggingResultManifest['records'][number];
  });
  if (kind === 'record' && records.length !== 1 || new Set(records.map(row => row.id)).size !== records.length || loggingByteLength(raw) > 256 * 1024) invalid();
  const sources = r.sources === undefined ? undefined : loggingArray(r.sources, LOGGING_RESULT_MAX_RECORDS).map(raw => {
    const source = loggingRecord(raw, ['receiptId', 'digest']);
    if (typeof source.digest !== 'string' || !/^[a-f0-9]{64}$/.test(source.digest)) invalid();
    return Object.freeze({ receiptId: loggingId(source.receiptId)!, digest: source.digest });
  });
  if (sources && (!sources.length || new Set(sources.map(source => source.receiptId)).size !== sources.length || sources.some(source => source.receiptId === r.id))) invalid();
  return Object.freeze({ version: 1, id: loggingId(r.id)!, kind, table: r.table, preparedAt: loggingTime(r.preparedAt),
    criteriaDigest: r.criteriaDigest, records: Object.freeze(records), complete: r.complete, ...(sources ? { sources: Object.freeze(sources) } : {}) });
}

export function normalizeLoggingDeriveResultInput(raw: unknown): LoggingDeriveResultInput {
  const r = loggingRecord(raw, ['id', 'kind', 'sources']);
  let count = 0;
  const sources = loggingArray(r.sources, LOGGING_RESULT_MAX_RECORDS).map(raw => {
    const source = loggingRecord(raw, ['receiptId', 'positions']);
    const positions = loggingArray(source.positions, LOGGING_RESULT_MAX_RECORDS).map(position => {
      if (!Number.isSafeInteger(position) || Number(position) < 0 || Number(position) >= LOGGING_RESULT_MAX_RECORDS || ++count > LOGGING_RESULT_MAX_RECORDS) invalid();
      return Number(position);
    });
    return Object.freeze({ receiptId: loggingId(source.receiptId)!, positions: Object.freeze(positions) });
  });
  const kind = loggingChoice(r.kind, ['record', 'list'] as const);
  if (!sources.length || kind === 'record' && count !== 1 || loggingByteLength(raw) > 128 * 1024) invalid();
  return Object.freeze({ id: loggingId(r.id)!, kind, sources: Object.freeze(sources) });
}

export function normalizeLoggingResultReceipt(raw: unknown): LoggingResultReceipt {
  const r = loggingRecord(raw, ['id', 'digest', 'kind', 'table', 'count', 'expiresAt']);
  if (typeof r.digest !== 'string' || !/^[a-f0-9]{64}$/.test(r.digest) || typeof r.table !== 'string' || !r.table || r.table.length > 1024
    || /[\u0000-\u001f\u007f]/.test(r.table) || !Number.isSafeInteger(r.count) || Number(r.count) < 0 || Number(r.count) > LOGGING_RESULT_MAX_RECORDS) invalid();
  const kind = loggingChoice(r.kind, ['record', 'list'] as const);
  if (kind === 'record' && r.count !== 1) invalid();
  return Object.freeze({ id: loggingId(r.id)!, digest: r.digest, kind, table: r.table, count: Number(r.count), expiresAt: loggingTime(r.expiresAt) });
}

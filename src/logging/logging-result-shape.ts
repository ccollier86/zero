/** Browser JSON transport shapes only. Server capture and ownership admission remain separate. */
import type { LoggingResultManifest, LoggingResultReceipt } from './logging-result-contracts';
import { LOGGING_RESULT_MAX_RECORDS } from './logging-result-contracts';
import { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const table = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(value);
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export function isLoggingResultReceipt(raw: unknown): raw is LoggingResultReceipt {
  if (!plain(raw) || Object.keys(raw).some(key => !['id', 'digest', 'kind', 'table', 'count', 'expiresAt'].includes(key))) return false;
  return id(raw.id) && typeof raw.digest === 'string' && /^[a-f0-9]{64}$/.test(raw.digest) && ['record', 'list'].includes(String(raw.kind))
    && table(raw.table) && time(raw.count) && raw.count <= LOGGING_RESULT_MAX_RECORDS && (raw.kind !== 'record' || raw.count === 1) && time(raw.expiresAt);
}
export function isLoggingResultManifest(raw: unknown): raw is LoggingResultManifest {
  if (!plain(raw) || Object.keys(raw).some(key => !['version', 'id', 'kind', 'table', 'preparedAt', 'criteriaDigest', 'records', 'complete', 'sources'].includes(key))) return false;
  return raw.version === 1 && id(raw.id) && ['record', 'list'].includes(String(raw.kind)) && table(raw.table) && time(raw.preparedAt)
    && typeof raw.criteriaDigest === 'string' && /^[a-f0-9]{64}$/.test(raw.criteriaDigest) && typeof raw.complete === 'boolean'
    && Array.isArray(raw.records) && raw.records.length <= LOGGING_RESULT_MAX_RECORDS && (raw.kind !== 'record' || raw.records.length === 1)
    && new Set(raw.records.map(record => record?.id)).size === raw.records.length
    && (raw.sources === undefined || Array.isArray(raw.sources) && raw.sources.length > 0 && raw.sources.length <= LOGGING_RESULT_MAX_RECORDS
      && new Set(raw.sources.map(source => source?.receiptId)).size === raw.sources.length
      && raw.sources.every(source => plain(source) && Object.keys(source).every(key => ['receiptId', 'digest'].includes(key))
        && id(source.receiptId) && source.receiptId !== raw.id && typeof source.digest === 'string' && /^[a-f0-9]{64}$/.test(source.digest)))
    && raw.records.every(record => plain(record) && Object.keys(record).every(key => ['type', 'id', 'revision', 'values'].includes(key))
      && typeof record.type === 'string' && /^table\.[a-z0-9][a-z0-9.-]*$/.test(record.type) && record.type.length <= 120
      && id(record.id) && id(record.revision) && plain(record.values) && Object.keys(record.values).length <= 32
      && Object.entries(record.values).every(([key, value]) => key.length > 0 && key.length <= 256 && !/[\u0000-\u001f\u007f]/.test(key) && !LOGGING_SENSITIVE_FIELD.test(key) && isLoggingApprovedScalar(value)));
}

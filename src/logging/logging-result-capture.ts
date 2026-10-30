/** Privacy-policy-approved manifests from already authorized native/custom read results. No full record/body snapshot. */
import type { LoggingPrepareResultInput, LoggingResultManifest } from './logging-result-contracts';
import { LOGGING_RESULT_MAX_RECORDS } from './logging-result-contracts';
import type { LoggingResourcePolicies } from './logging-activity-contracts';
import { loggingArray, loggingRecord, loggingId, loggingByteLength } from './logging-validation';
import { loggingDigest } from './logging-hash';
import { loggingTableTarget } from './logging-table-target';
import { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { LoggingError } from './logging-error';

export function captureLoggingResult(input: LoggingPrepareResultInput, resources: LoggingResourcePolicies, id: string = crypto.randomUUID(), preparedAt = Date.now()): LoggingResultManifest {
  const r = loggingRecord(input, ['table', 'kind', 'rows', 'primaryKey', 'revision', 'criteria']);
  if (typeof r.table !== 'string' || !r.table || r.table.length > 1024 || /[\u0000-\u001f\u007f]/.test(r.table)
    || !['record', 'list'].includes(r.kind as string) || r.primaryKey !== undefined && (typeof r.primaryKey !== 'string' || !r.primaryKey || r.primaryKey.length > 256))
    throw new LoggingError('LOGGING_EVENT_INVALID', 'Read result descriptor is invalid.');
  const table = r.table, primaryKey = String(r.primaryKey ?? 'id'), type = loggingTableTarget(table);
  const revision = r.revision === undefined ? 'release:' + id : loggingId(r.revision)!;
  const rows = loggingArray(r.rows, LOGGING_RESULT_MAX_RECORDS);
  if (r.kind === 'record' && rows.length !== 1) throw new LoggingError('LOGGING_EVENT_INVALID', 'A record result requires exactly one authorized record.');
  const fields = resources[table]?.fields ?? {};
  const records = rows.map(value => {
    const row = loggingRecord(value), rawId = row[primaryKey];
    if (typeof rawId !== 'string' && (typeof rawId !== 'number' || !Number.isSafeInteger(rawId))) throw new LoggingError('LOGGING_EVENT_INVALID', 'Read result has no stable record identity.');
    const key = String(rawId), recordId = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key) ? key : 'hash:' + loggingDigest(key);
    const values: Record<string, import('./logging-contracts').LoggingScalar> = Object.create(null);
    for (const [field, policy] of Object.entries(fields)) {
      const item = row[field];
      if (typeof policy === 'object' && !LOGGING_SENSITIVE_FIELD.test(field) && isLoggingApprovedScalar(item) && policy.values.includes(item)) values[field] = item;
    }
    return Object.freeze({ type, id: recordId, revision, values: Object.freeze(values) });
  });
  if (new Set(records.map(row => row.id)).size !== records.length) throw new LoggingError('LOGGING_EVENT_INVALID', 'A result needs stable unique ordered identities; declare a joined-result identity.');
  const criteria = r.criteria === undefined ? null : cloneDatabaseSerializableValue(r.criteria);
  const manifest: LoggingResultManifest = Object.freeze({ version: 1, id, kind: r.kind as 'record' | 'list', table, preparedAt,
    criteriaDigest: loggingDigest(criteria), records: Object.freeze(records), complete: true });
  if (loggingByteLength(manifest) > 256 * 1024) throw new LoggingError('LOGGING_RESULT_LIMIT', 'Historical result exceeds its 256 KiB receipt budget; use a smaller page.');
  return manifest;
}

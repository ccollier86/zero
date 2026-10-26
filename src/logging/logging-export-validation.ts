/** Validate the complete private worker export projection before using its scope or artifact identity. */
import type { OwnedLoggingExportJob } from './logging-export-realm';
import { loggingRecord, normalizeLoggingEvent } from './logging-validation';
import { normalizeLoggingQuery } from './logging-query';
import type { LoggingQuery, LoggingReadScope } from './logging-contracts';
import { loggingDigest } from './logging-hash';
import { LoggingError } from './logging-error';
import { readLoggingExportJob } from './logging-export-result';

export function readOwnedLoggingExport(value: unknown): OwnedLoggingExportJob {
  try {
    const r = loggingRecord(value, ['job', 'scope', 'query', 'request', 'artifactRemoved']);
    const job = readLoggingExportJob(r.job), { id, stream } = job;
    const admitted = normalizeLoggingQuery(stream, r.scope as LoggingReadScope, r.query as LoggingQuery), request = normalizeLoggingEvent(r.request);
    if (admitted.scope.kind === 'platform' || admitted.query.highWaterOrdinal !== job.highWaterOrdinal || typeof r.artifactRemoved !== 'boolean'
      || request.action !== 'logging.export.requested' || request.family !== 'investigations'
      || request.target?.type !== 'logging.export' || request.target.id !== id
      || request.scope.kind !== admitted.scope.kind || request.scope.tenantId !== (admitted.scope.kind === 'tenant' ? admitted.scope.tenantId : null)
      || request.metadata.queryDigest !== loggingDigest([stream, admitted.scope, admitted.query])) throw new Error();
    return Object.freeze({ scope: admitted.scope, query: admitted.query, request, artifactRemoved: r.artifactRemoved, job });
  } catch { throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Stored logging export is invalid.'); }
}

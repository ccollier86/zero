/** Browser-only native result lineage for package/source-copy components. Not server authority or a persistence API. */
export { LOGGING_RESULT_MAX_RECORDS } from '../../logging/logging-result-contracts';
export type { LoggingResultReceipt, LoggingResultManifest, LoggingResultRecord, LoggingDeriveResultInput } from '../../logging/logging-result-contracts';
export { isLoggingResultReceipt } from '../../logging/logging-result-shape';
export { registerLoggingResultRows, loggingResultForRow, emptyLoggingResult, carryEmptyLoggingResult, carryLoggingResultRow, selectLoggingResultRows } from './logging-result-provenance';

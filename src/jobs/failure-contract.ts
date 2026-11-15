/** Browser-safe failure vocabulary; contains no authority, storage or runtime imports. Ordinals are append-only. */
export const JOBS_REJECTIONS = ['JOBS_INPUT_INVALID', 'JOBS_NOT_FOUND', 'JOBS_FORBIDDEN', 'JOBS_REVISION_CONFLICT',
  'JOBS_INTENT_CONFLICT', 'JOBS_CAPACITY', 'JOBS_STAGE_CONFLICT', 'JOBS_STATE_INVALID'] as const;
export type JobsErrorCode = typeof JOBS_REJECTIONS[number] | 'JOBS_NOT_READY' | 'JOBS_CONFIG_INVALID'
  | 'JOBS_DEFINITION_UNAVAILABLE' | 'JOBS_AUTHORITY_RETIRED' | 'JOBS_OUTCOME_UNKNOWN';
export type JobOperationOutcome = 'not-started' | 'not-committed' | 'unknown';
const codes = new Set<string>([...JOBS_REJECTIONS, 'JOBS_NOT_READY', 'JOBS_CONFIG_INVALID', 'JOBS_DEFINITION_UNAVAILABLE', 'JOBS_AUTHORITY_RETIRED', 'JOBS_OUTCOME_UNKNOWN']);
export function isJobsErrorCode(value: unknown): value is JobsErrorCode { return typeof value === 'string' && codes.has(value); }

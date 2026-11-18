/** Canonical source facts only. Handoff/terminal observation never asserts provider delivery or reverses an accepted effect. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { appendDatabaseCommandSourceAudit } from '../databases/database-command-source-audit';
import type { Change } from '../sync/types';
import type { LoggingScalar } from '../logging/logging-contracts';
import { JobsError } from './error';
import { jobHash } from './validation';

type JobAuditAction = 'jobs.schedule.created' | 'jobs.schedule.paused' | 'jobs.schedule.cancelled' | 'jobs.schedule.readmitted' | 'jobs.schedule.blocked'
  | 'jobs.occurrence.handed-off' | 'jobs.occurrence.blocked' | 'jobs.occurrence.terminal-observed';
interface JobAuditMetadata {
  readonly revision?: number; readonly generation?: number;
  readonly previousControl?: 'active' | 'paused' | 'cancelled'; readonly control?: 'active' | 'paused' | 'cancelled';
  readonly ownership?: 'actor' | 'service'; readonly scheduleId?: string; readonly workflowId?: string;
  readonly blockedCode?: 'JOBS_AUTHORITY_RETIRED' | 'JOBS_DEFINITION_UNAVAILABLE' | 'JOBS_CAPACITY' | 'JOBS_NOT_DISPATCHED';
  readonly workflowStatus?: 'completed' | 'failed' | 'cancelled';
  readonly sourceId?: string; readonly policyGeneration?: number; readonly initiatedBy?: string;
}

export function appendJobSemanticAudit(context: DatabaseWriteCommandContext, action: JobAuditAction, change: Change | null,
  metadata: JobAuditMetadata, outcome: 'succeeded' | 'denied' | 'failed' = 'succeeded'): void {
  if (!change) throw new JobsError('JOBS_STATE_INVALID');
  const values: Record<string, LoggingScalar> = { sequence: change.seq };
  for (const [key, value] of Object.entries(metadata)) if (value !== undefined) values[key] = value;
  appendDatabaseCommandSourceAudit(context, {
    // A real committed source sequence distinguishes repeated A -> B -> A states without another event table.
    id: 'jobs:' + jobHash([action, change.table, change.rowId, change.seq]), family: 'workflow', action, outcome, occurredAt: change.ts,
    target: { type: action.startsWith('jobs.schedule.') ? 'job.schedule' : 'job.occurrence', id: change.rowId },
    metadata: values,
  });
}

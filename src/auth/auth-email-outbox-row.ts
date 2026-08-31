import type { AuthEmailOutboxJob, AuthEmailOutboxKind } from './auth-email-outbox-types';

export interface AuthEmailOutboxRow {
  job_id: string;
  kind: AuthEmailOutboxKind;
  recipient: string;
  native_continuation: string | null;
  attempts: number;
  lease_owner: string | null;
}

export function toAuthEmailOutboxJob(row: AuthEmailOutboxRow): AuthEmailOutboxJob {
  if (!row.lease_owner) throw new Error('Claimed auth email job has no lease owner');
  return {
    jobId: row.job_id,
    kind: row.kind,
    recipient: row.recipient,
    nativeContinuation: row.native_continuation,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
  };
}

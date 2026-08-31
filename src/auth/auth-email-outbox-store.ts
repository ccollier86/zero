import type { ReactiveDB } from '../sync/reactive-db';
import { hashToken } from '../tokens/token-utils';
import type { AuthEmailOutboxJob, AuthEmailOutboxKind, AuthEmailOutboxTerminal } from './auth-email-outbox-types';
import { prepareAuthEmailOutboxStatements } from './auth-email-outbox-store-sql';
import { toAuthEmailOutboxJob, type AuthEmailOutboxRow } from './auth-email-outbox-row';

export type AuthEmailEnqueueResult = 'enqueued' | 'duplicate' | 'capacity';

export class AuthEmailOutboxStore {
  private readonly sql;
  constructor(private readonly db: ReactiveDB, private readonly workerId: string) {
    this.sql = prepareAuthEmailOutboxStatements(db);
  }

  enqueue(input: { kind: AuthEmailOutboxKind; recipient: string; nativeContinuation?: string },
    now: number, requestWindowMs: number, maxActiveJobs: number,
    maxStoredJobs: number): AuthEmailEnqueueResult {
    return this.db.transaction(() => {
      const recipientHash = hashToken(input.recipient);
      const recent = this.sql.recent.get(recipientHash, input.kind, now - requestWindowMs);
      const active = this.sql.activeCount.get() as { count: number };
      const total = this.sql.totalCount.get() as { count: number };
      if (recent) return 'duplicate';
      if (active.count >= maxActiveJobs || total.count >= maxStoredJobs) return 'capacity';
      this.sql.insert.run(`aem_${crypto.randomUUID()}`, input.kind, input.recipient,
        recipientHash, input.nativeContinuation ?? null, now, now, now);
      return 'enqueued';
    });
  }

  claim(now: number, leaseMs: number): AuthEmailOutboxJob | null {
    return this.db.transaction(() => {
      const row = this.sql.nextDue.get(now, now) as AuthEmailOutboxRow | null;
      if (!row) return null;
      const claimed = this.sql.claim.run(
        this.workerId, now + leaseMs, now, row.job_id, now, now
      );
      if (claimed.changes !== 1) return null;
      return toAuthEmailOutboxJob({
        ...row, attempts: row.attempts + 1, lease_owner: this.workerId,
      });
    });
  }

  complete(job: AuthEmailOutboxJob, status: AuthEmailOutboxTerminal, now: number): boolean {
    return this.sql.complete.run(status, now, now, job.jobId, job.leaseOwner).changes === 1;
  }

  release(job: AuthEmailOutboxJob, now: number): boolean {
    return this.sql.release.run(now, now, job.jobId, job.leaseOwner).changes === 1;
  }

  fail(job: AuthEmailOutboxJob, code: string, retryAt: number | null, now: number): boolean {
    if (retryAt === null) {
      return this.sql.dead.run(now, code, now, job.jobId, job.leaseOwner).changes === 1;
    }
    return this.sql.retry.run(retryAt, code, now, job.jobId, job.leaseOwner).changes === 1;
  }

  extendLease(job: AuthEmailOutboxJob, until: number, now: number): boolean {
    return this.sql.extendLease.run(until, now, job.jobId, job.leaseOwner).changes === 1;
  }

  recoverExpired(now: number): number {
    return this.sql.recover.run(now, now, now).changes;
  }

  cleanup(before: number): number { return this.sql.cleanup.run(before).changes; }

  count(status: AuthEmailOutboxTerminal | 'pending' | 'processing'): number {
    return (this.sql.statusCount.get(status) as { count: number }).count;
  }
}

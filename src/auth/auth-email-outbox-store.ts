import type { ReactiveDB } from '../sync/reactive-db';
import { hashToken } from '../tokens/token-utils';
import type {
  AuthEmailAccountLinkKind,
  AuthEmailOutboxJob,
  AuthEmailOutboxTerminal,
} from './auth-email-outbox-types';
import { prepareAuthEmailOutboxStatements } from './auth-email-outbox-store-sql';
import { toAuthEmailOutboxJob, type AuthEmailOutboxRow } from './auth-email-outbox-row';
import {
  createAuthStateInvariantError,
  type AuthPlatformCodeEmitter,
} from './auth-observability';

export type AuthEmailEnqueueResult = 'enqueued' | 'duplicate' | 'capacity';

export class AuthEmailOutboxStore {
  private readonly sql;
  private readonly invitationCapable: boolean;
  private readonly domainCapable: boolean;
  constructor(
    private readonly db: ReactiveDB,
    private readonly workerId: string,
    private readonly assertRuntimeProfileCurrent: () => void = () => {},
    private readonly emitCode?: AuthPlatformCodeEmitter,
  ) {
    const columns = db.prepare('PRAGMA table_info(_auth_email_outbox)').all() as unknown as Array<{ name: string }>;
    this.invitationCapable = columns.some(
      (column) => column.name === 'secret_envelope',
    );
    this.domainCapable = columns.some(
      (column) => column.name === 'domain_user_id',
    );
    this.sql = prepareAuthEmailOutboxStatements(
      db,
      this.invitationCapable,
      this.domainCapable,
    );
  }

  enqueueDomainMailbox(input: {
    jobId: string;
    recipient: string;
    recipientHash: string;
    userId: string;
    emailGeneration: number;
    authGeneration: number;
    identityKind: 'session' | 'continuation';
    identityContinuationId: string | null;
  }, now: number, requestWindowMs: number, maxActiveJobs: number,
    maxStoredJobs: number): AuthEmailEnqueueResult {
    if (!this.domainCapable || !this.sql.insertDomainMailbox) {
      throw createAuthStateInvariantError(this.emitCode, {
        component: 'auth-email-outbox-store',
        invariant: 'verified-domain-schema-unavailable',
        message: '[auth] Verified-domain email outbox schema is unavailable.',
      });
    }
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      const recent = this.sql.recent.get(
        input.recipientHash,
        'domain_mailbox_proof',
        now - requestWindowMs,
      );
      const active = this.sql.activeCount.get() as { count: number };
      const total = this.sql.totalCount.get() as { count: number };
      if (recent) return 'duplicate';
      if (active.count >= maxActiveJobs || total.count >= maxStoredJobs) return 'capacity';
      this.sql.insertDomainMailbox!.run(
        input.jobId,
        input.recipient,
        input.recipientHash,
        input.userId,
        input.emailGeneration,
        input.authGeneration,
        input.identityKind,
        input.identityContinuationId,
        now,
        now,
        now,
      );
      return 'enqueued';
    });
  }

  enqueueInvitation(input: {
    invitationId: string;
    recipient: string;
    recipientHash: string;
    secretEnvelope: string;
    jobId: string;
  }, now: number, maxActiveJobs: number,
  maxStoredJobs: number): Exclude<AuthEmailEnqueueResult, 'duplicate'> {
    if (!this.invitationCapable || !this.sql.insertInvitation) {
      throw createAuthStateInvariantError(this.emitCode, {
        component: 'auth-email-outbox-store',
        invariant: 'tenant-invitation-schema-unavailable',
        message: '[auth] Tenant invitation outbox schema is unavailable.',
      });
    }
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      const active = this.sql.activeCount.get() as { count: number };
      const total = this.sql.totalCount.get() as { count: number };
      if (active.count >= maxActiveJobs || total.count >= maxStoredJobs) return 'capacity';
      this.sql.insertInvitation!.run(
        input.jobId,
        input.recipient,
        input.recipientHash,
        input.invitationId,
        input.secretEnvelope,
        now,
        now,
        now,
      );
      return 'enqueued';
    });
  }

  enqueue(input: {
    kind: AuthEmailAccountLinkKind;
    recipient: string;
    nativeContinuation?: string;
  },
    now: number, requestWindowMs: number, maxActiveJobs: number,
    maxStoredJobs: number): AuthEmailEnqueueResult {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
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
      this.assertCurrentProfile();
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
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.sql.complete.run(
        status,
        now,
        now,
        job.jobId,
        job.leaseOwner,
      ).changes === 1;
    });
  }

  release(job: AuthEmailOutboxJob, now: number): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.sql.release.run(now, now, job.jobId, job.leaseOwner).changes === 1;
    });
  }

  fail(job: AuthEmailOutboxJob, code: string, retryAt: number | null, now: number): boolean {
    if (retryAt === null) {
      return this.db.transaction(() => {
        this.assertCurrentProfile();
        const dead = this.sql.dead.run(
          now, code, now, job.jobId, job.leaseOwner,
        ).changes === 1;
        if (dead && job.invitationId) {
          this.db.prepare(`
            UPDATE _auth_tenant_invitations
            SET status = 'revoked', updated_at = ?, revoked_at = ?
            WHERE invitation_id = ? AND status = 'pending'
          `).run(now, now, job.invitationId);
        }
        return dead;
      });
    }
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.sql.retry.run(
        retryAt,
        code,
        now,
        job.jobId,
        job.leaseOwner,
      ).changes === 1;
    });
  }

  extendLease(job: AuthEmailOutboxJob, until: number, now: number): boolean {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.sql.extendLease.run(
        until,
        now,
        job.jobId,
        job.leaseOwner,
      ).changes === 1;
    });
  }

  recoverExpired(now: number): number {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.sql.recover.run(now, now, now).changes;
    });
  }

  cleanup(before: number): number {
    return this.db.transaction(() => {
      this.assertCurrentProfile();
      return this.sql.cleanup.run(before).changes;
    });
  }

  count(status: AuthEmailOutboxTerminal | 'pending' | 'processing'): number {
    this.assertCurrentProfile();
    return (this.sql.statusCount.get(status) as { count: number }).count;
  }

  /** Fence direct/cached worker consumers against an installed-profile change. */
  assertCurrentProfile(): void {
    this.assertRuntimeProfileCurrent();
  }
}

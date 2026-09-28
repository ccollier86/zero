import type { AuthEmailOutboxJob, AuthEmailOutboxKind } from './auth-email-outbox-types';

export interface AuthEmailOutboxRow {
  job_id: string;
  kind: AuthEmailOutboxKind;
  recipient: string;
  native_continuation: string | null;
  invitation_id?: string | null;
  secret_envelope?: string | null;
  domain_user_id?: string | null;
  domain_email_generation?: number | null;
  domain_auth_generation?: number | null;
  domain_identity_kind?: 'session' | 'continuation' | null;
  domain_identity_continuation_id?: string | null;
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
    invitationId: row.invitation_id ?? null,
    secretEnvelope: row.secret_envelope ?? null,
    domainUserId: row.domain_user_id ?? null,
    domainEmailGeneration: row.domain_email_generation ?? null,
    domainAuthGeneration: row.domain_auth_generation ?? null,
    domainIdentityKind: row.domain_identity_kind ?? null,
    domainIdentityContinuationId: row.domain_identity_continuation_id ?? null,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
  };
}

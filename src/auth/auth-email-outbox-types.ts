export type AuthEmailOutboxKind =
  | 'password_reset'
  | 'email_verification'
  | 'tenant_invitation'
  | 'domain_mailbox_proof';
/** Kinds accepted by the generic, secret-free account-link enqueue path. */
export type AuthEmailAccountLinkKind = Extract<
  AuthEmailOutboxKind,
  'password_reset' | 'email_verification'
>;
export type AuthEmailOutboxTerminal = 'delivered' | 'suppressed' | 'dead';

export interface AuthEmailOutboxJob {
  jobId: string;
  kind: AuthEmailOutboxKind;
  recipient: string;
  nativeContinuation: string | null;
  invitationId: string | null;
  secretEnvelope: string | null;
  domainUserId: string | null;
  domainEmailGeneration: number | null;
  domainAuthGeneration: number | null;
  domainIdentityKind: 'session' | 'continuation' | null;
  domainIdentityContinuationId: string | null;
  attempts: number;
  leaseOwner: string;
}

export interface AuthEmailOutboxOptions {
  requestWindowMs: number;
  maxActiveJobs: number;
  maxStoredJobs: number;
  maxAttempts: number;
  concurrency: number;
  leaseMs: number;
  pollMs: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  terminalRetentionMs: number;
  deliveryTimeoutMs: number;
}

export const DEFAULT_AUTH_EMAIL_OUTBOX_OPTIONS: AuthEmailOutboxOptions = {
  requestWindowMs: 300_000,
  maxActiveJobs: 5_000,
  maxStoredJobs: 50_000,
  maxAttempts: 10,
  concurrency: 4,
  leaseMs: 60_000,
  pollMs: 1_000,
  baseBackoffMs: 1_000,
  maxBackoffMs: 300_000,
  terminalRetentionMs: 86_400_000,
  deliveryTimeoutMs: 20_000,
};

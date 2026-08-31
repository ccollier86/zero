export type AuthEmailOutboxKind = 'password_reset' | 'email_verification';
export type AuthEmailOutboxTerminal = 'delivered' | 'suppressed' | 'dead';

export interface AuthEmailOutboxJob {
  jobId: string;
  kind: AuthEmailOutboxKind;
  recipient: string;
  nativeContinuation: string | null;
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

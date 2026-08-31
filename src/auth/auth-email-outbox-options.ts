import {
  DEFAULT_AUTH_EMAIL_OUTBOX_OPTIONS,
  type AuthEmailOutboxOptions,
} from './auth-email-outbox-types';

export function resolveAuthEmailOutboxOptions(
  input: Partial<AuthEmailOutboxOptions>
): AuthEmailOutboxOptions {
  const options = { ...DEFAULT_AUTH_EMAIL_OUTBOX_OPTIONS, ...input };
  options.requestWindowMs = nonNegative(options.requestWindowMs);
  options.maxActiveJobs = integer(options.maxActiveJobs, 1, 100_000);
  options.maxStoredJobs = integer(options.maxStoredJobs,
    options.maxActiveJobs, 1_000_000);
  options.maxAttempts = integer(options.maxAttempts, 1, 20);
  options.concurrency = integer(options.concurrency, 1, 16);
  options.leaseMs = integer(options.leaseMs, 1_000, 3_600_000);
  options.pollMs = integer(options.pollMs, 10, 60_000);
  options.baseBackoffMs = integer(options.baseBackoffMs, 1, 3_600_000);
  options.maxBackoffMs = integer(options.maxBackoffMs,
    options.baseBackoffMs, 86_400_000);
  options.terminalRetentionMs = Math.max(
    integer(options.terminalRetentionMs, 1_000, 604_800_000),
    options.requestWindowMs
  );
  options.deliveryTimeoutMs = integer(options.deliveryTimeoutMs, 100, 300_000);
  return options;
}

function integer(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

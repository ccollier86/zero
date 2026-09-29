/** Bounded per-entry actor restart policy and cancellable delay primitive. */

import { DATABASE_OBSERVABILITY_COUNT_MAX } from './database-capacity';
import { DatabaseError } from './database-error';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';

export interface DatabaseCoordinatorRestartPolicy {
  /** Delay before the first replacement attempt. Default: 10ms. */
  readonly initialDelayMs?: number;
  /** Exponential-delay ceiling before the circuit opens. Default: 1000ms. */
  readonly maxDelayMs?: number;
  /** Consecutive attempts before entering cooldown. Default: 5. */
  readonly circuitFailureThreshold?: number;
  /** Delay between half-open attempts after the threshold. Default: 5000ms. */
  readonly circuitCooldownMs?: number;
}

export interface NormalizedDatabaseCoordinatorRestartPolicy {
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly circuitFailureThreshold: number;
  readonly circuitCooldownMs: number;
}

export interface DatabaseRestartPlan {
  readonly retryCount: number;
  readonly delayMs: number;
  readonly circuitOpen: boolean;
}

const DEFAULT_RESTART_POLICY = Object.freeze({
  initialDelayMs: 10,
  maxDelayMs: 1_000,
  circuitFailureThreshold: 5,
  circuitCooldownMs: 5_000,
} satisfies NormalizedDatabaseCoordinatorRestartPolicy);

const RESTART_POLICY_FIELDS = new Set([
  'initialDelayMs',
  'maxDelayMs',
  'circuitFailureThreshold',
  'circuitCooldownMs',
]);

export function normalizeDatabaseCoordinatorRestartPolicy(
  value: DatabaseCoordinatorRestartPolicy | undefined,
): NormalizedDatabaseCoordinatorRestartPolicy {
  if (value === undefined) return DEFAULT_RESTART_POLICY;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidRestartPolicy();
  }
  let record: Readonly<Record<string, unknown>>;
  try {
    record = value as Readonly<Record<string, unknown>>;
    if (Object.keys(record).some((key) => !RESTART_POLICY_FIELDS.has(key))) {
      throw invalidRestartPolicy();
    }
  } catch {
    throw invalidRestartPolicy();
  }

  let initialDelayMs: unknown;
  let maxDelayMs: unknown;
  let circuitFailureThreshold: unknown;
  let circuitCooldownMs: unknown;
  try {
    initialDelayMs = record.initialDelayMs ?? DEFAULT_RESTART_POLICY.initialDelayMs;
    maxDelayMs = record.maxDelayMs ?? DEFAULT_RESTART_POLICY.maxDelayMs;
    circuitFailureThreshold = record.circuitFailureThreshold
      ?? DEFAULT_RESTART_POLICY.circuitFailureThreshold;
    circuitCooldownMs = record.circuitCooldownMs
      ?? DEFAULT_RESTART_POLICY.circuitCooldownMs;
  } catch {
    throw invalidRestartPolicy();
  }

  if (!isTimerDelay(initialDelayMs)
    || !isTimerDelay(maxDelayMs)
    || (initialDelayMs as number) > (maxDelayMs as number)
    || !Number.isSafeInteger(circuitFailureThreshold)
    || (circuitFailureThreshold as number) < 2
    || (circuitFailureThreshold as number) > DATABASE_OBSERVABILITY_COUNT_MAX
    || !isTimerDelay(circuitCooldownMs)
    || (circuitCooldownMs as number) < (maxDelayMs as number)) {
    throw invalidRestartPolicy();
  }

  return Object.freeze({
    initialDelayMs: initialDelayMs as number,
    maxDelayMs: maxDelayMs as number,
    circuitFailureThreshold: circuitFailureThreshold as number,
    circuitCooldownMs: circuitCooldownMs as number,
  });
}

export function nextDatabaseRestartPlan(
  policy: NormalizedDatabaseCoordinatorRestartPolicy,
  previousRetryCount: number,
): DatabaseRestartPlan {
  const retryCount = Math.min(
    DATABASE_OBSERVABILITY_COUNT_MAX,
    Math.max(0, previousRetryCount) + 1,
  );
  const circuitOpen = retryCount >= policy.circuitFailureThreshold;
  if (circuitOpen) {
    return Object.freeze({
      retryCount,
      delayMs: policy.circuitCooldownMs,
      circuitOpen: true,
    });
  }
  const exponent = Math.min(30, retryCount - 1);
  return Object.freeze({
    retryCount,
    delayMs: Math.min(
      policy.maxDelayMs,
      policy.initialDelayMs * (2 ** exponent),
    ),
    circuitOpen: false,
  });
}

/** Resolves false when shutdown or entry closure cancels the pending attempt. */
export function waitForDatabaseRestart(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (allowed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(allowed);
    };
    const abort = () => finish(false);
    const timer = setTimeout(() => finish(true), delayMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) finish(false);
  });
}

function isTimerDelay(value: unknown): boolean {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) <= MAX_RUNTIME_TIMER_INTERVAL_MS;
}

function invalidRestartPolicy(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database restart policy is invalid.',
    { retryable: false, outcome: 'not-started' },
  );
}

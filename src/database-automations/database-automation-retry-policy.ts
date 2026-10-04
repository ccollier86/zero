/** Deterministic bounded retry timing for durable database functions. */

export const DATABASE_AUTOMATION_DEFAULT_RETRY_DELAY_MS = 1_000;
export const DATABASE_AUTOMATION_MAX_RETRY_DELAY_MS = 300_000;

/** Exponential delay capped before multiplication can exceed safe integers. */
export function databaseAutomationRetryAt(
  now: number,
  attemptCount: number,
): number {
  const exponent = Math.max(0, Math.min(18, attemptCount - 1));
  const delay = Math.min(
    DATABASE_AUTOMATION_MAX_RETRY_DELAY_MS,
    DATABASE_AUTOMATION_DEFAULT_RETRY_DELAY_MS * (2 ** exponent),
  );
  const retryAt = now + delay;
  return Number.isSafeInteger(retryAt) ? retryAt : Number.MAX_SAFE_INTEGER;
}

/**
 * Largest portable delay accepted by JavaScript's signed 32-bit timer APIs.
 * Larger values may overflow and run almost immediately instead of later.
 */
export const MAX_RUNTIME_TIMER_INTERVAL_MS = 2_147_483_647;

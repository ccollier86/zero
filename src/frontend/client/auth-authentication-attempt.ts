/** Internal lifecycle fence for one unauthenticated authentication exchange. */
export interface AuthAuthenticationAttempt {
  /** Aborted when the browser adopts another account or tenant scope. */
  readonly signal: AbortSignal;
  /** Throws before a stale response can publish or replace the live session. */
  assertCurrent(): void;
  /** Release lifecycle listeners after the exchange settles. */
  dispose(): void;
}

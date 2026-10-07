/** Restricted profile completion over the existing auth-attempt/session owner; no Bearer proof or persistence. */
import type { CompleteUserProfileInput, UserProfileCompletion } from '../../auth/auth-user-profile-completion-types';
import { runAuthenticationExchange, type AuthAuthenticationAttempt } from './auth-authentication-attempt';
import type { AuthCompletionResult } from './auth-types';
import { createAuthClientError, AuthClientError } from './auth-errors';
import { parseAuthCompletionResult } from './auth-completion-parser';
import { parseUserProfileCompletion } from './auth-user-profile-completion-parser';
import { composeAuthorizationScopeSignal } from './auth-response-scope';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';

export interface AuthUserProfileCompletionTransportOptions {
  baseUrl: string;
  beginAuthentication(markLoading: boolean): AuthAuthenticationAttempt;
  readContinuation(): AuthCompletionResult | null;
  completeAuthentication(result: AuthCompletionResult, attempt: AuthAuthenticationAttempt): Promise<AuthCompletionResult>;
  /** Internal deadline override for deterministic transport qualification. */
  requestTimeoutMs?: number;
}
/** Identity-only namespace. Its opaque continuation is sent only in private request bodies. */
export class AuthUserProfileCompletionTransport {
  private pending: { key: string; work: Promise<AuthCompletionResult> } | null = null;
  constructor(private readonly options: AuthUserProfileCompletionTransportOptions) {}
  /** Reload the current required fields/revision without establishing application access. */
  async inspect(continuation: string, signal?: AbortSignal): Promise<UserProfileCompletion> {
    const attempt = this.options.beginAuthentication(false), composed = composeAuthorizationScopeSignal(signal, attempt.signal);
    try {
      const assertCurrent = this.captureContinuation(continuation, attempt, composed.signal);
      const { response, body } = await this.request('/inspect', { continuation }, composed.signal); assertCurrent();
      if (!response.ok) throw createAuthClientError(response, body, 'Required profile information could not be loaded.');
      const result = parseUserProfileCompletion(body, this.options.readContinuation()?.user.userId);
      if (result.continuation !== continuation) throw invalidResponse();
      return result;
    } finally { composed.dispose(); attempt.dispose(); }
  }
  /** Accept required profile values and continue the real auth union; only a session installs app credentials. */
  complete(input: CompleteUserProfileInput, signal?: AbortSignal): Promise<AuthCompletionResult> {
    const key = JSON.stringify([input.continuation, input.expectedRevision, input.changes]);
    if (this.pending) return this.pending.key === key ? this.pending.work
      : Promise.reject(new AuthClientError('Profile completion is already in progress.', 409, 'AUTH_PROFILE_COMPLETION_IN_PROGRESS', null));
    const work = this.performComplete(input, signal); this.pending = { key, work };
    void work.finally(() => { if (this.pending?.work === work) this.pending = null; }).catch(() => {});
    return work;
  }
  private async performComplete(input: CompleteUserProfileInput, signal?: AbortSignal): Promise<AuthCompletionResult> {
    // This mutation has its own form pending state. Toggling the global auth
    // loading boundary would retire the anonymous draft/request it owns.
    const attempt = this.options.beginAuthentication(false);
    return runAuthenticationExchange(attempt, async (attempt) => {
      const composed = composeAuthorizationScopeSignal(signal, attempt.signal);
      try {
        const assertCurrent = this.captureContinuation(input.continuation, attempt, composed.signal);
        let result: AuthCompletionResult;
        try {
          const { response, body } = await this.request('', input, composed.signal); assertCurrent();
          if (!response.ok) throw createAuthClientError(response, body, 'Your profile could not be completed.');
          result = parseAuthCompletionResult(body);
          const userId = this.options.readContinuation()?.user.userId;
          if (userId !== undefined && result.user.userId !== userId) throw invalidResponse();
        } catch (cause) {
          // The ordinary auth.error event clears identity continuations. A
          // rejected profile CAS/validation request must keep this restricted
          // proof and draft available for explicit review/retry instead.
          assertCurrent(); throw cause;
        }
        assertCurrent(); return await this.options.completeAuthentication(result, { ...attempt, assertCurrent });
      } finally { composed.dispose(); }
    }, undefined, signal);
  }
  private captureContinuation(proof: string, attempt: AuthAuthenticationAttempt, signal: AbortSignal): () => void {
    if (typeof proof !== 'string' || proof.length < 40 || proof.length > 200 || !/^zct_[A-Za-z0-9_-]+$/.test(proof)) throw invalidResponse();
    const current = this.options.readContinuation(), initial = continuationKey(current);
    if (current && (!('profileCompletionRequired' in current) || !current.profileCompletionRequired
      || current.profileCompletion.continuation !== proof)) throw retired();
    const assertCurrent = () => { attempt.assertCurrent(); signal.throwIfAborted();
      if (continuationKey(this.options.readContinuation()) !== initial) throw retired(); };
    assertCurrent(); return assertCurrent;
  }
  private async request(suffix: string, input: unknown, scopeSignal: AbortSignal): Promise<{ response: Response; body: unknown }> {
    // Header and body stalls must release the form's pending state. A deadline
    // is not proof that the server did not commit: retain the restricted proof
    // and draft for explicit inspect/retry, never repeat or accept optimistically.
    const request = new AuthSessionRecoveryRequest(this.options.requestTimeoutMs ?? 30_000), cancel = () => request.cancel();
    if (scopeSignal.aborted) cancel(); else scopeSignal.addEventListener('abort', cancel, { once: true });
    try {
      return await request.run(async signal => {
        const response = await fetch(`${this.options.baseUrl}/auth/profile/completion${suffix}`, { method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), cache: 'no-store', signal });
        signal.throwIfAborted();
        const body: unknown = await response.json(); signal.throwIfAborted();
        return { response, body };
      });
    } finally { scopeSignal.removeEventListener('abort', cancel); }
  }
}
function continuationKey(result: AuthCompletionResult | null): string | null {
  if (!result) return null;
  if ('profileCompletionRequired' in result && result.profileCompletionRequired) return `profile:${JSON.stringify([
    result.user.userId, result.profileCompletion.continuation, result.profileCompletion.expiresAt, result.profileCompletion.state,
    result.profileCompletion.profile?.revision ?? null, result.profileCompletion.profile?.capabilities ?? null, result.profileCompletion.missingFields,
  ])}`;
  if ('tenantSelectionRequired' in result && result.tenantSelectionRequired) return `tenant:${result.tenantSelection.continuation}`;
  if ('tenantOnboardingRequired' in result && result.tenantOnboardingRequired) return `onboarding:${result.onboarding.continuation}`;
  if ('mfaSetupRequired' in result && result.mfaSetupRequired) return `mfa:${result.mfaSetupToken}`;
  if ('mfaChallengeRequired' in result && result.mfaChallengeRequired) return `mfa:${result.mfaChallenge.challengeToken}`;
  return `other:${result.user.userId}`;
}
function retired(): DOMException { return new DOMException('Profile completion was replaced. Start the current sign-in flow again.', 'AbortError'); }
function invalidResponse(): Error { return new Error('[client] Profile completion proof or response is invalid.'); }

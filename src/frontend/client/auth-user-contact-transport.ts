/** Own-contact routes over the existing authenticated SDK and scope-fenced email-link completion. */
import type { EmailContactVerificationResult, UserContactSnapshot, RequestUserContactVerificationInput, SetUserPhoneInput,
  ChangeUserEmailInput, CompleteUserPhoneVerificationInput, CancelUserContactVerificationInput } from '../../auth/auth-user-contact-types';
import { createAuthClientError } from './auth-errors';
import { isUserContactSnapshot } from './auth-user-contact-parser';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';

export interface AuthUserContactTransportOptions {
  baseUrl: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  assertResponseCurrent(response: Response): void;
  requestTimeoutMs?: number;
  /** The facade owns browser family retirement; this transport owns only HTTP and response admission. */
  runEmailCompletion(request: (signal: AbortSignal) => Promise<EmailContactVerificationResult>, signal?: AbortSignal): Promise<EmailContactVerificationResult>;
}
export class AuthUserContactTransport {
  constructor(private readonly options: AuthUserContactTransportOptions) {}
  get(signal?: AbortSignal): Promise<UserContactSnapshot> { return this.request('', { signal }); }
  setPhone(input: SetUserPhoneInput, signal?: AbortSignal) {
    return this.request('/phone', this.json('PATCH', input, signal));
  }
  requestEmailVerification(input: RequestUserContactVerificationInput, signal?: AbortSignal) {
    return this.request('/email/verify', this.json('POST', input, signal));
  }
  requestEmailChange(input: ChangeUserEmailInput, signal?: AbortSignal) {
    return this.request('/email/change', this.json('POST', input, signal));
  }
  requestPhoneVerification(input: RequestUserContactVerificationInput, signal?: AbortSignal) {
    return this.request('/phone/verify', this.json('POST', input, signal));
  }
  completePhone(input: CompleteUserPhoneVerificationInput, signal?: AbortSignal) {
    return this.request('/phone/complete', this.json('POST', input, signal));
  }
  cancelChallenge(input: CancelUserContactVerificationInput, signal?: AbortSignal) {
    return this.request('/challenge', this.json('DELETE', input, signal));
  }
  completeEmail(token: string, signal?: AbortSignal): Promise<EmailContactVerificationResult> {
    return this.options.runEmailCompletion(async scopeSignal => {
      const { response, body } = await this.read('/email/complete', this.json('POST', { token }, scopeSignal), true);
      if (!response.ok) throw createAuthClientError(response, body, 'Email verification could not be completed.');
      if (!body || typeof body !== 'object' || !('verified' in body) || body.verified !== true
        || !('requiresSignIn' in body) || typeof body.requiresSignIn !== 'boolean'
        || !('userId' in body) || typeof body.userId !== 'string' || !body.userId || body.userId.length > 512) {
        throw createAuthClientError(response, { code: 'AUTH_CONTACT_RESPONSE_INVALID' }, 'Contact response was invalid. Please retry.');
      }
      return { verified: true, userId: body.userId, requiresSignIn: body.requiresSignIn };
    }, signal);
  }
  private async request(path: string, init: RequestInit): Promise<UserContactSnapshot> {
    const { response, body } = await this.read(path, init);
    this.options.assertResponseCurrent(response);
    if (!response.ok) throw createAuthClientError(response, body, 'Contact settings could not be loaded or saved.');
    if (!isUserContactSnapshot(body)) throw createAuthClientError(response,
      { code: 'AUTH_CONTACT_RESPONSE_INVALID' }, 'Contact response was invalid. Please retry.');
    return body;
  }
  private async read(path: string, init: RequestInit, anonymous = false): Promise<{ response: Response; body: unknown }> {
    // Reuse Zero's bounded request primitive, including stalled JSON bodies.
    // Allow the server's bounded phone-verifier call to settle before the
    // default 30s transport limit. Neither timeouts nor cancellation imply a
    // write did not commit; callers retain drafts and explicitly review state.
    const bounded = new AuthSessionRecoveryRequest(this.options.requestTimeoutMs ?? 30_000);
    const cancel = () => bounded.cancel();
    if (init.signal?.aborted) cancel(); else init.signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await bounded.run(async signal => {
        const url = `${this.options.baseUrl}/auth/profile/contacts${path}`;
        const response = await (anonymous ? fetch(url, { ...init, signal })
          : this.options.authenticatedFetch(url, { ...init, cache: 'no-store', signal }));
        const body: unknown = await response.json().catch(() => null);
        return { response, body };
      });
    } finally { init.signal?.removeEventListener('abort', cancel); }
  }
  private json(method: string, body: unknown, signal?: AbortSignal): RequestInit {
    return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store', signal };
  }
}

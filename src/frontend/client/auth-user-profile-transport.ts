/** Own-profile HTTP transport. Authority and mutations remain Guardian-owned. */
import type { UpdateUserProfileInput, UserProfileSnapshot } from '../../auth/auth-user-profile-types';
import { createAuthClientError } from './auth-errors';
import { isUserProfileSnapshot } from './auth-user-profile-parser';
import { AuthSessionRecoveryRequest } from './auth-session-recovery-request';

export interface AuthUserProfileTransportOptions {
  baseUrl: string;
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
  assertResponseCurrent(response: Response): void;
  requestTimeoutMs?: number;
}
export class AuthUserProfileTransport {
  constructor(private readonly options: AuthUserProfileTransportOptions) {}
  get(signal?: AbortSignal): Promise<UserProfileSnapshot> {
    return this.request({ signal });
  }
  update(input: UpdateUserProfileInput, signal?: AbortSignal): Promise<UserProfileSnapshot> {
    return this.request({ method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input), signal });
  }
  private async request(init: RequestInit): Promise<UserProfileSnapshot> {
    // A timeout/cancellation is ambiguous about server commit. Do not reset
    // the accepted form baseline or silently retry a captured revision.
    const request = new AuthSessionRecoveryRequest(this.options.requestTimeoutMs ?? 30_000), cancel = () => request.cancel();
    if (init.signal?.aborted) cancel(); else init.signal?.addEventListener('abort', cancel, { once: true });
    try {
      return await request.run(async signal => {
        const response = await this.options.authenticatedFetch(`${this.options.baseUrl}/auth/profile`, { ...init, signal, cache: 'no-store' });
        signal.throwIfAborted();
        const body: unknown = await response.json().catch(() => null); signal.throwIfAborted();
        this.options.assertResponseCurrent(response);
        if (!response.ok) throw createAuthClientError(response, body, 'Profile could not be loaded or saved.');
        if (!isUserProfileSnapshot(body)) throw createAuthClientError(response,
          { code: 'AUTH_PROFILE_RESPONSE_INVALID', error: 'Profile response was invalid. Please retry.' },
          'Profile response was invalid. Please retry.');
        return body;
      });
    } finally { init.signal?.removeEventListener('abort', cancel); }
  }
}

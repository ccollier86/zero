/** Bounded, mount- and session-fenced recovery of a hydrated page session. */

import type { AuthSessionRecoveryResult } from './auth-types';

export type AuthorizationScopeRecoveryOperation = 'recover' | 'sign-out';

export interface AuthorizationScopeRecoveryClient {
  readonly authorizationScopeKey: string | null;
  readonly user: { readonly userId: string } | null;
  readonly hasRecoverableSession: boolean;
  recoverSession(): Promise<AuthSessionRecoveryResult>;
  logout(): Promise<void>;
}

export type AuthorizationScopeRecoveryOutcome =
  | { readonly kind: 'reload' }
  | { readonly kind: 'retired' }
  | { readonly kind: 'retryable'; readonly error: string };

export const AUTHORIZATION_SCOPE_RECOVERY_UNAVAILABLE =
  'Unable to refresh your session. Please retry, or sign out.';

interface RecoveryAttempt {
  readonly client: AuthorizationScopeRecoveryClient;
  readonly scopeKey: string | null;
  readonly generation: number;
  promise: Promise<AuthorizationScopeRecoveryOutcome>;
}

/**
 * The SDK fences credential writes. This controller independently fences the
 * page's callbacks and reload, including late completion after unmount. A
 * microtask before admission prevents a retired StrictMode effect from issuing
 * an operation or consuming its persisted attempt marker.
 */
export class AuthorizationScopeRecoveryController {
  private generation = 0;
  private active = false;
  private pending: RecoveryAttempt | null = null;

  activate(): void {
    this.active = true;
    this.generation += 1;
  }

  retire(): void {
    this.active = false;
    this.generation += 1;
    this.pending = null;
  }

  /** Keep the admitted operation owned through its intentional sign-out. */
  isPendingFor(client: AuthorizationScopeRecoveryClient): boolean {
    const attempt = this.pending;
    if (!this.active || !attempt || attempt.client !== client
      || attempt.generation !== this.generation) return false;
    return client.authorizationScopeKey === attempt.scopeKey
      || (client.authorizationScopeKey === null && client.user === null
        && !client.hasRecoverableSession);
  }

  run(input: {
    readonly client: AuthorizationScopeRecoveryClient;
    readonly scopeKey: string | null;
    readonly operation: AuthorizationScopeRecoveryOperation;
    readonly onStart: () => void;
    readonly onReload: () => void;
    readonly onRetryable: (error: string, cause?: unknown) => void;
  }): Promise<AuthorizationScopeRecoveryOutcome> {
    if (this.pending?.scopeKey === input.scopeKey
      && this.pending.client === input.client
      && this.pending.generation === this.generation) {
      return this.pending.promise;
    }
    const attempt: RecoveryAttempt = {
      client: input.client,
      scopeKey: input.scopeKey,
      generation: this.generation,
      promise: Promise.resolve({ kind: 'retired' }),
    };
    this.pending = attempt;
    const owned = () => this.active && this.generation === attempt.generation
      && this.pending === attempt;
    const current = () => owned()
      && input.client.authorizationScopeKey === input.scopeKey;
    attempt.promise = Promise.resolve().then(async () => {
      if (!current()) return { kind: 'retired' } as const;
      input.onStart();
      try {
        const result = input.operation === 'sign-out'
          ? await input.client.logout().then(() => ({ kind: 'signed-out' } as const))
          : await input.client.recoverSession();
        if (!owned()) return { kind: 'retired' } as const;
        // A successful sign-out intentionally retires the starting family.
        // An unrelated replacement must never be cleared or reloaded by it.
        const isSignedOut = () => input.client.authorizationScopeKey === null
          && input.client.user === null
          && !input.client.hasRecoverableSession;
        let signedOut = result.kind === 'signed-out'
          && isSignedOut();
        if (!current() && !signedOut) return { kind: 'retired' } as const;
        if (result.kind === 'retryable') {
          input.onRetryable(result.error);
          return result;
        }
        if (result.kind === 'signed-out' && !signedOut) {
          return { kind: 'retired' } as const;
        }
        if (signedOut && input.operation === 'recover') {
          // Rejection by /auth/me can retire browser proof without clearing
          // the HttpOnly page cookie. Clear it through the ordinary scoped
          // logout route, only while the SDK-confirmed anonymous outcome is
          // still current. Logout itself fences a concurrent new family.
          await input.client.logout();
          if (!owned() || !isSignedOut()) return { kind: 'retired' } as const;
          signedOut = true;
        }
        // This callback runs within the final synchronous fence, not after a
        // returned promise's continuation where another session may win.
        input.onReload();
        return { kind: 'reload' } as const;
      } catch (cause) {
        if (!current()) return { kind: 'retired' } as const;
        input.onRetryable(AUTHORIZATION_SCOPE_RECOVERY_UNAVAILABLE, cause);
        return { kind: 'retryable', error: AUTHORIZATION_SCOPE_RECOVERY_UNAVAILABLE } as const;
      }
    }).finally(() => {
      if (this.pending === attempt) this.pending = null;
    });
    return attempt.promise;
  }
}

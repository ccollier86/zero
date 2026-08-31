/** OIDC callback continuation and authorization-code exchange. */
import type { NativeAuthorizationContext } from './authorization-context';
import { createOperationSignal, raceWithSignal } from './abort';
import {
  nativeCallbackKey,
  requirePendingAuthorization,
  shouldDiscardPendingAuthorization,
} from './authorization-callback-state';
import { validateAuthorizationCallback } from './callback';
import { revokeNativeRefreshTokenBestEffort } from './best-effort-revocation';
import { NativeAuthError } from './errors';
import { exchangeAuthorizationCode } from './token-endpoint';
export class NativeAuthorizationCompletion {
  private completing: { key: string; promise: Promise<void> } | null = null;
  private completed = false;
  constructor(private readonly input: NativeAuthorizationContext) {}
  run(callbackUrl: string, signal?: AbortSignal, generation?: number): Promise<void> {
    if (this.completed) return Promise.resolve();
    const key = nativeCallbackKey(callbackUrl);
    const active = this.completing;
    if (active) {
      return active.key === key
        ? active.promise
        : active.promise.then(
          () => this.run(callbackUrl, signal, generation),
          () => this.run(callbackUrl, signal, generation),
        );
    }
    const promise = this.finish(
      callbackUrl, signal, generation ?? this.input.lifecycle.capture(),
    )
      .then(() => { this.completed = true; })
      .finally(() => {
        if (this.completing?.promise === promise) this.completing = null;
      });
    this.completing = { key, promise };
    return promise;
  }
  isCompleted(): boolean {
    return this.completed;
  }
  resetCompleted(): void {
    this.completed = false;
  }
  private async finish(
    callbackUrl: string,
    signal: AbortSignal | undefined,
    generation: number,
  ): Promise<void> {
    const pending = await requirePendingAuthorization(this.input);
    this.input.lifecycle.assertCurrent(generation);
    let issuedRefreshToken: string | null = null;
    try {
      const { code } = validateAuthorizationCallback(callbackUrl, pending);
      const bounded = createOperationSignal(
        signal, this.input.config.networkTimeoutMs, 'OIDC code exchange timed out.',
      );
      let tokens;
      let identity;
      try {
        tokens = await raceWithSignal(exchangeAuthorizationCode({
          metadata: this.input.metadata,
          clientId: this.input.config.clientId,
          fetch: this.input.config.fetch,
        }, {
          code, redirectUri: pending.redirectUri,
          codeVerifier: pending.codeVerifier, signal: bounded.signal,
        }), bounded.signal);
        issuedRefreshToken = tokens.refreshToken;
        if (!tokens.idToken) {
          throw new NativeAuthError(
            'Authorization response omitted an ID token.', 'OIDC_TOKEN_RESPONSE_INVALID',
          );
        }
        identity = await raceWithSignal(this.input.validator.validate({
          token: tokens.idToken,
          accessToken: tokens.accessToken,
          expectedNonce: pending.nonce,
        }), bounded.signal);
      } finally {
        bounded.dispose();
      }
      await this.input.sessions.establishAuthorization(tokens, identity, generation);
      await this.input.vault.clearPending().catch(() => undefined);
    } catch (error) {
      if (issuedRefreshToken) this.revokeUncommitted(issuedRefreshToken);
      if (shouldDiscardPendingAuthorization(error)) {
        await this.input.vault.clearPending().catch(() => undefined);
      }
      throw error;
    }
  }
  private revokeUncommitted(refreshToken: string): void {
    revokeNativeRefreshTokenBestEffort({
      metadata: this.input.metadata, clientId: this.input.config.clientId,
      fetch: this.input.config.fetch,
      networkTimeoutMs: this.input.config.networkTimeoutMs,
    }, refreshToken);
  }
}

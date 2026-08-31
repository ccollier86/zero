/** One cancellable system-browser authorization attempt. */

import { createAuthorizationSignal, raceWithSignal, throwIfAborted } from './abort';
import { cleanupNativeAuthorization } from './authorization-cleanup';
import type { NativeAuthorizationCompletion } from './authorization-completion';
import type { NativeAuthorizationContext } from './authorization-context';
import { createPendingAuthorization } from './authorization-pending';
import { createAuthorizationUrl } from './authorization-url';
import type { NativeSignInOptions, NativeSignUpOptions } from './client-types';
import { supersededOperation } from './lifecycle';
import { createAuthorizationProof } from './pkce';
import { assertNativeRedirectUri } from './redirect-uri';

export class NativeAuthorizationRun {
  private readonly bounded;

  constructor(
    private readonly input: NativeAuthorizationContext,
    private readonly completion: NativeAuthorizationCompletion,
    private readonly generation: number,
    private readonly action: 'signIn' | 'signUp',
    private readonly options: NativeSignInOptions | NativeSignUpOptions,
  ) {
    this.bounded = createAuthorizationSignal(
      options.signal, input.config.authorizationTimeoutMs,
    );
  }

  cancel(): void {
    this.bounded.abort(supersededOperation());
  }

  async execute(): Promise<void> {
    let callback;
    let pendingAttempted = false;
    let completionStarted = false;
    try {
      throwIfAborted(this.bounded.signal);
      callback = await raceWithSignal(this.input.config.callbacks.prepare({
        redirectUri: this.input.config.redirectUri,
        signal: this.bounded.signal,
      }), this.bounded.signal);
      assertNativeRedirectUri(callback.redirectUri);
      const proof = await raceWithSignal(
        createAuthorizationProof(this.input.config.crypto), this.bounded.signal,
      );
      const pending = createPendingAuthorization(
        this.input.config, callback.redirectUri, proof,
      );
      pendingAttempted = true;
      await this.input.vault.savePending(pending);
      throwIfAborted(this.bounded.signal);
      const url = createAuthorizationUrl({
        metadata: this.input.metadata, clientId: this.input.config.clientId,
        scopes: this.input.config.scopes, pending, codeChallenge: proof.codeChallenge,
        action: this.action, options: this.options,
      });
      await raceWithSignal(
        this.input.config.browser.open(url, { signal: this.bounded.signal }),
        this.bounded.signal,
      );
      throwIfAborted(this.bounded.signal);
      const callbackUrl = await raceWithSignal(
        callback.waitForCallback(this.bounded.signal), this.bounded.signal,
      );
      completionStarted = true;
      await this.completion.run(callbackUrl, this.bounded.signal, this.generation);
    } catch (error) {
      if (pendingAttempted && !completionStarted) {
        await this.input.vault.clearPending().catch(() => undefined);
      }
      throw error;
    } finally {
      this.bounded.dispose();
      await cleanupNativeAuthorization(
        callback, this.input.config.browser, this.input.config.networkTimeoutMs,
      );
    }
  }
}

/** One rotating refresh operation with lifecycle-aware failure handling. */

import { NativeAuthError, toNativeAuthError } from './errors';
import { createOperationSignal, raceWithSignal } from './abort';
import { isSupersededOperation } from './lifecycle';
import { revokeNativeRefreshTokenBestEffort } from './best-effort-revocation';
import type { NativeStoredSession, NativeTokenSet } from './oidc-types';
import { shouldDiscardRefreshSession } from './refresh-failure';
import type { NativeSessionContext } from './session-context';
import { refreshNativeTokens } from './token-endpoint';

interface NativeSessionRefreshInput {
  context: NativeSessionContext;
  previous: NativeStoredSession;
  generation: number;
  establish: (tokens: NativeTokenSet, identity: NativeStoredSession['identity']) => Promise<void>;
  discard: () => Promise<void>;
}

export async function performNativeSessionRefresh(
  input: NativeSessionRefreshInput,
): Promise<string> {
  let accepted = false;
  let tokens: NativeTokenSet | null = null;
  try {
    const bounded = createOperationSignal(
      undefined, input.context.networkTimeoutMs, 'OIDC refresh timed out.',
    );
    let identity: NativeStoredSession['identity'];
    try {
      tokens = await raceWithSignal(
        refreshNativeTokens(input.context, input.previous.refreshToken, bounded.signal),
        bounded.signal,
      );
      accepted = true;
      if (!tokens.idToken) {
        throw new NativeAuthError(
          'Refresh response omitted an ID token.', 'OIDC_TOKEN_RESPONSE_INVALID',
        );
      }
      identity = await raceWithSignal(input.context.validator.validate({
        token: tokens.idToken,
        accessToken: tokens.accessToken,
        expectedSubject: input.previous.subject,
      }), bounded.signal);
    } finally {
      bounded.dispose();
    }
    await input.establish(tokens, identity);
    return tokens.accessToken;
  } catch (error) {
    if (accepted && tokens?.refreshToken) revokeUncommitted(input.context, tokens.refreshToken);
    if (isSupersededOperation(error)) {
      throw error;
    }
    const authError = toNativeAuthError(error, 'OIDC_REFRESH_FAILED');
    if (input.context.lifecycle.isCurrent(input.generation)) {
      if (shouldDiscardRefreshSession(authError, accepted)) await input.discard();
      input.context.state.setError(authError);
    }
    throw authError;
  }
}

function revokeUncommitted(context: NativeSessionContext, refreshToken: string): void {
  revokeNativeRefreshTokenBestEffort({
    metadata: context.metadata,
    clientId: context.clientId,
    fetch: context.fetch,
    networkTimeoutMs: context.networkTimeoutMs,
  }, refreshToken);
}

/** Ordered native-session persistence shared by authorization and refresh. */

import type { NativeStoredSession, NativeTokenSet } from './oidc-types';
import { revokeNativeRefreshTokenBestEffort } from './best-effort-revocation';
import type { NativeSessionContext } from './session-context';

interface NativeSessionCommitInput {
  context: NativeSessionContext;
  current: () => NativeStoredSession | null;
  replaceCurrent: (session: NativeStoredSession | null) => void;
}

export async function commitNativeSession(
  input: NativeSessionCommitInput,
  tokens: NativeTokenSet,
  identity: NativeStoredSession['identity'],
  generation: number,
  replaceAuthorization = false,
): Promise<void> {
  const stored = storedSession(input.context, tokens, identity);
  const previous = await input.context.lifecycle.commit(async () => {
    input.context.lifecycle.assertCurrent(generation);
    const previous = input.current() ?? await input.context.vault.loadSession();
    input.context.lifecycle.assertCurrent(generation);
    try {
      await input.context.vault.saveSession(stored);
    } catch (error) {
      await clearPartiallyWrittenSession(input.context, stored);
      throw error;
    }
    input.context.lifecycle.assertCurrent(generation);
    const commitGeneration = replaceAuthorization
      ? input.context.lifecycle.supersede()
      : generation;
    input.context.lifecycle.assertCurrent(commitGeneration);
    input.replaceCurrent(stored);
    input.context.state.setAuthenticated(tokens, identity);
    return previous;
  });
  if (replaceAuthorization && previous && previous.refreshToken !== stored.refreshToken) {
    revokeReplaced(input.context, previous.refreshToken);
  }
}

export async function discardNativeSession(
  input: NativeSessionCommitInput,
  previous: NativeStoredSession,
  generation: number,
): Promise<void> {
  await input.context.lifecycle.commit(async () => {
    if (!input.context.lifecycle.isCurrent(generation)) return;
    if (input.current()?.refreshToken === previous.refreshToken) input.replaceCurrent(null);
    const persisted = await input.context.vault.loadSession().catch(() => null);
    if (persisted?.refreshToken === previous.refreshToken) {
      await input.context.vault.clearSession();
    }
  });
}

function storedSession(
  context: NativeSessionContext,
  tokens: NativeTokenSet,
  identity: NativeStoredSession['identity'],
): NativeStoredSession {
  return {
    issuer: context.issuer, clientId: context.clientId, subject: identity.sub,
    refreshToken: tokens.refreshToken, identity,
  };
}

function revokeReplaced(context: NativeSessionContext, refreshToken: string): void {
  revokeNativeRefreshTokenBestEffort({
    metadata: context.metadata, clientId: context.clientId, fetch: context.fetch,
    networkTimeoutMs: context.networkTimeoutMs,
  }, refreshToken);
}

async function clearPartiallyWrittenSession(
  context: NativeSessionContext,
  attempted: NativeStoredSession,
): Promise<void> {
  const persisted = await context.vault.loadSession().catch(() => null);
  if (persisted?.refreshToken === attempted.refreshToken) {
    await context.vault.clearSession().catch(() => undefined);
  }
}

/** Authorization-code verification and atomic native session creation. */

import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import { verifyPkceS256 } from '../native';
import type { NativeCodeExchangeInput, NativeTokenResult } from './native-auth-service-types';
import type { NativeServiceContext } from './native-service-context';
import { prepareNativeSession } from './native-session-factory';
import { canReceiveTokens, invalidGrant, tokenClient } from './native-service-policy';

export async function exchangeNativeCode(
  context: NativeServiceContext,
  input: NativeCodeExchangeInput
): Promise<NativeTokenResult> {
  const code = context.codes.get(input.code);
  if (!code || code.consumedAt !== null || code.expiresAt <= Date.now()) invalidGrant();
  if (code.clientId !== input.clientId || code.redirectUri !== input.redirectUri) invalidGrant();
  if (!await verifyPkceS256(input.codeVerifier, code.codeChallenge)) invalidGrant();
  tokenClient(context, input.clientId);

  const user = context.users.getUserById(code.userId);
  if (!user || !canReceiveTokens(user)) invalidGrant();
  if (context.users.getAuthGeneration(user.userId) !== code.authGeneration) invalidGrant();
  const prepared = prepareNativeSession({
    userId: user.userId, clientId: code.clientId, scope: code.scope,
    authGeneration: code.authGeneration, ttlMs: context.config.refreshTtlMs,
  });
  const [accessToken, idToken] = await Promise.all([
    context.tokens.signNativeAccessToken(
      user, code.clientId, code.scope, code.authGeneration, prepared.session.familyId,
    ),
    context.tokens.signNativeIdToken(user, code.clientId, code.nonce, code.scope),
  ]);
  if (context.users.getAuthGeneration(user.userId) !== code.authGeneration) invalidGrant();
  const committed = context.sessions.consumeCodeAndInsert(
    () => context.codes.consume(code.codeId), prepared.session
  );
  if (!committed) invalidGrant();
  emitPlatformCode(OBS_CODES.AUTH_NATIVE_CODE_EXCHANGED, {
    userId: user.userId,
    metadata: { clientId: code.clientId, familyId: prepared.session.familyId },
  });
  return tokenResult(context, accessToken, prepared.rawRefreshToken, code.scope, idToken);
}

export function tokenResult(
  context: NativeServiceContext,
  accessToken: string,
  refreshToken: string,
  scope: string,
  idToken?: string
): NativeTokenResult {
  return {
    access_token: accessToken, token_type: 'Bearer',
    expires_in: context.tokens.getAccessTokenTTLSeconds(),
    refresh_token: refreshToken, id_token: idToken, scope,
  };
}

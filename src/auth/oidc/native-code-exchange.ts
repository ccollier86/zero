/** Authorization-code verification and atomic native session creation. */

import { OBS_CODES } from '../../observability/codes';
import { verifyPkceS256 } from '../native';
import type { NativeCodeExchangeInput, NativeTokenResult } from './native-auth-service-types';
import type { NativeServiceContext } from './native-service-context';
import { prepareNativeSession } from './native-session-factory';
import { canReceiveTokens, invalidGrant, tokenClient } from './native-service-policy';
import { sameNativeAuthority } from './native-tenant-authority';
import { assertNativeProfileCompletion, nativeProfileCompletionError } from './native-profile-completion-admission';

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
  assertNativeProfileCompletion(context.tokens, user.userId);
  if (context.users.getAuthGeneration(user.userId) !== code.authGeneration) invalidGrant();
  if (context.requiresMfaAssurance(user.userId) && code.mfaVerifiedAt === null) {
    invalidGrant();
  }
  const authority = context.authority.resolve(user.userId, code);
  if (!authority) invalidGrant();
  const prepared = prepareNativeSession({
    userId: user.userId, clientId: code.clientId, scope: code.scope,
    authGeneration: code.authGeneration, ttlMs: context.config.refreshTtlMs,
    mfaVerifiedAt: code.mfaVerifiedAt,
    authority: authority.snapshot,
  });
  const [accessToken, idToken] = await Promise.all([
    context.tokens.signNativeAccessToken(
      user, code.clientId, code.scope, code.authGeneration, prepared.session.familyId,
    ),
    context.tokens.signNativeIdToken(user, code.clientId, code.nonce, code.scope),
  ]).catch(error => { throw nativeProfileCompletionError(error); });
  if (context.users.getAuthGeneration(user.userId) !== code.authGeneration) invalidGrant();
  const stillCurrent = context.authority.resolve(user.userId, code);
  if (!stillCurrent
    || !sameNativeAuthority(authority.snapshot, stillCurrent.snapshot)) invalidGrant();
  const committed = context.sessions.consumeCodeAndInsert(
    () => context.codes.consume(code.codeId),
    prepared.session,
    () => {
      assertNativeProfileCompletion(context.tokens, user.userId);
      const live = context.authority.resolve(user.userId, code);
      return context.users.getAuthGeneration(user.userId) === code.authGeneration
        && (!context.requiresMfaAssurance(user.userId)
          || code.mfaVerifiedAt !== null)
        && Boolean(live && sameNativeAuthority(authority.snapshot, live.snapshot));
    },
  );
  if (!committed) invalidGrant();
  context.emitCode(OBS_CODES.AUTH_NATIVE_CODE_EXCHANGED, {
    userId: user.userId,
    metadata: { clientId: code.clientId, familyId: prepared.session.familyId },
  });
  return tokenResult(
    context,
    accessToken,
    prepared.rawRefreshToken,
    code.scope,
    idToken,
    authority.activeTenant ?? undefined,
  );
}

export function tokenResult(
  context: NativeServiceContext,
  accessToken: string,
  refreshToken: string,
  scope: string,
  idToken?: string,
  activeTenant?: import('./native-tenant-authority').NativeActiveTenant,
): NativeTokenResult {
  return {
    access_token: accessToken, token_type: 'Bearer',
    expires_in: context.tokens.getAccessTokenTTLSeconds(),
    refresh_token: refreshToken, id_token: idToken, scope,
    ...(activeTenant ? { active_tenant: activeTenant } : {}),
  };
}

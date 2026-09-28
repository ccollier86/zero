/** Native refresh-family rotation, replay handling, and revocation. */

import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import type { NativeRefreshInput, NativeTokenResult } from './native-auth-service-types';
import { tokenResult } from './native-code-exchange';
import type { NativeServiceContext } from './native-service-context';
import type { AuthAuditRequestContext } from '../auth-audit-types';
import { prepareNativeSession } from './native-session-factory';
import { canReceiveTokens, invalidGrant, tokenClient } from './native-service-policy';
import { NativeTokenError } from './native-token-error';
import { sameNativeAuthority } from './native-tenant-authority';

export async function rotateNativeRefresh(
  context: NativeServiceContext,
  input: NativeRefreshInput
): Promise<NativeTokenResult> {
  const current = context.sessions.get(input.refreshToken);
  if (!current || current.clientId !== input.clientId) invalidGrant();
  if (current.consumedAt !== null || current.revokedAt !== null) {
    context.sessions.revokeFamily(current.familyId);
    emitPlatformCode(OBS_CODES.AUTH_NATIVE_REFRESH_REUSE, {
      userId: current.userId,
      metadata: { clientId: current.clientId, familyId: current.familyId },
    });
    invalidGrant();
  }
  if (current.expiresAt <= Date.now()) terminalInvalidGrant(context, current.familyId);
  try {
    tokenClient(context, input.clientId);
  } catch {
    terminalInvalidGrant(context, current.familyId);
  }
  const user = context.users.getUserById(current.userId);
  if (!user || !canReceiveTokens(user)) terminalInvalidGrant(context, current.familyId);
  if (context.users.getAuthGeneration(user.userId) !== current.authGeneration) {
    terminalInvalidGrant(context, current.familyId);
  }
  const authority = context.authority.resolve(user.userId, current);
  if (!authority) terminalInvalidGrant(context, current.familyId);
  const readiness = context.sessions.rotationReadiness(current);
  if (readiness === 'throttled') {
    throw new NativeTokenError(
      'temporarily_unavailable', 'Refresh was requested too soon. Retry shortly.',
    );
  }
  if (readiness === 'exhausted') {
    context.sessions.revokeFamily(current.familyId);
    invalidGrant();
  }
  const prepared = prepareNativeSession({
    userId: current.userId, clientId: current.clientId, scope: current.scope,
    authGeneration: current.authGeneration, ttlMs: context.config.refreshTtlMs,
    familyId: current.familyId, expiresAt: current.expiresAt,
    rotationCount: current.rotationCount + 1,
    authority: authority.snapshot,
  });
  const [accessToken, idToken] = await Promise.all([
    context.tokens.signNativeAccessToken(
      user, current.clientId, current.scope, current.authGeneration, current.familyId,
    ),
    context.tokens.signNativeIdToken(user, current.clientId, undefined, current.scope),
  ]);
  if (context.users.getAuthGeneration(user.userId) !== current.authGeneration) {
    terminalInvalidGrant(context, current.familyId);
  }
  const stillCurrent = context.authority.resolve(user.userId, current);
  if (!stillCurrent
    || !sameNativeAuthority(authority.snapshot, stillCurrent.snapshot)) {
    terminalInvalidGrant(context, current.familyId);
  }
  const rotated = context.sessions.rotate(current, prepared.session, () => {
    const live = context.authority.resolve(user.userId, current);
    return context.users.getAuthGeneration(user.userId) === current.authGeneration
      && Boolean(live && sameNativeAuthority(authority.snapshot, live.snapshot));
  });
  if (rotated === 'throttled') {
    throw new NativeTokenError(
      'temporarily_unavailable', 'Refresh was requested too soon. Retry shortly.',
    );
  }
  if (rotated !== 'rotated') invalidGrant();
  emitPlatformCode(OBS_CODES.AUTH_NATIVE_REFRESH_ROTATED, {
    userId: current.userId,
    metadata: { clientId: current.clientId, familyId: current.familyId },
  });
  return tokenResult(
    context,
    accessToken,
    prepared.rawRefreshToken,
    current.scope,
    idToken,
    authority.activeTenant ?? undefined,
  );
}

function terminalInvalidGrant(context: NativeServiceContext, familyId: string): never {
  context.sessions.revokeFamily(familyId);
  invalidGrant();
}

export function revokeNativeSession(
  context: NativeServiceContext,
  rawToken: string,
  clientId: string,
  auditRequest?: AuthAuditRequestContext,
): void {
  const session = context.sessions.get(rawToken);
  if (session?.clientId !== clientId) return;
  context.sessions.revokeFamily(session.familyId, (deleted) => {
    context.audit?.append({
      action: 'session.revoked',
      outcome: 'succeeded',
      reason: 'client-revoked',
      scope: session.tenantId
        ? { kind: 'tenant', tenantId: session.tenantId }
        : { kind: 'application' },
      actor: {
        userId: session.userId,
        membershipId: session.membershipId ?? undefined,
        sessionId: session.familyId,
        sessionKind: 'native',
        clientId: session.clientId,
        provenance: 'authenticated-request',
      },
      request: auditRequest,
      target: { type: 'native-session-family', id: session.familyId },
      metadata: { count: deleted },
    });
  });
  emitPlatformCode(OBS_CODES.AUTH_NATIVE_SESSION_REVOKED, {
    userId: session.userId,
    metadata: { clientId, familyId: session.familyId },
  });
}

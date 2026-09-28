/** Refresh-proof tenant discovery and atomic native-family switching. */

import { OBS_CODES } from '../../observability/codes';
import { emitPlatformCode } from '../../observability/sink';
import type {
  NativeTenantListInput,
  NativeTenantListResult,
  NativeTenantSwitchInput,
  NativeTokenResult,
} from './native-auth-service-types';
import type { NativeSessionRecord } from './native-auth-records';
import { tokenResult } from './native-code-exchange';
import type { NativeServiceContext } from './native-service-context';
import { prepareNativeSession } from './native-session-factory';
import { canReceiveTokens, invalidGrant, tokenClient } from './native-service-policy';
import {
  sameNativeAuthority,
  type ResolvedNativeAuthority,
} from './native-tenant-authority';

export function listNativeTenants(
  context: NativeServiceContext,
  input: NativeTenantListInput,
): NativeTenantListResult {
  const proof = resolveNativeRefreshProof(context, input);
  return {
    activeTenantId: proof.authority.activeTenant?.tenantId ?? null,
    tenants: context.authority.list(proof.session.userId),
  };
}

export async function switchNativeTenant(
  context: NativeServiceContext,
  input: NativeTenantSwitchInput,
): Promise<NativeTokenResult> {
  const proof = resolveNativeRefreshProof(context, input);
  const target = context.authority.resolveTenant(proof.session.userId, input.tenantId);
  if (!target || !target.activeTenant) invalidGrant();

  const replacement = prepareNativeSession({
    userId: proof.session.userId,
    clientId: proof.session.clientId,
    scope: proof.session.scope,
    authGeneration: proof.session.authGeneration,
    ttlMs: context.config.refreshTtlMs,
    expiresAt: proof.session.expiresAt,
    authority: target.snapshot,
  });
  const [accessToken, idToken] = await Promise.all([
    context.tokens.signNativeAccessToken(
      proof.user,
      proof.session.clientId,
      proof.session.scope,
      proof.session.authGeneration,
      replacement.session.familyId,
    ),
    context.tokens.signNativeIdToken(
      proof.user,
      proof.session.clientId,
      undefined,
      proof.session.scope,
    ),
  ]);
  const switched = context.sessions.switchFamily(
    proof.session,
    replacement.session,
    () => {
      if (context.users.getAuthGeneration(proof.user.userId)
        !== proof.session.authGeneration) return false;
      const source = context.authority.resolve(proof.user.userId, proof.session);
      const liveTarget = context.authority.resolveTenant(proof.user.userId, input.tenantId);
      return Boolean(
        source
        && liveTarget
        && sameNativeAuthority(proof.authority.snapshot, source.snapshot)
        && sameNativeAuthority(target.snapshot, liveTarget.snapshot),
      );
    },
    () => {
      context.audit?.append({
        action: 'session.tenant-switched',
        outcome: 'succeeded',
        scope: { kind: 'tenant', tenantId: target.activeTenant!.tenantId },
        actor: {
          userId: proof.user.userId,
          membershipId: proof.session.membershipId ?? undefined,
          sessionId: proof.session.familyId,
          sessionKind: 'native',
          clientId: proof.session.clientId,
          provenance: 'authenticated-request',
        },
        request: input.auditRequest,
        target: { type: 'native-session-family', id: replacement.session.familyId },
        metadata: { 'previous-scope': proof.session.scopeId ?? 'application' },
      });
    },
  );
  if (!switched) invalidGrant();
  emitPlatformCode(OBS_CODES.AUTH_NATIVE_TENANT_SWITCHED, {
    userId: proof.user.userId,
    metadata: {
      clientId: proof.session.clientId,
      previousFamilyId: proof.session.familyId,
      familyId: replacement.session.familyId,
      tenantId: target.activeTenant.tenantId,
    },
  });
  return tokenResult(
    context,
    accessToken,
    replacement.rawRefreshToken,
    proof.session.scope,
    idToken,
    target.activeTenant,
  );
}

function resolveNativeRefreshProof(
  context: NativeServiceContext,
  input: NativeTenantListInput,
): {
  session: NativeSessionRecord;
  user: NonNullable<ReturnType<NativeServiceContext['users']['getUserById']>>;
  authority: ResolvedNativeAuthority;
} {
  tokenClient(context, input.clientId);
  const session = context.sessions.get(input.refreshToken);
  if (!session || session.clientId !== input.clientId) invalidGrant();
  if (session.consumedAt !== null || session.revokedAt !== null) {
    context.sessions.revokeFamily(session.familyId);
    invalidGrant();
  }
  if (session.expiresAt <= Date.now()) {
    context.sessions.revokeFamily(session.familyId);
    invalidGrant();
  }
  const user = context.users.getUserById(session.userId);
  if (!user || !canReceiveTokens(user)
    || context.users.getAuthGeneration(session.userId) !== session.authGeneration) {
    context.sessions.revokeFamily(session.familyId);
    invalidGrant();
  }
  const active = context.sessions.resolveActiveFamily({
    familyId: session.familyId,
    userId: session.userId,
    clientId: session.clientId,
    authGeneration: session.authGeneration,
  });
  const authority = context.authority.resolve(session.userId, session);
  if (!active || active.tokenId !== session.tokenId || !authority) {
    context.sessions.revokeFamily(session.familyId);
    invalidGrant();
  }
  return { session, user, authority };
}

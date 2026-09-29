/** Creates opaque, hash-at-rest native refresh sessions. */

import { createOpaqueToken, hashToken } from '../../tokens/token-utils';
import type { PreparedNativeSession } from './native-auth-records';
import type { NativeAuthoritySnapshot } from './native-tenant-authority';
import { normalizeMfaVerifiedAt } from '../mfa-assurance';

export function prepareNativeSession(input: {
  userId: string;
  clientId: string;
  scope: string;
  authGeneration: number;
  mfaVerifiedAt?: number | null;
  ttlMs: number;
  expiresAt?: number;
  familyId?: string;
  rotationCount?: number;
  authority?: NativeAuthoritySnapshot;
}): { rawRefreshToken: string; session: PreparedNativeSession } {
  const rawRefreshToken = createOpaqueToken();
  const now = Date.now();
  const tokenId = crypto.randomUUID();
  return {
    rawRefreshToken,
    session: {
      tokenId,
      familyId: input.familyId ?? crypto.randomUUID(),
      userId: input.userId,
      clientId: input.clientId,
      tokenHash: hashToken(rawRefreshToken),
      scope: input.scope,
      authGeneration: input.authGeneration,
      mfaVerifiedAt: normalizeMfaVerifiedAt(input.mfaVerifiedAt, now),
      scopeKind: (input.authority ?? APPLICATION_AUTHORITY).scopeKind,
      scopeId: (input.authority ?? APPLICATION_AUTHORITY).scopeId,
      tenantId: (input.authority ?? APPLICATION_AUTHORITY).tenantId,
      membershipId: (input.authority ?? APPLICATION_AUTHORITY).membershipId,
      tenantAuthorizationGeneration:
        (input.authority ?? APPLICATION_AUTHORITY).tenantAuthorizationGeneration,
      membershipAuthorizationGeneration:
        (input.authority ?? APPLICATION_AUTHORITY).membershipAuthorizationGeneration,
      expiresAt: input.expiresAt ?? now + input.ttlMs,
      createdAt: now,
      rotationCount: input.rotationCount ?? 0,
      consumedAt: null,
      revokedAt: null,
      replacedBy: null,
    },
  };
}

const APPLICATION_AUTHORITY: NativeAuthoritySnapshot = {
  scopeKind: 'application',
  scopeId: 'application',
  tenantId: null,
  membershipId: null,
  tenantAuthorizationGeneration: null,
  membershipAuthorizationGeneration: null,
};

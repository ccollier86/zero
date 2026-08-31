/** Creates opaque, hash-at-rest native refresh sessions. */

import { createOpaqueToken, hashToken } from '../../tokens/token-utils';
import type { PreparedNativeSession } from './native-auth-records';

export function prepareNativeSession(input: {
  userId: string;
  clientId: string;
  scope: string;
  authGeneration: number;
  ttlMs: number;
  expiresAt?: number;
  familyId?: string;
  rotationCount?: number;
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
      expiresAt: input.expiresAt ?? now + input.ttlMs,
      createdAt: now,
      rotationCount: input.rotationCount ?? 0,
      consumedAt: null,
      revokedAt: null,
      replacedBy: null,
    },
  };
}

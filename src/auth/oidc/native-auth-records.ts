/** Internal persistence records for Zero native OpenID Connect flows. */

import type { NativeAuthoritySnapshot } from './native-tenant-authority';

export interface StoredNativeAuthority {
  scopeKind: NativeAuthoritySnapshot['scopeKind'] | null;
  scopeId: string | null;
  tenantId: string | null;
  membershipId: string | null;
  tenantAuthorizationGeneration: number | null;
  membershipAuthorizationGeneration: number | null;
}

export interface NativeAuthorizationRequestRecord extends StoredNativeAuthority {
  requestId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  prompt: string | null;
  boundUserId: string | null;
  sourceHash: string | null;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface NativeAuthorizationCodeRecord extends StoredNativeAuthority {
  codeId: string;
  requestId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce: string;
  codeChallenge: string;
  authGeneration: number;
  mfaVerifiedAt: number | null;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface NativeSessionRecord extends StoredNativeAuthority {
  tokenId: string;
  familyId: string;
  userId: string;
  clientId: string;
  scope: string;
  authGeneration: number;
  mfaVerifiedAt: number | null;
  expiresAt: number;
  createdAt: number;
  rotationCount: number;
  consumedAt: number | null;
  revokedAt: number | null;
  replacedBy: string | null;
}

export interface PreparedNativeSession
  extends Omit<NativeSessionRecord, keyof StoredNativeAuthority>,
    Partial<StoredNativeAuthority> {
  tokenHash: string;
}

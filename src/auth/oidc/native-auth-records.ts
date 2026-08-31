/** Internal persistence records for Zero native OpenID Connect flows. */

export interface NativeAuthorizationRequestRecord {
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

export interface NativeAuthorizationCodeRecord {
  codeId: string;
  requestId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  nonce: string;
  codeChallenge: string;
  authGeneration: number;
  createdAt: number;
  expiresAt: number;
  consumedAt: number | null;
}

export interface NativeSessionRecord {
  tokenId: string;
  familyId: string;
  userId: string;
  clientId: string;
  scope: string;
  authGeneration: number;
  expiresAt: number;
  createdAt: number;
  rotationCount: number;
  consumedAt: number | null;
  revokedAt: number | null;
  replacedBy: string | null;
}

export interface PreparedNativeSession extends NativeSessionRecord {
  tokenHash: string;
}

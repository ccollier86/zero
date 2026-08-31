/** Live native access-session admission shared by HTTP and Sync resolution. */

import type { ResolvedNativeAuthConfig } from '../native';
import type { NativeSessionStore } from './native-session-store';

export interface NativeAccessSessionClaims {
  sessionId: string;
  userId: string;
  clientId: string;
  authGeneration: number;
}

export interface NativeAccessSessionValidator {
  isActive(claims: NativeAccessSessionClaims): boolean;
}

export function createNativeAccessSessionValidator(
  config: ResolvedNativeAuthConfig,
  sessions: NativeSessionStore,
): NativeAccessSessionValidator {
  const enabledClients = new Set(config.clients.map((client) => client.clientId));
  return {
    isActive(claims) {
      return config.enabled && enabledClients.has(claims.clientId)
        && sessions.isFamilyActive({
          familyId: claims.sessionId,
          userId: claims.userId,
          clientId: claims.clientId,
          authGeneration: claims.authGeneration,
        });
    },
  };
}

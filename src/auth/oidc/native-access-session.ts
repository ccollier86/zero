/** Live native access-session admission shared by HTTP and Sync resolution. */

import type { ResolvedNativeAuthConfig } from '../native';
import type { NativeSessionStore } from './native-session-store';
import type { NativeSessionRecord } from './native-auth-records';
import {
  NativeTenantAuthorityService,
  type ResolvedNativeAuthority,
} from './native-tenant-authority';

export interface NativeAccessSessionClaims {
  sessionId: string;
  userId: string;
  clientId: string;
  authGeneration: number;
}

export interface NativeAccessSessionValidator {
  isActive(claims: NativeAccessSessionClaims): boolean;
  resolveAuthority(claims: NativeAccessSessionClaims): (
    ResolvedNativeAuthority & { session: NativeSessionRecord }
  ) | null;
}

export function createNativeAccessSessionValidator(
  config: ResolvedNativeAuthConfig,
  sessions: NativeSessionStore,
  authority: NativeTenantAuthorityService = new NativeTenantAuthorityService('single', null),
  requiresMfaAssurance: (userId: string) => boolean = () => false,
): NativeAccessSessionValidator {
  const enabledClients = new Set(config.clients.map((client) => client.clientId));
  return {
    isActive(claims) {
      return this.resolveAuthority(claims) !== null;
    },
    resolveAuthority(claims) {
      if (!config.enabled || !enabledClients.has(claims.clientId)) return null;
      const session = sessions.resolveActiveFamily({
          familyId: claims.sessionId,
          userId: claims.userId,
          clientId: claims.clientId,
          authGeneration: claims.authGeneration,
      });
      if (!session) return null;
      if (requiresMfaAssurance(claims.userId) && session.mfaVerifiedAt === null) {
        return null;
      }
      const resolved = authority.resolve(claims.userId, session);
      return resolved ? { ...resolved, session } : null;
    },
  };
}

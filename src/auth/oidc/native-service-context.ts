/** Internal dependencies shared by focused native authorization operations. */

import type { ResolvedNativeAuthConfig } from '../native';
import type { TokenService } from '../token-service';
import type { UserStore } from '../user-store';
import type { AuthAuditService } from '../auth-audit-service';
import type { NativeCodeStore } from './native-code-store';
import type { NativeRequestStore } from './native-request-store';
import type { NativeSessionStore } from './native-session-store';
import type { NativeTenantAuthorityService } from './native-tenant-authority';
import type { AuthPlatformCodeEmitter } from '../auth-observability';

export interface NativeAuthorizationServiceConfig {
  native: ResolvedNativeAuthConfig;
  issuer: string;
  audience: string;
  requestTtlMs: number;
  codeTtlMs: number;
  refreshTtlMs: number;
}

export interface NativeServiceContext {
  config: NativeAuthorizationServiceConfig;
  requests: NativeRequestStore;
  codes: NativeCodeStore;
  sessions: NativeSessionStore;
  authority: NativeTenantAuthorityService;
  audit?: AuthAuditService;
  users: UserStore;
  tokens: TokenService;
  /** Live security policy; true requires durable MFA assurance on the family. */
  requiresMfaAssurance: (userId: string) => boolean;
  emitCode: AuthPlatformCodeEmitter;
}

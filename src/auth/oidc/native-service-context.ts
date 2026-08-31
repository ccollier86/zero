/** Internal dependencies shared by focused native authorization operations. */

import type { ResolvedNativeAuthConfig } from '../native';
import type { TokenService } from '../token-service';
import type { UserStore } from '../user-store';
import type { NativeCodeStore } from './native-code-store';
import type { NativeRequestStore } from './native-request-store';
import type { NativeSessionStore } from './native-session-store';

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
  users: UserStore;
  tokens: TokenService;
}

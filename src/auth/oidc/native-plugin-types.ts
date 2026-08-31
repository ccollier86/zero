/** Lazy runtime dependencies shared by the native OIDC Elysia subplugins. */

import type { TokenService } from '../token-service';
import type { UserStore } from '../user-store';
import type { NativeAuthorizationService } from './native-authorization-service';

export interface NativeAuthHttpConfig {
  issuer: string;
  audience: string;
  loginPath: string;
  registrationPath: string;
  getService: () => NativeAuthorizationService | null;
  getTokenService: () => TokenService | null;
  getUserStore: () => UserStore | null;
}

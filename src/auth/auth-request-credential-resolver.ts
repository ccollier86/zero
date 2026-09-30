/** Credential-neutral app API resolver. Guardian control-plane routes remain session-only. */

import { readAuthBearerToken } from './auth-bearer-token';
import type { AuthApiKeyService } from './auth-api-key-service';
import type {
  AuthRequestAuthorityReference,
  AuthRequestCredentialResolver,
} from './auth-api-key-types';
import type { TokenService } from './token-service';
import type { AuthContext } from './types';

const requestResolutions = new WeakMap<
  Request,
  Map<AuthRequestCredentialResolver, Promise<AuthContext | null>>
>();

export class GuardianRequestCredentialResolver implements AuthRequestCredentialResolver {
  constructor(
    private readonly tokens: TokenService,
    private readonly apiKeys: AuthApiKeyService,
  ) {}

  resolve(request: Request): Promise<AuthContext | null> {
    let byResolver = requestResolutions.get(request);
    if (!byResolver) {
      byResolver = new Map();
      requestResolutions.set(request, byResolver);
    }
    const existing = byResolver.get(this);
    if (existing) return existing;
    const raw = readAuthBearerToken(request);
    const resolution = raw ? this.resolveBearer(raw) : Promise.resolve(null);
    byResolver.set(this, resolution);
    return resolution;
  }

  captureAuthority(context: AuthContext): AuthRequestAuthorityReference | null {
    if (context.credentialKind === 'api-key') {
      return this.apiKeys.captureAuthority(context);
    }
    const reference = this.tokens.captureAuthContextAuthority(context);
    return reference ? Object.freeze({ kind: 'session', reference }) : null;
  }

  resolveAuthority(reference: AuthRequestAuthorityReference): AuthContext | null {
    return reference.kind === 'api-key'
      ? this.apiKeys.resolveAuthority(reference)
      : this.tokens.resolveAuthContextAuthority(reference.reference);
  }

  private async resolveBearer(raw: string): Promise<AuthContext | null> {
    if (this.apiKeys.isApiKeyToken(raw)) return this.apiKeys.resolve(raw);
    return this.tokens.resolveAuthContext(raw);
  }
}

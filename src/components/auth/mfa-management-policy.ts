/** Resolves current MFA UI capability without inventing methods or treating unknown policy as disabled. */
import type { AuthConfigState } from '../../frontend/client/auth-hooks';
import type { AuthMfaMethodType, AuthPublicConfig } from '../../frontend/client/auth-client';

type MfaConfig = NonNullable<AuthPublicConfig['mfa']>;
export type MfaManagementCapability =
  | { readonly kind: 'loading' | 'unavailable' | 'disabled' }
  | {
      readonly kind: 'enabled';
      readonly config: MfaConfig;
      readonly methods: AuthMfaMethodType[];
      readonly canEnroll: boolean;
      readonly key: string;
    };

export function resolveMfaManagementCapability(
  state: Pick<AuthConfigState, 'status' | 'config' | 'isLoading' | 'error'>,
): MfaManagementCapability {
  if (state.error !== null || state.status === 'error') return { kind: 'unavailable' };
  if (state.isLoading || state.status === 'unknown' || state.status === 'loading') return { kind: 'loading' };
  const config = state.config?.mfa;
  if (state.status !== 'ready' || !config) return { kind: 'unavailable' };
  if (config.enabled === false) return { kind: 'disabled' };
  if (config.enabled !== true) return { kind: 'unavailable' };
  const methods = [...new Set(config.availableMethods.filter(method => config.methods.includes(method)))];
  return {
    kind: 'enabled', config, methods,
    canEnroll: config.ready === true && methods.length > 0,
    key: JSON.stringify(config),
  };
}

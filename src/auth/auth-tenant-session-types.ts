import type { TokenPair } from './types';

/** Public-safe tenant projection used by selection and switching UI. */
export interface AuthTenantSummary {
  tenantId: string;
  slug: string;
  name: string;
  role: string | null;
}

export interface BoundAuthSessionCompletion {
  kind: 'session';
  tokens: TokenPair;
  tenant?: AuthTenantSummary;
}

export interface TenantSelectionCompletion {
  kind: 'tenant_selection_required';
  continuation: string;
  expiresAt: number;
  tenants: AuthTenantSummary[];
}

export interface TenantOnboardingCompletion {
  kind: 'tenant_onboarding_required';
  onboarding: {
    reason: 'no_active_tenant_membership';
    /**
     * Fully-authenticated, single-use identity proof for invitation or
     * join-request onboarding. This exists independently of tenant-creation
     * policy so disabled creation cannot strand an invited identity.
     */
    continuation: string;
    expiresAt: number;
    tenantCreation: {
      allowed: boolean;
      continuation?: string;
      expiresAt?: number;
    };
  };
}

export interface AuthTenantCreateInput {
  name: string;
  slug?: string;
  continuation?: string;
  refreshToken?: string;
}

export type AuthTenantSessionCompletion =
  | BoundAuthSessionCompletion
  | TenantSelectionCompletion
  | TenantOnboardingCompletion;

export interface AuthTenantListResult {
  activeTenantId: string;
  tenants: AuthTenantSummary[];
}

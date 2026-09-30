/** Public props for the optional Guardian API-key management components. */

export interface ApiKeyManagementCommonProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
}

export type ApiKeyManagementProps = ApiKeyManagementCommonProps & (
  | { mode: 'self' }
  | { mode: 'application-admin'; userId: string }
  | { mode: 'tenant-admin'; membershipId: string }
  | {
      mode: 'platform-admin';
      /** Optional global-directory tenant filter. */
      tenantId?: string;
      membershipId?: never;
    }
  | {
      mode: 'platform-admin';
      tenantId: string;
      membershipId: string;
    }
);

export type SelfApiKeyManagementProps = ApiKeyManagementCommonProps;

export interface ApplicationUserApiKeyManagementProps
  extends ApiKeyManagementCommonProps {
  userId: string;
}

export interface TenantMemberApiKeyManagementProps
  extends ApiKeyManagementCommonProps {
  membershipId: string;
}

export type PlatformApiKeyManagementProps = ApiKeyManagementCommonProps & (
  | { tenantId?: string; membershipId?: never }
  | { tenantId: string; membershipId: string }
);

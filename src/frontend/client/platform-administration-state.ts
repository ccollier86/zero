import type { AuthConfigStatus } from './auth-config-controller';
import { AuthClientError } from './auth-errors';
import type {
  AuthPlatformAddMemberParams,
  AuthPlatformAdministrationConfig,
  AuthPlatformIssueInvitationParams,
  AuthPlatformUpdateMemberInput,
} from './auth-platform-administration-types';
import type {
  AuthPublicConfig,
  AuthTenantInvitation,
  AuthTenantInvitationListParams,
  AuthTenantInvitationPage,
  AuthTenantIssueInvitationResult,
  AuthTenantMember,
  AuthTenantMemberListParams,
  AuthTenantMemberMutationResult,
  AuthTenantMemberPage,
  AuthTenantOwnershipTransferResult,
} from './auth-types';

export interface UsePlatformAdministrationOptions {
  enabled?: boolean;
  memberLimit?: number;
  memberSearch?: string;
  memberStatus?: AuthTenantMemberListParams['status'];
  invitationLimit?: number;
  invitationStatus?: AuthTenantInvitationListParams['status'];
}

export interface PlatformAdministrationInvitationDelivery {
  email: boolean;
  manual: boolean;
  default: 'email' | 'manual';
}

export type PlatformAdministrationInvitationPolicyStatus =
  | 'unresolved'
  | 'enabled'
  | 'disabled'
  | 'error';

export interface PlatformAdministrationInvitationPolicy {
  status: PlatformAdministrationInvitationPolicyStatus;
  /** Null means public auth configuration has not resolved yet. */
  enabled: boolean | null;
  delivery: PlatformAdministrationInvitationDelivery | null;
  error: string | null;
}

export interface UsePlatformAdministrationResult {
  isAvailable: boolean;
  config: AuthPlatformAdministrationConfig | null;
  members: AuthTenantMember[];
  memberPage: AuthTenantMemberPage['page'] | null;
  invitations: AuthTenantInvitation[];
  invitationPage: AuthTenantInvitationPage['page'] | null;

  /** Exact protected administration-config slice state. */
  isLoadingConfig: boolean;
  configError: string | null;
  reloadConfig(): void;

  /** Exact administration-member slice state. */
  isLoadingMembers: boolean;
  isMutatingMembers: boolean;
  membersError: string | null;
  reloadMembers(): void;

  /** Exact public policy and administration-invitation slice state. */
  invitationPolicyStatus: PlatformAdministrationInvitationPolicyStatus;
  invitationsEnabled: boolean | null;
  invitationDelivery: PlatformAdministrationInvitationDelivery | null;
  invitationConfigError: string | null;
  isLoadingInvitations: boolean;
  isMutatingInvitations: boolean;
  invitationsError: string | null;
  reloadInvitations(): void;

  /** Compatibility aggregates. Prefer the exact slice fields in new UI. */
  isLoading: boolean;
  isLoadingMoreMembers: boolean;
  isLoadingMoreInvitations: boolean;
  isMutating: boolean;
  error: string | null;
  reload(): void;
  loadMoreMembers(): Promise<void>;
  loadMoreInvitations(): Promise<void>;
  addMember(params: AuthPlatformAddMemberParams): Promise<AuthTenantMemberMutationResult>;
  updateMember(
    membershipId: string,
    params: AuthPlatformUpdateMemberInput,
  ): Promise<AuthTenantMemberMutationResult>;
  removeMember(membershipId: string): Promise<AuthTenantMemberMutationResult>;
  transferOwnership(membershipId: string): Promise<AuthTenantOwnershipTransferResult>;
  issueInvitation(
    params: AuthPlatformIssueInvitationParams,
  ): Promise<AuthTenantIssueInvitationResult>;
  revokeInvitation(invitationId: string): Promise<AuthTenantInvitation>;
}

/** Resolve public policy without treating an unavailable config as enabled. */
export function resolvePlatformAdministrationInvitationPolicy(
  status: AuthConfigStatus,
  config: AuthPublicConfig | null,
  error: string | null,
): PlatformAdministrationInvitationPolicy {
  if (status === 'unknown' || status === 'loading') {
    return { status: 'unresolved', enabled: null, delivery: null, error: null };
  }
  if (status === 'error') {
    return {
      status: 'error',
      enabled: false,
      delivery: null,
      error: error ?? 'Failed to load invitation configuration',
    };
  }

  const invitations = config?.tenancy?.onboarding?.invitations;
  if (!invitations) {
    return {
      status: 'error',
      enabled: false,
      delivery: null,
      error: 'Invitation configuration is unavailable',
    };
  }
  return {
    status: invitations.enabled ? 'enabled' : 'disabled',
    enabled: invitations.enabled,
    delivery: invitations.delivery,
    error: null,
  };
}

/** Fail closed before any invitation transport can run. */
export function assertPlatformAdministrationInvitationsEnabled(
  policy: PlatformAdministrationInvitationPolicy,
): void {
  if (policy.enabled === true) return;
  const message = policy.status === 'unresolved'
    ? 'Invitation configuration must load before invitations can be managed'
    : policy.status === 'error'
      ? 'Invitation configuration is unavailable; retry before managing invitations'
      : 'Administrator invitations are disabled by auth policy';
  throw new AuthClientError(message, 404, 'TENANT_INVITATIONS_UNAVAILABLE', null);
}

'use client';

import * as React from 'react';
import type { AuthTenantMember } from '../../frontend/client/auth-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type {
  NavigationAction,
  RecordPrimaryAction,
} from '#zero/components/ui/record-navigation-bar';
import { TenantMemberManagementSurface } from './tenant-member-management-surface';
import { useTenantMemberManagementController } from './use-tenant-member-management-controller';

export { rolesForTenantKind } from './tenant-role-scope';
export {
  assignedRolesAboveGrantCeiling,
  projectTenantMemberRoleChoices,
} from './tenant-member-role-editor';
export { resolveTenantMemberOperationPolicy } from './tenant-member-management-actions';
export { tenantConfirmationAnnouncement } from './use-tenant-member-management-controller';

export interface TenantMemberManagementProps {
  className?: string;
  pageSize?: number;
  title?: string;
  description?: string;
  /** Runs after a successful self-role/status/removal or ownership mutation signs the actor out. */
  onActorSessionInvalidated?: () => void;
  /** Compose account profile/security UI into the selected member's detail pane. */
  detailContent?: (member: AuthTenantMember) => React.ReactNode;
  /** Compose account-level operations into the same bottom action bar. */
  navigationActions?: (member: AuthTenantMember | null) => NavigationAction[];
  /** Optional adjacent primary workflow, such as inviting a new account. */
  secondaryPrimaryAction?: RecordPrimaryAction;
  /** Receives list selection changes without changing the tenant-member transport contract. */
  onSelectedMemberChange?: (member: AuthTenantMember | null) => void;
}

/** Capability-aware, mode-neutral active-tenant member management. */
export function TenantMemberManagement(props: TenantMemberManagementProps) {
  const auth = useAuth();
  const authConfig = useAuthConfig();
  const authorizationBoundary = useAuthorizationScopeBoundary();
  const configuredTenantSingular = authConfig.config?.tenancy?.terminology?.singular
    ?? 'organization';
  const tenantSingular = auth.activeTenant?.kind === 'administration'
    ? 'platform administration'
    : configuredTenantSingular;
  return (
    <TenantMemberManagementScope
      key={authorizationBoundary.key}
      {...props}
      tenantSingular={tenantSingular}
      tenantKind={auth.activeTenant?.kind ?? null}
      configState={authConfig}
    />
  );
}

function TenantMemberManagementScope({
  className,
  pageSize = 25,
  title,
  description,
  onActorSessionInvalidated,
  detailContent,
  navigationActions,
  secondaryPrimaryAction,
  onSelectedMemberChange,
  tenantSingular,
  tenantKind,
  configState,
}: TenantMemberManagementProps & {
  tenantSingular: string;
  tenantKind: 'administration' | 'organization' | null;
  configState: ReturnType<typeof useAuthConfig>;
}) {
  const controller = useTenantMemberManagementController({
    pageSize,
    tenantSingular,
    tenantKind,
    onActorSessionInvalidated,
    onSelectedMemberChange,
  });
  return (
    <TenantMemberManagementSurface
      controller={controller}
      configState={configState}
      className={className}
      title={title ?? `${capitalize(tenantSingular)} members`}
      description={description ?? `Manage ${tenantSingular} membership and tenant-scoped roles.`}
      tenantSingular={tenantSingular}
      tenantKind={tenantKind}
      detailContent={detailContent}
      navigationActions={navigationActions}
      secondaryPrimaryAction={secondaryPrimaryAction}
    />
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

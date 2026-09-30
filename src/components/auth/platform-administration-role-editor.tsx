'use client';

import type {
  AuthTenantMember,
  AuthTenantRoleDescriptor,
} from '../../frontend/client/auth-types';
import { TenantMemberRoleEditor } from './tenant-member-role-editor';
import { platformAdministrationRoleChoices } from './platform-administration-role-policy';

export interface PlatformAdministrationRoleEditorProps {
  member: AuthTenantMember;
  roles: readonly AuthTenantRoleDescriptor[];
  simple: boolean;
  draftRoles: readonly string[];
  busy: boolean;
  canTransferOwnership: boolean;
  rolePanelId: string;
  roleSelectionChanged: boolean;
  onChange(roles: string[]): void;
  onSave(): void;
}

/**
 * Platform-specific role editor that preserves assigned, above-ceiling roles
 * and retained retired keys while limiting new grants to administration roles.
 */
export function PlatformAdministrationRoleEditor({
  member,
  roles,
  simple,
  draftRoles,
  busy,
  canTransferOwnership,
  rolePanelId,
  roleSelectionChanged,
  onChange,
  onSave,
}: PlatformAdministrationRoleEditorProps) {
  return (
    <TenantMemberRoleEditor
      member={member}
      declaredRoles={roles}
      assignableRoles={platformAdministrationRoleChoices(roles)}
      simple={simple}
      draftRoles={draftRoles}
      busy={busy}
      canTransferOwnership={canTransferOwnership}
      requireAtLeastOneRole
      tenantSingular="platform administration"
      rolePanelId={rolePanelId}
      roleSelectionChanged={roleSelectionChanged}
      onChange={onChange}
      onSave={onSave}
    />
  );
}

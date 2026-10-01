'use client';

/**
 * user-management-detail.tsx
 *
 * Composes the user list, editable profile, security summary, and property form.
 * Data loading and lifecycle action policy remain in parent hooks.
 */

import type { AuthAdminConfig, AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import { MasterDetailPage } from '../../master-detail';
import type {
  NavigationAction,
  RecordPrimaryAction,
} from '../../ui/record-navigation-bar';
import { toast } from 'sonner';
import { toAdminUserUpdateParams } from './user-management-mappers';
import { createUserManagementSchema, userManagementListColumns } from './user-management-schema';
import { UserDetailHeader } from './user-detail-header';
import { UserManagementAccountOverview } from './user-management-account-overview';
import { UserManagementPropertiesForm } from './user-management-properties-form';
import { UserManagementSecurityPanel } from './user-management-security-panel';
import type { UserManagementUser } from './user-management-types';
import type { UserRoleOption } from './user-management-types';

/** Render the master-detail user surface with explicit read-only behavior. */
export function UserManagementDetail(params: {
  schema: ReturnType<typeof createUserManagementSchema>;
  users: UserManagementUser[];
  config: AuthAdminConfig | null;
  roleOptions: readonly UserRoleOption[];
  editableFields: string[];
  controlled: boolean;
  canUpdate: boolean;
  canDeleteProperty: boolean;
  accountEditMode?: 'inline' | 'dialog';
  mfaStatus: AuthAdminUserMfaStatus | null;
  mfaLoading: boolean;
  mfaError: string | null;
  navigationActions: (user: UserManagementUser | null) => NavigationAction[];
  primaryAction?: RecordPrimaryAction;
  additionalDetailContent?: (user: UserManagementUser) => React.ReactNode;
  updateUser: (id: string, changes: ReturnType<typeof toAdminUserUpdateParams>) => Promise<void>;
  deleteProperty: (id: string, key: string) => Promise<void>;
  onSelectedIdChange: (id: string | null) => void;
}) {
  return (
    <MasterDetailPage<UserManagementUser>
      schema={params.schema}
      listColumns={userManagementListColumns}
      editableFields={params.editableFields}
      primaryKey="id"
      data={params.users}
      searchable={params.controlled}
      detailHeader={({ item }) => (
        <UserDetailHeader
          user={item}
          roleLabel={params.roleOptions.find((option) => option.value === item.role)?.label}
        />
      )}
      renderDetail={params.accountEditMode === 'dialog'
        ? (user) => (
            <UserManagementAccountOverview
              user={user}
              roleLabel={params.roleOptions.find((option) => option.value === user.role)?.label}
            />
          )
        : params.canUpdate ? undefined : () => (
            <p className="mt-4 text-sm text-muted-foreground">This controlled user record is read-only.</p>
          )}
      detailContent={(user) => (
        <>
          <UserManagementSecurityPanel
            user={user}
            mfaStatus={params.mfaStatus}
            loading={params.mfaLoading}
            error={params.mfaError}
          />
          {params.canUpdate && <UserManagementPropertiesForm
            key={user.id}
            user={user}
            config={params.config}
            onSubmit={(properties) => params.updateUser(user.userId, { properties })}
            onDeleteProperty={params.canDeleteProperty
              ? (key) => params.deleteProperty(user.userId, key) : undefined}
          />}
          {params.additionalDetailContent?.(user)}
        </>
      )}
      navigationActions={params.navigationActions}
      primaryAction={params.primaryAction}
      onSelectedIdChange={(id) => params.onSelectedIdChange(id)}
      onUpdate={params.canUpdate
        ? (id, changes) => params.updateUser(id, toAdminUserUpdateParams(changes)) : undefined}
      onUpdateError={(message) => toast.error(message)}
      className="min-h-0 flex-1"
    />
  );
}

'use client';

import * as React from 'react';
import type { AuthAdminConfig, AuthAdminUpdateUserParams } from '../../../frontend/client/auth-client';
import { modals } from '../../../modals';
import { TenantAccountEditForm } from './tenant-account-edit-form';
import type { UserManagementUser, UserRoleOption } from './user-management-types';

/** Open the selected account's profile editor without displacing membership context. */
export function useTenantAccountEditDialog(params: {
  config: AuthAdminConfig | null;
  roleOptions: readonly UserRoleOption[];
  editableFields: readonly string[];
  updateUser(userId: string, changes: AuthAdminUpdateUserParams): Promise<void>;
}) {
  return React.useCallback((user: UserManagementUser) => {
    if (!params.config || params.editableFields.length === 0) return;
    let modalId = '';
    modalId = modals.open({
      title: `Edit ${user.username}`,
      size: 'lg',
      content: (
        <TenantAccountEditForm
          user={user}
          config={params.config}
          roleOptions={params.roleOptions}
          editableFields={params.editableFields}
          onSubmit={(changes) => params.updateUser(user.userId, changes)}
          onSuccess={() => modals.close(modalId)}
        />
      ),
    });
  }, [params.config, params.editableFields, params.roleOptions, params.updateUser]);
}

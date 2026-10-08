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
    const config = params.config;
    if (!config || params.editableFields.length === 0) return;
    modals.show<UserManagementUser>({
      title: `Edit ${user.username}`,
      size: 'lg',
      description: 'Update this account without changing its organization membership.',
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel' },
        { id: 'save', label: 'Save account', variant: 'primary', submit: true }],
      body: context => (
        <TenantAccountEditForm
          user={user}
          config={config}
          roleOptions={params.roleOptions}
          editableFields={params.editableFields}
          modalContext={context} formId={`${context.id}-edit-account`}
          onSubmit={changes => {
            if (context.signal.aborted) return Promise.reject(new Error('This dialog is no longer active.'));
            return params.updateUser(user.userId, changes);
          }}
          onSuccess={() => {}}
        />
      ),
    });
  }, [params.config, params.editableFields, params.roleOptions, params.updateUser]);
}

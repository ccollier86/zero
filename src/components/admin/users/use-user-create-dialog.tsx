'use client';

/**
 * use-user-create-dialog.tsx
 *
 * Owns the admin create-user modal composition. Form state remains inside the
 * form component and persistence is supplied by the caller.
 */

import * as React from 'react';
import type { AuthAdminConfig, AuthAdminCreateUserParams } from '../../../frontend/client/auth-client';
import { modals } from '../../../modals';
import { UserManagementCreateForm } from './user-management-create-form';
import type { UserRoleOption } from './user-management-types';

/** Return a stable action that opens and closes the create-user dialog. */
export function useUserCreateDialog(params: {
  config: AuthAdminConfig | null;
  roleOptions: readonly UserRoleOption[];
  allowGlobalAdminRole: boolean;
  createUser: (input: AuthAdminCreateUserParams) => Promise<void>;
}) {
  return React.useCallback(() => {
    modals.show<void>({
      title: 'Add user',
      size: 'lg',
      description: 'Create an account and configure its initial access.',
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel' },
        { id: 'create', label: 'Create user', variant: 'primary', submit: true }],
      body: context => (
        <UserManagementCreateForm
          config={params.config}
          roleOptions={params.roleOptions}
          allowGlobalAdminRole={params.allowGlobalAdminRole}
          modalContext={context} formId={`${context.id}-create-user`} showSubmit={false}
          onSubmit={async (input) => {
            if (context.signal.aborted) throw new Error('This dialog is no longer active.');
            await params.createUser(input);
          }}
        />
      ),
    });
  }, [
    params.allowGlobalAdminRole,
    params.config,
    params.createUser,
    params.roleOptions,
  ]);
}

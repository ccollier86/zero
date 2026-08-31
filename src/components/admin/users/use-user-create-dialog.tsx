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
  createUser: (input: AuthAdminCreateUserParams) => Promise<void>;
}) {
  return React.useCallback(() => {
    modals.open({
      title: 'Add user',
      size: 'lg',
      content: (
        <UserManagementCreateForm
          config={params.config}
          roleOptions={params.roleOptions}
          onSubmit={async (input) => {
            await params.createUser(input);
            modals.closeLast();
          }}
        />
      ),
    });
  }, [params.config, params.createUser, params.roleOptions]);
}

'use client';

import * as React from 'react';
import type { AuthAdminConfig, AuthAdminUpdateUserParams } from '../../../frontend/client/auth-client';
import { AutoForm } from '../../forms/auto-form';
import { createUserManagementSchema } from './user-management-schema';
import { toAdminUserUpdateParams } from './user-management-mappers';
import type { UserManagementUser, UserRoleOption } from './user-management-types';

export interface TenantAccountEditFormProps {
  user: UserManagementUser;
  config: AuthAdminConfig;
  roleOptions: readonly UserRoleOption[];
  editableFields: readonly string[];
  onSubmit(changes: AuthAdminUpdateUserParams): Promise<void>;
  onSuccess(): void;
}

/** Focused account-profile editor opened from the shared record action bar. */
export function TenantAccountEditForm({
  user,
  config,
  roleOptions,
  editableFields,
  onSubmit,
  onSuccess,
}: TenantAccountEditFormProps) {
  const [error, setError] = React.useState<string | null>(null);
  const schema = React.useMemo(
    () => createUserManagementSchema(
      roleOptions,
      config.tenancy?.mode === 'multi' ? 'Global identity role' : 'Role',
    ),
    [config.tenancy?.mode, roleOptions],
  );

  return (
    <div className="space-y-3">
      <AutoForm<UserManagementUser>
        key={user.userId}
        schema={schema}
        mode="edit"
        defaultValues={user}
        includeFields={editableFields}
        columns={2}
        submitLabel="Save account"
        showReset
        onSubmit={async (values) => {
          setError(null);
          await onSubmit(toAdminUserUpdateParams(values));
        }}
        onSuccess={onSuccess}
        onError={setError}
      />
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

/**
 * use-user-management-mutations.ts
 *
 * Adapts self-wired and controlled mutations to one explicit component contract.
 * Missing controlled handlers fail closed instead of presenting silent no-ops.
 */

import * as React from 'react';
import { toast } from 'sonner';
import type { AuthAdminCreateUserParams, AuthAdminUpdateUserParams } from '../../../frontend/client/auth-client';
import type { UserManagementProps } from './user-management-props';
import type { UseAdminUsersResult } from './user-management-types';

/** Return mutation adapters that preserve controlled-mode handler boundaries. */
export function useUserManagementMutations(params: {
  controlled: boolean;
  live: UseAdminUsersResult;
  handlers: Pick<UserManagementProps, 'onCreate' | 'onUpdate' | 'onDeleteProperty' | 'onDelete'>;
}) {
  const { controlled, live, handlers } = params;
  const createUser = React.useCallback(async (input: AuthAdminCreateUserParams) => {
    if (controlled) {
      if (!handlers.onCreate) throw new Error('Controlled user creation requires onCreate.');
      await handlers.onCreate(input);
      return;
    }
    const result = await live.createUser(input);
    await handlers.onCreate?.(input);
    toast.success(result.setupEmailSent ? 'User created and setup email sent' : 'User created');
  }, [controlled, handlers.onCreate, live.createUser]);

  const updateUser = React.useCallback(async (id: string, changes: AuthAdminUpdateUserParams) => {
    if (controlled) {
      if (!handlers.onUpdate) throw new Error('Controlled user updates require onUpdate.');
      await handlers.onUpdate(id, changes);
      return;
    }
    await live.updateUser(id, changes);
    await handlers.onUpdate?.(id, changes);
    toast.success('User updated');
  }, [controlled, handlers.onUpdate, live.updateUser]);

  const deleteProperty = React.useCallback(async (id: string, key: string) => {
    if (controlled) {
      if (!handlers.onDeleteProperty) throw new Error('Property deletion requires onDeleteProperty.');
      await handlers.onDeleteProperty(id, key);
      return;
    }
    await live.deleteUserProperty(id, key);
    await handlers.onDeleteProperty?.(id, key);
  }, [controlled, handlers.onDeleteProperty, live.deleteUserProperty]);

  const deleteUser = React.useCallback(async (id: string) => {
    if (controlled) {
      if (!handlers.onDelete) throw new Error('Controlled deletion requires onDelete.');
      await handlers.onDelete(id);
      return;
    }
    await live.deleteUser(id);
    await handlers.onDelete?.(id);
    toast.success('User deleted');
  }, [controlled, handlers.onDelete, live.deleteUser]);

  return { createUser, updateUser, deleteProperty, deleteUser };
}

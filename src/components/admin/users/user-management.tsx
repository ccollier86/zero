'use client';

/**
 * user-management.tsx
 *
 * Composes Zero's reusable admin user-management organism from smaller UI,
 * hook, and SDK-backed pieces. This file owns orchestration and interaction
 * wiring only; auth transport lives in the SDK and field policy lives on the
 * backend.
 */

import * as React from 'react';
import {
  Ban,
  KeyRound,
  LockKeyhole,
  Mail,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AuthAdminConfig,
  AuthAdminCreateUserParams,
  AuthAdminUpdateUserParams,
} from '../../../frontend/client/auth-client';
import { AnimateIcon } from '../../animate-ui/icons/icon';
import { Trash } from '../../animate-ui/icons/trash';
import { MasterDetailPage } from '../../master-detail';
import type { NavigationAction } from '../../ui/record-navigation-bar';
import { Button } from '../../ui/button';
import { modals } from '../../../modals';
import { cn } from '../../../lib/utils';
import {
  normalizeRoleOptions,
  toAdminUserUpdateParams,
} from './user-management-mappers';
import {
  createUserManagementSchema,
  userManagementEditableFields,
  userManagementListColumns,
} from './user-management-schema';
import { useAdminUsers } from './use-admin-users';
import { UserDetailHeader } from './user-detail-header';
import { UserManagementCreateForm } from './user-management-create-form';
import { UserManagementListControls } from './user-management-list-controls';
import { UserManagementPasswordResetForm } from './user-management-password-reset-form';
import { UserManagementPropertiesForm } from './user-management-properties-form';
import { getAdminUserPageWindow } from './user-management-pagination';
import type {
  UserManagementCreateResult,
  UserManagementUser,
  UserRoleOption,
} from './user-management-types';

export interface UserManagementProps {
  /** Controlled user rows. When omitted, the component loads admin users from the SDK. */
  data?: UserManagementUser[];
  /** Controlled admin config. When omitted, the component loads `/auth/admin/config`. */
  config?: AuthAdminConfig | null;
  /** Optional app-specific role choices. Loaded user roles are merged in automatically. */
  roleOptions?: readonly UserRoleOption[];
  /** Backend page size for the self-wired mode. Default: 100. */
  pageSize?: number;
  /** Called after a user is created, or used as the create handler in controlled mode. */
  onCreate?: (params: AuthAdminCreateUserParams) => void | Promise<void | UserManagementCreateResult>;
  /** Called after a user is updated, or used as the update handler in controlled mode. */
  onUpdate?: (userId: string, changes: AuthAdminUpdateUserParams) => void | Promise<void | UserManagementUser>;
  /** Called after a user is deleted, or used as the delete handler in controlled mode. */
  onDelete?: (userId: string) => void | Promise<void>;
  className?: string;
}

/** Fully wired admin user-management organism for dashboard embedding. */
export function UserManagement({
  data,
  config: configProp,
  roleOptions: roleOptionsProp,
  pageSize,
  onCreate,
  onUpdate,
  onDelete,
  className,
}: UserManagementProps) {
  const controlled = data !== undefined;
  const live = useAdminUsers({ enabled: !controlled, pageSize });
  const users = data ?? live.users;
  const config = configProp ?? live.config;
  const roleOptions = React.useMemo(
    () => normalizeRoleOptions(users, roleOptionsProp),
    [roleOptionsProp, users],
  );
  const schema = React.useMemo(
    () => createUserManagementSchema(roleOptions),
    [roleOptions],
  );
  const pageWindow = React.useMemo(
    () => getAdminUserPageWindow(live.page),
    [live.page],
  );

  const handleCreate = React.useCallback(
    async (params: AuthAdminCreateUserParams) => {
      if (controlled) {
        await onCreate?.(params);
        return;
      }
      const result = await live.createUser(params);
      await onCreate?.(params);
      toast.success(result.setupEmailSent ? 'User created and setup email sent' : 'User created');
    },
    [controlled, live, onCreate],
  );

  const handleUpdate = React.useCallback(
    async (userId: string, changes: AuthAdminUpdateUserParams) => {
      if (controlled) {
        await onUpdate?.(userId, changes);
        return;
      }
      await live.updateUser(userId, changes);
      await onUpdate?.(userId, changes);
      toast.success('User updated');
    },
    [controlled, live, onUpdate],
  );

  const handleDelete = React.useCallback(
    async (userId: string) => {
      if (controlled) {
        await onDelete?.(userId);
        return;
      }
      await live.deleteUser(userId);
      await onDelete?.(userId);
      toast.success('User deleted');
    },
    [controlled, live, onDelete],
  );

  const openCreateModal = React.useCallback(() => {
    modals.open({
      title: 'Add user',
      size: 'lg',
      content: (
        <UserManagementCreateForm
          config={config}
          roleOptions={roleOptions}
          onSubmit={async (params) => {
            await handleCreate(params);
            modals.closeLast();
          }}
        />
      ),
    });
  }, [config, handleCreate, roleOptions]);

  const runAction = React.useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Admin user action failed');
      }
    },
    [],
  );

  const loadPageOffset = React.useCallback(
    (offset: number | null) => {
      if (offset === null) return;
      void runAction(() => live.loadPage(offset));
    },
    [live, runAction],
  );

  const navigationActions = React.useCallback(
    (user: UserManagementUser | null): NavigationAction[] => [
      {
        icon: <Mail size={20} />,
        label: 'Setup Email',
        onClick: () => void runAction(async () => {
          if (!user) return;
          const sent = await live.sendSetupEmail(user.userId);
          toast.success(sent ? 'Setup email sent' : 'Setup email accepted');
        }),
        disabled: controlled || !user || !config?.capabilities.setupEmail || user.status === 'suspended',
      },
      {
        icon: <KeyRound size={20} />,
        label: 'Set Password',
        variant: 'warning',
        onClick: () => {
          if (!user) return;
          modals.open({
            title: 'Set password',
            size: 'md',
            content: (
              <UserManagementPasswordResetForm
                username={user.username}
                onSubmit={async (password) => {
                  await live.resetPassword(user.userId, password);
                  toast.success('Password reset');
                  modals.closeLast();
                }}
              />
            ),
          });
        },
        disabled: controlled || !user || !config?.capabilities.manualPasswordReset,
      },
      {
        icon: <LockKeyhole size={20} />,
        label: 'Reset Email',
        variant: 'warning',
        onClick: () => void runAction(async () => {
          if (!user) return;
          await live.sendPasswordReset(user.userId);
          toast.success('Password reset email sent');
        }),
        disabled: controlled || !user || !config?.capabilities.passwordResetEmail || user.status === 'suspended',
      },
      {
        icon: <RotateCcw size={20} />,
        label: 'Revoke Sessions',
        variant: 'warning',
        onClick: () => void runAction(async () => {
          if (!user) return;
          await live.revokeSessions(user.userId);
          toast.success('Sessions revoked');
        }),
        disabled: controlled || !user,
      },
      {
        icon: <Ban size={20} />,
        label: 'Suspend',
        variant: 'warning',
        onClick: () => void runAction(async () => {
          if (!user) return;
          await live.suspendUser(user.userId);
          toast.success('User suspended');
        }),
        disabled: controlled || !user || !config?.capabilities.suspendUsers || user.status === 'suspended',
      },
      {
        icon: <ShieldCheck size={20} />,
        label: 'Activate',
        variant: 'success',
        onClick: () => void runAction(async () => {
          if (!user) return;
          await live.activateUser(user.userId);
          toast.success('User activated');
        }),
        disabled: controlled || !user || user.status === 'active',
      },
      {
        icon: <AnimateIcon animateOnHover><Trash size={20} /></AnimateIcon>,
        label: 'Delete',
        variant: 'destructive',
        onClick: () => void runAction(async () => {
          if (!user) return;
          const confirmed = await modals.confirm({
            title: 'Delete user?',
            description: `${user.username} will no longer be able to sign in.`,
            confirmLabel: 'Delete',
            variant: 'destructive',
            holdToConfirm: true,
          });
          if (!confirmed) return;
          await handleDelete(user.userId);
        }),
        disabled: !user || (controlled && !onDelete),
      },
    ],
    [config, controlled, handleDelete, live, onDelete, runAction],
  );

  return (
    <div className={cn('flex h-full min-h-[32rem] flex-col gap-3', className)}>
      {live.error && !controlled && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <span className="min-w-0 truncate">{live.error}</span>
          <Button size="sm" variant="outline" onClick={() => void live.reload().catch(() => {})}>
            Retry
          </Button>
        </div>
      )}

      {!controlled && (
        <UserManagementListControls
          filters={live.filters}
          page={live.page}
          roleOptions={roleOptions}
          isLoading={live.isLoading}
          onSearchChange={live.setSearch}
          onRoleChange={live.setRole}
          onStatusChange={live.setStatus}
          onPreviousPage={() => loadPageOffset(pageWindow.previousOffset)}
          onNextPage={() => loadPageOffset(pageWindow.nextOffset)}
          onRefresh={() => void runAction(live.reload)}
        />
      )}

      <MasterDetailPage<UserManagementUser>
        schema={schema}
        listColumns={userManagementListColumns}
        editableFields={userManagementEditableFields}
        primaryKey="id"
        data={users}
        searchable={controlled}
        detailHeader={({ item }) => <UserDetailHeader user={item} />}
        detailContent={(item) => (
          <UserManagementPropertiesForm
            key={item.id}
            user={item}
            config={config}
            onSubmit={(properties) => handleUpdate(item.userId, { properties })}
          />
        )}
        navigationActions={navigationActions}
        primaryAction={controlled && !onCreate
          ? undefined
          : {
              label: live.isLoading && !controlled ? 'Loading' : 'Add User',
              disabled: !controlled && (live.isLoading || config === null),
              onClick: openCreateModal,
            }}
        onUpdate={(id, changes) => handleUpdate(id, toAdminUserUpdateParams(changes))}
        onUpdateError={(message) => toast.error(message)}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

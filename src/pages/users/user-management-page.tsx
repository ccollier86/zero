'use client';

import * as React from 'react';
import { useCallback } from 'react';
import { Ban, ShieldCheck } from 'lucide-react';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Trash } from '@/components/animate-ui/icons/trash';
import { MasterDetailPage } from '@/components/master-detail';
import type { NavigationAction } from '@/components/ui/record-navigation-bar';
import { UserDetailHeader } from './user-detail-header';
import { userSchema, userListColumns } from './user-schema';
import { mockUsers, type MockUser } from './mock-users';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserManagementPageProps {
  data?: MockUser[];
  onCreate?: (user: Partial<MockUser>) => void;
  onUpdate?: (userId: string, changes: Partial<MockUser>) => void;
  onDelete?: (userId: string) => void;
  className?: string;
}

// ─── Detail header adapter ──────────────────────────────────────────────────

function UserHeader({ item }: { item: MockUser }) {
  return <UserDetailHeader user={item} />;
}

// ─── Component ──────────────────────────────────────────────────────────────

function UserManagementPage({
  data,
  onCreate,
  onUpdate,
  onDelete,
  className,
}: UserManagementPageProps) {
  const navigationActions = useCallback(
    (user: MockUser | null): NavigationAction[] => [
      {
        icon: <Ban size={20} />,
        label: 'Suspend',
        variant: 'warning',
        onClick: () => { if (user) onUpdate?.(user.id, { status: 'suspended' }); },
        disabled: !user || user.status === 'suspended',
      },
      {
        icon: <ShieldCheck size={20} />,
        label: 'Activate',
        variant: 'success',
        onClick: () => { if (user) onUpdate?.(user.id, { status: 'active' }); },
        disabled: !user || user.status === 'active',
      },
      {
        icon: <AnimateIcon animateOnHover><Trash size={20} /></AnimateIcon>,
        label: 'Delete',
        variant: 'destructive',
        onClick: () => { if (user) onDelete?.(user.id); },
        disabled: !user,
      },
    ],
    [onUpdate, onDelete],
  );

  return (
    <MasterDetailPage<MockUser>
      schema={userSchema}
      listColumns={userListColumns}
      data={data ?? mockUsers}
      detailHeader={UserHeader}
      navigationActions={navigationActions}
      primaryAction={{
        label: 'Add User',
        shortcut: '⌘N',
        onClick: () => onCreate?.({}),
      }}
      onUpdate={onUpdate}
      className={className}
    />
  );
}

export { UserManagementPage };

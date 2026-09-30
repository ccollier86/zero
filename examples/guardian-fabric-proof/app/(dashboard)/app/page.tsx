'use client';

import {
  DataRealmReadyGate,
  PermissionGate,
  TenantGate,
} from '@zero/framework/components/auth';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

import { TaskBoard } from '../../tasks/task-board';
import { TASK_READ_PERMISSIONS } from '../../tasks/task-types';

export const meta = {
  title: 'Tasks | Guardian + Fabric Proof',
  description: 'Realtime tasks from the active physical tenant database.',
};

export default function TasksPage() {
  return (
    <TenantGate tenantKind="organization" fallback={<CustomerWorkspaceRequired />}>
      <PermissionGate
        permission={TASK_READ_PERMISSIONS}
        match="any"
        loadingFallback={<TaskPermissionLoading />}
        fallback={<TaskPermissionRequired />}
      >
        <DataRealmReadyGate>
          <TaskBoard />
        </DataRealmReadyGate>
      </PermissionGate>
    </TenantGate>
  );
}

function TaskPermissionLoading() {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <CardTitle>Loading workspace authority</CardTitle>
        <CardDescription>
          Guardian is restoring the live permission projection for this workspace.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function TaskPermissionRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Task access required</CardTitle>
        <CardDescription>
          Your workspace membership does not currently grant task-read access. Ask a
          workspace owner to assign the viewer, contributor, or manager role.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

function CustomerWorkspaceRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create or select a customer workspace</CardTitle>
        <CardDescription>
          This proof presents its task board only in a customer-workspace scope.
          Use the workspace menu to create or select one before loading tenant data.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}

'use client';

import {
  DataRealmReadyGate,
  PermissionGate,
  TenantGate,
} from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';

import { TaskBoard } from '../../tasks/task-board';
import { TASK_READ_PERMISSIONS } from '../../tasks/task-types';

export const meta = {
  title: 'Realtime tasks | Guardian + Fabric + Torrent Proof',
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
        <CardTitle asChild><h2>Loading workspace authority</h2></CardTitle>
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
        <CardTitle asChild><h2>Task access required</h2></CardTitle>
        <CardDescription>
          Your workspace membership does not currently grant task-read access. Ask a
          workspace owner to assign the viewer, contributor, or manager role.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline"><a href="/app">Return to proof center</a></Button>
      </CardContent>
    </Card>
  );
}

function CustomerWorkspaceRequired() {
  return (
    <Card>
      <CardHeader>
        <CardTitle asChild><h2>Create or select a customer workspace</h2></CardTitle>
        <CardDescription>
          Tasks are available only in a customer-workspace scope. Create a workspace or
          select one from the workspace menu before loading tenant data.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild><a href="/workspaces/new">Create workspace</a></Button>
        <Button asChild variant="outline"><a href="/app">Return to proof center</a></Button>
      </CardContent>
    </Card>
  );
}

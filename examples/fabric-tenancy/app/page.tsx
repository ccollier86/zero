'use client';

import { useMemo, useState, type FormEvent } from 'react';
import {
  PermissionGate,
  TenantCreationForm,
  TenantMemberManagement,
  TenantSwitcher,
} from '@zero/framework/components/auth';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { Input } from '@zero/framework/components/ui/input';
import { Label } from '@zero/framework/components/ui/label';
import { useAuth, useCollection } from '@zero/framework/react/hooks';
import type { RouteConfig } from '@zero/framework/server';
import type { InferRow } from '@zero/framework/schema';
import { tasks as taskTable } from '../db/schema';

type Task = InferRow<typeof taskTable>;

export const config: RouteConfig = {
  auth: { tenant: 'required', permission: 'tasks:read' },
};

export default function TasksPage() {
  const auth = useAuth();
  const collection = useCollection<Task, 'task_id'>('tasks');
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const orderedTasks = useMemo(
    () => [...collection.data].sort((left, right) => right.created_at - left.created_at),
    [collection.data],
  );

  function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    collection.insert({
      task_id: taskId.trim() || crypto.randomUUID(),
      title: normalizedTitle,
      completed: false,
      created_at: Date.now(),
    });
    setTaskId('');
    setTitle('');
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await auth.logout();
      window.location.assign('/login');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-4 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">Zero Fabric example</p>
          <h1 className="text-3xl font-semibold tracking-tight">Workspace tasks</h1>
          <p className="text-sm text-muted-foreground">
            Active workspace: {auth.activeTenant?.name ?? 'Loading…'}
          </p>
          {auth.activeTenant && (
            <code className="block text-xs text-muted-foreground">
              {auth.activeTenant.tenantId}
            </code>
          )}
        </div>
        <div className="flex min-w-64 flex-col gap-3 sm:items-end">
          <TenantSwitcher className="w-full sm:w-72" label="Workspace" />
          <Button variant="outline" size="sm" disabled={loggingOut} onClick={() => void logout()}>
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>Tasks</CardTitle>
            <CardDescription>
              Realtime rows come from the active workspace&apos;s physical database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <PermissionGate
              permission="tasks:write"
              fallback={(
                <p className="rounded-md border bg-muted/50 p-3 text-sm text-muted-foreground">
                  Your role can read tasks but cannot change them.
                </p>
              )}
            >
              <form className="grid gap-3 rounded-lg border p-4" onSubmit={createTask}>
                <div className="grid gap-1.5">
                  <Label htmlFor="task-id">Task ID (optional)</Label>
                  <Input
                    id="task-id"
                    value={taskId}
                    onChange={(event) => setTaskId(event.target.value)}
                    placeholder="shared-demo-task"
                    maxLength={120}
                  />
                  <p className="text-xs text-muted-foreground">
                    Reuse an ID in another workspace to verify physical isolation.
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="task-title">Title</Label>
                  <Input
                    id="task-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Ship the Fabric demo"
                    maxLength={160}
                    required
                  />
                </div>
                <Button type="submit" disabled={!title.trim()}>Add task</Button>
              </form>
            </PermissionGate>

            <div className="space-y-3" aria-live="polite">
              {orderedTasks.length === 0 && (
                <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  This workspace has no tasks yet.
                </p>
              )}
              {orderedTasks.map((task) => (
                <article key={task.task_id} className="flex items-start gap-3 rounded-lg border p-4">
                  <PermissionGate
                    permission="tasks:write"
                    fallback={(
                      <span
                        className="mt-0.5 size-4 rounded border"
                        aria-label={task.completed ? 'Completed' : 'Incomplete'}
                      />
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-4 accent-primary"
                      checked={task.completed}
                      aria-label={`Mark ${task.title} complete`}
                      onChange={(event) => collection.update(task.task_id, {
                        completed: event.currentTarget.checked,
                      })}
                    />
                  </PermissionGate>
                  <div className="min-w-0 flex-1">
                    <p className={task.completed ? 'text-muted-foreground line-through' : ''}>
                      {task.title}
                    </p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                      {task.task_id}
                    </p>
                  </div>
                  <PermissionGate permission="tasks:write">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => collection.remove(task.task_id)}
                    >
                      Delete
                    </Button>
                  </PermissionGate>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>New workspace</CardTitle>
              <CardDescription>
                Creating one also creates its isolated task database on first use.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TenantCreationForm onSuccess={() => window.location.assign('/')} />
            </CardContent>
          </Card>

          <PermissionGate permission="tenant.members:manage">
            <details className="rounded-xl border bg-card p-4 shadow-sm">
              <summary className="cursor-pointer font-medium">Workspace members</summary>
              <div className="mt-4">
                <TenantMemberManagement
                  title="Workspace members"
                  description="Add another registered user and assign the task-editor or task-reader role."
                />
              </div>
            </details>
          </PermissionGate>
        </aside>
      </div>
    </main>
  );
}

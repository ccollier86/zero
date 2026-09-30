'use client';

import * as React from 'react';

import { KanbanBoard, type KanbanItemMove } from '@zero/framework/components/kanban';
import { PermissionGate } from '@zero/framework/components/auth';
import { Badge } from '@zero/framework/components/ui/badge';
import { Button } from '@zero/framework/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@zero/framework/components/ui/card';
import { Input } from '@zero/framework/components/ui/input';
import { Check, Plus, Trash, Wifi } from '@zero/framework/icons';
import { useConfirm } from '@zero/framework/react';
import {
  useCollection,
  useHasPermission,
  useResourceActions,
  useStatus,
} from '@zero/framework/react/hooks';
import { toast } from '@zero/framework/react';

import {
  isTaskStatus,
  TASK_COLUMNS,
  type TaskColumn,
  type TaskRow,
} from './task-types';

/** Realtime reads plus policy-protected Resource mutations for one tenant realm. */
export function TaskBoard() {
  const collection = useCollection<TaskRow, 'task_id'>('tasks');
  const actions = useResourceActions<TaskRow>('tasks');
  const confirm = useConfirm();
  const canCreate = useHasPermission('tasks:create');
  const canUpdateOwn = useHasPermission('tasks:update:own');
  const canManage = useHasPermission('tasks:manage');
  const canUpdate = canUpdateOwn || canManage;
  const { connected } = useStatus();
  const [title, setTitle] = React.useState('');
  const tasks = React.useMemo(
    () => [...collection.data].sort((left, right) => right.created_at - left.created_at),
    [collection.data],
  );

  async function createTask(event: React.FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!canCreate || !nextTitle || actions.loading) return;
    actions.resetError();
    try {
      await actions.create({
        task_id: crypto.randomUUID(),
        title: nextTitle,
        status: 'open',
        created_at: Date.now(),
      });
      setTitle('');
      toast.success('Task created.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Task could not be created.'));
    }
  }

  async function moveTask(move: KanbanItemMove<TaskColumn, TaskRow>) {
    if (!canUpdate || move.fromColumnId === move.toColumnId || !isTaskStatus(move.toColumnId)) return;
    actions.resetError();
    try {
      await actions.update(move.item.task_id, { status: move.toColumnId });
    } catch (cause) {
      toast.error(errorMessage(cause, 'Task status could not be updated.'));
    }
  }

  async function removeTask(task: TaskRow) {
    if (!canManage || actions.loading) return;
    const confirmed = await confirm({
      title: `Delete “${task.title}”?`,
      description: 'This permanently removes the task from the active workspace database.',
      confirmLabel: 'Delete task',
      variant: 'destructive',
    });
    if (!confirmed) return;
    actions.resetError();
    try {
      await actions.remove(task.task_id);
      toast.success('Task deleted.');
    } catch (cause) {
      toast.error(errorMessage(cause, 'Task could not be deleted.'));
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Active workspace tasks</CardTitle>
            <CardDescription>
              Reads stream through tenant Sync. Creates, moves, and deletes use the generated tasks Resource.
            </CardDescription>
          </div>
          <Badge
            variant={connected ? 'secondary' : 'outline'}
            className="w-fit gap-1.5"
            role="status"
            aria-live="polite"
          >
            <Wifi className="size-3.5" aria-hidden="true" />
            {connected ? 'Realtime connected' : 'Connecting'}
          </Badge>
        </CardHeader>
        <CardContent>
          <PermissionGate
            permission="tasks:create"
            loadingFallback={<p className="text-sm text-muted-foreground">Checking task permissions…</p>}
            fallback={(
              <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                Your current role cannot create tasks. A workspace owner can grant the contributor
                or manager role from Workspace.
              </div>
            )}
          >
            <form className="flex flex-col gap-2 sm:flex-row" onSubmit={createTask}>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Describe the next task"
                aria-label="New task title"
                maxLength={200}
                disabled={actions.loading}
              />
              <Button type="submit" disabled={!canCreate || actions.loading || !title.trim()}>
                <Plus className="size-4" />
                Add task
              </Button>
            </form>
          </PermissionGate>
          {actions.error ? (
            <div className="mt-3 flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              <span>{actions.error.message}</span>
              <Button type="button" size="xs" variant="ghost" onClick={actions.resetError}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <KanbanBoard<TaskColumn, TaskRow>
        columns={TASK_COLUMNS}
        items={tasks}
        getColumnId={(column) => column.status}
        getColumnTitle={(column) => column.label}
        getColumnAccentClassName={(column) => column.accent}
        getItemId={(task) => task.task_id}
        getItemColumnId={(task) => task.status}
        dragEnabled={canUpdate}
        disabled={actions.loading}
        emptyColumnText="No tasks"
        onItemMove={(move) => { void moveTask(move); }}
        renderColumnHeader={({ column, itemCount }) => (
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2.5">
            <h3 className="flex items-center gap-2 font-medium">
              {column.status === 'complete' ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : null}
              {column.label}
            </h3>
            <Badge variant="secondary" aria-label={`${itemCount} tasks`}>{itemCount}</Badge>
          </div>
        )}
        renderItem={({ item }) => (
          <TaskCard task={item} hasActions={canManage} />
        )}
        renderItemActions={({ item }) => canManage ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={`Delete ${item.title}`}
            disabled={actions.loading}
            onClick={() => { void removeTask(item); }}
          >
            <Trash className="size-3.5" aria-hidden="true" />
          </Button>
        ) : null}
        className="min-h-[32rem]"
        boardClassName="min-h-[29rem]"
        columnWidthClassName="w-[min(24rem,84vw)]"
      />
    </div>
  );
}

function TaskCard({
  task,
  hasActions,
}: {
  task: TaskRow;
  hasActions: boolean;
}) {
  return (
    <article className={`rounded-lg border border-border bg-card p-3 shadow-xs ${hasActions ? 'pr-10' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 space-y-1.5">
          <h3 className="break-words text-sm font-medium leading-5">{task.title}</h3>
          <p className="text-xs text-muted-foreground">
            Created {new Date(task.created_at).toLocaleString()}
          </p>
          <div className="flex flex-wrap gap-1.5 text-[0.7rem] text-muted-foreground">
            <span title={task.created_by_user_id}>
              User {shortId(task.created_by_user_id)}
            </span>
            <span aria-hidden="true">·</span>
            <span title={task.assigned_membership_id}>
              Membership {shortId(task.assigned_membership_id)}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

function shortId(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

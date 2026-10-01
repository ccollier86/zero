import { Badge } from '@zero/framework/components/ui/badge';

import type { TaskRow } from './task-types';

export interface TaskCardProps {
  task: TaskRow;
  hasActions: boolean;
  currentMembershipId?: string;
}

/** One immutable-attribution task presentation. */
export function TaskCard({ task, hasActions, currentMembershipId }: TaskCardProps) {
  const ownedByCurrentActor = Boolean(
    currentMembershipId && task.assigned_membership_id === currentMembershipId,
  );
  return (
    <article className={`rounded-lg border border-border bg-card p-3 shadow-xs ${hasActions ? 'pr-10' : ''}`}>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="break-words text-sm font-medium leading-5">{task.title}</h3>
          {ownedByCurrentActor ? <Badge variant="secondary">Your task</Badge> : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Created {new Date(task.created_at).toLocaleString()}
        </p>
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span title={task.created_by_user_id}>User {shortId(task.created_by_user_id)}</span>
          <span aria-hidden="true">·</span>
          <span title={task.assigned_membership_id}>
            Membership {shortId(task.assigned_membership_id)}
          </span>
        </div>
      </div>
    </article>
  );
}

function shortId(value: string): string {
  return value.length <= 10 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

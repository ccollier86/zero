import { Badge } from '@zero/framework/components/ui/badge';

export interface TaskAccessSummaryProps {
  canCreate: boolean;
  canUpdateOwn: boolean;
  canManage: boolean;
  pendingMutations: number;
  resourceActionPending: boolean;
}

/** Human-readable projection of the active role's board behavior. */
export function TaskAccessSummary({
  canCreate,
  canUpdateOwn,
  canManage,
  pendingMutations,
  resourceActionPending,
}: TaskAccessSummaryProps) {
  const access = canManage
    ? {
        label: 'Manager access',
        description: 'You can read, move, and remove every task in this workspace.',
      }
    : canCreate || canUpdateOwn
      ? {
          label: 'Contributor access',
          description: 'You can create, read, and move only tasks stamped to your current membership.',
        }
      : {
          label: 'Viewer access',
          description: 'You can read this workspace in realtime without changing its tasks.',
        };
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-medium">{access.label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{access.description}</p>
      </div>
      <Badge variant="outline" className="w-fit shrink-0">
        {resourceActionPending
          ? 'Resource mutation in flight'
          : pendingMutations > 0
            ? `${pendingMutations} queued Sync mutation${pendingMutations === 1 ? '' : 's'}`
            : 'Sync queue clear'}
      </Badge>
    </div>
  );
}

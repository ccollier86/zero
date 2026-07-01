'use client';

/**
 * launchboard-page.tsx
 *
 * LaunchBoard board surface. This file owns the Kanban page body only; route
 * shell, navigation, data subscriptions, and modal workflows are provided by
 * the LaunchBoard layout context.
 */

import {
  Badge,
  Button,
  KanbanBoard,
  type KanbanItemMove,
} from '@zero/framework/react';
import { Plus } from '@zero/framework/icons';

import { LaunchBoardColumnHeader } from './launchboard-column-header';
import type {
  LaunchCard,
  LaunchColumn,
} from './types';
import { useLaunchBoardContext } from './launchboard-context';
import type { LaunchBoardData } from './use-launchboard-data';
import type { LaunchBoardModalActions } from './use-launchboard-modals';

/** Main LaunchBoard route component. */
export function LaunchBoardPage() {
  const { data, dialogs } = useLaunchBoardContext();

  return <LaunchBoardContent data={data} dialogs={dialogs} />;
}

function LaunchBoardContent({
  data,
  dialogs,
}: {
  data: LaunchBoardData;
  dialogs: LaunchBoardModalActions;
}) {
  if (!data.categories.length) {
    return (
      <LaunchBoardEmptyState
        title="No categories"
        description="Create a category to start grouping boards."
        actionLabel="Add category"
        onAction={dialogs.openCreateCategory}
      />
    );
  }

  if (data.activeCategory && !data.activeBoard) {
    return (
      <LaunchBoardEmptyState
        title="No boards in this category"
        description="Add a board to create lanes and cards."
        actionLabel="Add board"
        onAction={() => dialogs.openCreateBoard(data.activeCategory!.category_id)}
      />
    );
  }

  if (!data.activeBoard) {
    return (
      <LaunchBoardEmptyState
        title="Select a board"
        description="Use the sidebar to choose a category and board."
      />
    );
  }

  if (!data.activeColumns.length) {
    return (
      <LaunchBoardEmptyState
        title="No columns"
        description="Add a lane before creating cards."
        actionLabel="Add column"
        onAction={() => dialogs.openCreateColumn(data.activeBoard!.board_id)}
      />
    );
  }

  return (
    <div className="min-h-0 flex-1">
      <KanbanBoard
        columns={data.activeColumns}
        items={data.activeCards}
        getColumnId={(column) => column.column_id}
        getColumnTitle={(column) => column.title}
        getColumnAccentClassName={(column) => column.accent}
        getItemId={(card) => card.card_id}
        getItemColumnId={(card) => card.column_id}
        getItemTitle={(card) => card.title}
        getItemDescription={(card) => card.description}
        getItemBadge={(card) => priorityLabel(card.priority)}
        getItemBadgeVariant={(card) =>
          card.priority === 'high'
            ? 'destructive'
            : card.priority === 'medium'
              ? 'default'
              : 'secondary'
        }
        emptyColumnText="Drop a card here"
        onItemClick={(card) => dialogs.openEditCard(card)}
        onItemMove={(move: KanbanItemMove<LaunchColumn, LaunchCard>) => data.moveCard(move)}
        renderColumnHeader={({ column, itemCount }) => (
          <LaunchBoardColumnHeader
            column={column}
            itemCount={itemCount}
            canDelete={data.canDeleteColumn}
            onEdit={dialogs.openEditColumn}
            onDelete={(target) => void dialogs.confirmDeleteColumn(target)}
          />
        )}
        className="min-h-[calc(100vh-10rem)]"
        boardClassName="min-h-[calc(100vh-12rem)]"
      />
    </div>
  );
}

function LaunchBoardEmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="grid min-h-[28rem] place-items-center rounded-lg border border-dashed border-border/80 bg-muted/25 p-8 text-center">
      <div className="max-w-sm space-y-4">
        <Badge variant="outline">LaunchBoard</Badge>
        <div className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {actionLabel && onAction ? (
          <Button type="button" onClick={onAction}>
            <Plus className="size-4" />
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function priorityLabel(priority: LaunchCard['priority']): string {
  return priority[0]!.toUpperCase() + priority.slice(1);
}

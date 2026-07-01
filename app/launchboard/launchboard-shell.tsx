'use client';

/**
 * launchboard-shell.tsx
 *
 * LaunchBoard AppShell composition. This file owns route chrome, sidebar
 * navigation, workspace actions, breadcrumbs, and header controls; board
 * rendering stays in launchboard-page.tsx.
 */

import * as React from 'react';
import {
  AppShell,
  Button,
  type AppShellMenuItem,
  type AppShellNavGroup,
  type AppShellWorkspaceConfig,
} from '@zero/framework/react';
import { Plus, Wifi } from '@zero/framework/icons';

import {
  LaunchBoardProvider,
  useLaunchBoardContext,
} from './launchboard-context';
import type { LaunchBoard, LaunchCategory } from './types';
import type { LaunchBoardData } from './use-launchboard-data';
import type { LaunchBoardModalActions } from './use-launchboard-modals';

export interface LaunchBoardShellProps {
  children: React.ReactNode;
}

/**
 * Render the LaunchBoard route branch inside Zero's default AppShell.
 *
 * Route groups keep this shell at `/` without moving dashboard chrome into the
 * root provider layout.
 */
export function LaunchBoardShell({ children }: LaunchBoardShellProps) {
  return (
    <LaunchBoardProvider>
      <LaunchBoardShellFrame>{children}</LaunchBoardShellFrame>
    </LaunchBoardProvider>
  );
}

function LaunchBoardShellFrame({ children }: LaunchBoardShellProps) {
  const { data, dialogs } = useLaunchBoardContext();

  const workspaceConfig = React.useMemo<AppShellWorkspaceConfig>(() => ({
    activeId: data.activeCategoryId ?? undefined,
    label: 'Categories',
    createLabel: 'Add category',
    items: data.categories.map((category, index) => ({
      id: category.category_id,
      name: category.name,
      subtitle: formatCount(data.boardCountByCategory[category.category_id] ?? 0, 'board'),
      icon: 'layers',
      logo: <span className={`size-3 rounded-full ${category.color}`} aria-hidden="true" />,
      shortcut: `⌘${index + 1}`,
    })),
    activeActions: buildCategoryActions(data.activeCategory, data.canDeleteActiveCategory, dialogs),
    onCreate: dialogs.openCreateCategory,
    onSelect: (workspace) => data.selectCategory(workspace.id),
  }), [
    data.activeCategory,
    data.activeCategoryId,
    data.boardCountByCategory,
    data.canDeleteActiveCategory,
    data.categories,
    data.selectCategory,
    dialogs,
  ]);

  const nav = React.useMemo<AppShellNavGroup[]>(() => [
    {
      id: 'boards',
      label: 'Boards',
      items: [
        ...data.boardsForActiveCategory.map((board) =>
          buildBoardNavItem(board, data, dialogs),
        ),
        data.activeCategory
          ? {
              id: 'add-board',
              label: 'Add board',
              icon: 'plus' as const,
              variant: 'action' as const,
              onSelect: () => dialogs.openCreateBoard(data.activeCategory!.category_id),
            }
          : null,
      ].filter((item): item is AppShellNavGroup['items'][number] => Boolean(item)),
    },
  ], [data, dialogs]);

  const headerActions = data.activeBoard ? (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => dialogs.openCreateColumn(data.activeBoard!.board_id)}
      >
        <Plus className="size-4" />
        Column
      </Button>
      <Button
        type="button"
        disabled={!data.activeColumns.length}
        onClick={() => dialogs.openCreateCard(data.activeBoard!.board_id, data.activeColumns[0]?.column_id)}
      >
        <Plus className="size-4" />
        Card
      </Button>
    </div>
  ) : null;

  return (
    <AppShell
      brand={{
        name: 'LaunchBoard',
        subtitle: 'Zero ReactiveDB',
        icon: 'clipboard',
      }}
      workspaces={workspaceConfig}
      nav={nav}
      breadcrumbs={[
        { label: data.activeCategory?.name ?? 'Categories' },
        { label: data.activeBoard?.name ?? 'Boards' },
      ]}
      header={{
        title: data.activeBoard?.name ?? 'Select a board',
        subtitle: data.activeBoard?.description ?? 'Categories and boards are synced through Zero ReactiveDB.',
        actions: headerActions,
        themeToggle: true,
      }}
      footer={<LaunchBoardSyncStatus connected={data.connected} />}
      contentClassName="min-h-0"
    >
      {children}
    </AppShell>
  );
}

function buildCategoryActions(
  category: LaunchCategory | null,
  canDelete: boolean,
  dialogs: LaunchBoardModalActions,
): AppShellMenuItem[] {
  if (!category) return [];

  return [
    {
      id: 'edit-category',
      label: 'Edit category',
      icon: 'settings',
      onSelect: () => dialogs.openEditCategory(category),
    },
    { type: 'separator', id: 'category-actions-separator' },
    {
      id: 'delete-category',
      label: 'Delete category',
      icon: 'trash',
      destructive: true,
      disabled: !canDelete,
      onSelect: () => void dialogs.confirmDeleteCategory(category),
    },
  ];
}

function buildBoardNavItem(
  board: LaunchBoard,
  data: LaunchBoardData,
  dialogs: LaunchBoardModalActions,
): AppShellNavGroup['items'][number] {
  const active = board.board_id === data.activeBoardId;

  return {
    id: board.board_id,
    label: board.name,
    icon: 'clipboard',
    active,
    defaultOpen: active,
    onSelect: () => data.selectBoard(board.board_id),
    children: active
      ? data.activeColumns.map((column) => ({
          id: column.column_id,
          label: column.title,
          icon: 'list' as const,
          badge: data.cardCountByColumn[column.column_id] ?? 0,
          onSelect: () => data.selectBoard(board.board_id),
        }))
      : undefined,
    actions: [
      {
        id: `${board.board_id}-edit`,
        label: 'Edit board',
        icon: 'settings',
        onSelect: () => dialogs.openEditBoard(board),
      },
      {
        id: `${board.board_id}-duplicate`,
        label: 'Duplicate board',
        icon: 'copy',
        onSelect: () => dialogs.duplicateBoard(board),
      },
      { type: 'separator', id: `${board.board_id}-separator` },
      {
        id: `${board.board_id}-delete`,
        label: 'Delete board',
        icon: 'trash',
        destructive: true,
        onSelect: () => void dialogs.confirmDeleteBoard(board),
      },
    ],
  };
}

function LaunchBoardSyncStatus({ connected }: { connected: boolean }) {
  return (
    <div className="mx-2 mb-1 flex items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/45 px-2.5 py-2 text-xs text-sidebar-foreground/80 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2">
      <Wifi className="size-4 shrink-0" />
      <span className="min-w-0 truncate group-data-[collapsible=icon]:hidden">
        {connected ? 'ReactiveDB connected' : 'Connecting'}
      </span>
    </div>
  );
}

function formatCount(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

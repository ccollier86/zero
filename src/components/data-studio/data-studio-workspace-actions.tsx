'use client';

/** Compose selection/capability-aware Studio operations in Zero's anchored action bar. */
import { Archive, Columns3, PanelRightOpen, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type { DataStudioAccess, UseDataStudioResult } from '../../frontend/client/data-studio-hooks';
import { RecordNavigationBar, type NavigationAction } from '../ui/record-navigation-bar';

export interface DataStudioWorkspaceActionsProps {
  controller: UseDataStudioResult;
  access: DataStudioAccess;
  onAddRecord: () => void;
  onAddColumn: () => void;
  onEditSchema: () => void;
  onInspect: () => void;
  onDeleteRecord: () => void;
  onChangeStatus: () => void;
}

export function DataStudioWorkspaceActions({ controller: c, access, ...actions }: DataStudioWorkspaceActionsProps) {
  const active = c.selectedTable?.status === 'active';
  const disabled = c.isMutating || c.rowsNeedRefresh;
  const columnLimitReached = !!c.selectedTable && c.selectedTable.schema.columns.length >= (c.capabilities?.limits.maxColumns ?? 128);
  const items: NavigationAction[] = [];
  if (c.selectedRow) items.push({ icon: <PanelRightOpen />, label: 'Inspect record', onClick: actions.onInspect });
  if (access.canManage && c.selectedTable) {
    if (active) items.push({ icon: <Plus />, label: 'Add column', disabled: disabled || columnLimitReached, onClick: actions.onAddColumn });
    items.push({ icon: <Columns3 />, label: 'Edit schema', disabled: disabled || !active, onClick: actions.onEditSchema });
    items.push({ icon: active ? <Archive /> : <RotateCcw />, label: active ? 'Archive table' : 'Restore table',
      variant: active ? 'warning' : 'default', disabled: c.isMutating, onClick: actions.onChangeStatus });
  }
  if (access.canWrite && active && c.selectedRow) items.push({ icon: <Trash2 />, label: 'Delete record',
    variant: 'destructive', disabled, onClick: actions.onDeleteRecord });
  return <RecordNavigationBar
    className="min-w-0"
    currentIndex={Math.max(0, c.selectedRowIndex)} totalCount={c.rows.length}
    showNavigation={c.selectedRow !== null}
    status={<span className="text-xs text-muted-foreground tabular-nums">{c.rows.length} loaded{c.totalRows !== c.rows.length ? ` · ${c.totalRows} matching` : ''}{c.isLoadingRows ? ' · Refreshing…' : ''}</span>}
    onPrevious={c.selectPreviousRow} onNext={c.selectNextRow} actions={items}
    primaryAction={access.canWrite && active && c.selectedTable!.schema.columns.length > 0 ? {
      label: 'Add record', ariaHasPopup: 'dialog', disabled, onClick: actions.onAddRecord,
    } : undefined}
  />;
}

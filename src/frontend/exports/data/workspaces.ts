/** Data table, data studio and Kanban composition. Curated client-safe re-exports only; implementation/context ownership stays with the existing modules. */

// ─── Data Table ─────────────────────────────────────────────────────────
export { DataTable, DataTableView } from '../../../components/data-table';
export { useDataTable, useDataTableSource, buildDataTableLazyQuery } from '../../../components/data-table';
export { DataTableColumnHeader } from '../../../components/data-table';
export { DataTableToolbar } from '../../../components/data-table';
export { DataTableControls } from '../../../components/data-table';
export { DataTableSearch } from '../../../components/data-table';
export { DataTablePagination } from '../../../components/data-table';
export { DATA_TABLE_MOTION, DataTableNewRecordsButton } from '../../../components/data-table';
export { DataTableRowActions } from '../../../components/data-table';
export {
  DataTableBulkActions,
  DataTableServerSourceError,
  createDataTableApiAdapter,
  buildDataTableServerQuery,
  useDataTableMutationRunner,
} from '../../../components/data-table';
export type {
  DataTableCellContext,
  DataTableColumnOverride,
  DataTableColumnOverrides,
  DataTableFilters,
  DataTableFilterValue,
  DataTableInitialState,
  DataTableState,
  DataTablePaginationProps,
  DataTableServerAdapter,
  DataTableServerChange,
  DataTableNewRecordsButtonProps,
  DataTableServerAdapterContext,
  DataTableServerCursorPage,
  DataTableServerOffsetPage,
  DataTableServerPage,
  DataTableServerPaginationMode,
  DataTableServerQuery,
  DataTableServerResult,
  DataTableServerSource,
  DataTableServerSourceErrorCode,
  DataTableBulkAction,
  DataTableBulkActionsProps,
  DataTablePageBulkSelection,
  DataTableAllMatchingBulkSelection,
  DataTableMutationContext,
  DataTableMutationRunner,
  DataTableProps,
  DataTableSearchOptions,
  DataTableSearchProps,
  DataTableSource,
  DataTableSourceActions,
  DataTableSourceState,
  DataTableToolbarContext,
  DataTableControlsProps,
  DataTableToolbarProps,
  DataTableToolbarSlot,
  DataTableToolbarSlots,
  RowAction,
  UseDataTableOptions,
  UseDataTableReturn,
  UseDataTableSourceOptions,
} from '../../../components/data-table';

// ─── Data Studio ────────────────────────────────────────────────────────
export {
  DataStudio,
  DataStudioFilterControl,
  DataStudioGrid,
  DataStudioInlineCell,
  DataStudioInspector,
  DataStudioToolbar,
  DataStudioWorkspace,
  resolveDataStudioCellKeyAction,
} from '../../../components/data-studio';
export type {
  DataStudioCellKeyAction,
  DataStudioCellSaveState,
  DataStudioFilterControlProps,
  DataStudioGridProps,
  DataStudioInlineCellProps,
  DataStudioInspectorProps,
  DataStudioProps,
  DataStudioToolbarProps,
  DataStudioWorkspaceProps,
} from '../../../components/data-studio';

// ─── Kanban Board ──────────────────────────────────────────────────────
export {
  KanbanBoard,
  KanbanTaskCard,
  groupKanbanItemIds,
  projectKanbanMove,
} from '../../../components/kanban';
export type {
  KanbanBoardProps,
  KanbanItemMove,
  KanbanTaskCardProps,
  KanbanTarget,
  ProjectKanbanMoveInput,
  ProjectKanbanMoveResult,
} from '../../../components/kanban';

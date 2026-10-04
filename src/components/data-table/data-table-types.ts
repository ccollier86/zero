/** Public composition options; transport and controller types live in their own modules. */

import type * as React from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { Row } from '../../sync/types';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';
import type { DataTableFilters, DataTableSource } from './data-table-source';
import type { DataTableColumnOverrides } from './use-data-table';
import type { DataTableInitialState, DataTableState } from './data-table-state';
import type { DataTableSearchOptions } from './data-table-search';
import type { DataTableToolbarSlot, DataTableToolbarSlots } from './data-table-toolbar';
import type { RowAction } from './data-table-row-actions';
import type { DataTableMutationContext } from './data-table-mutation';
import type { DataTableBulkAction } from './data-table-bulk-actions';

export interface DataTableProps<T extends Row = Row> {
  schema: SchemaDescriptor;
  /** Overrides legacy data/collection props. Server sources own query execution. */
  source?: DataTableSource<T>;
  data?: T[];
  collection?: string;
  lazy?: boolean;
  filters?: DataTableFilters;
  lazyOptions?: LazyCollectionOptions;
  columns?: string[];
  primaryKey?: string;
  editable?: string[];
  columnOverrides?: DataTableColumnOverrides<T>;
  /** Fixed layout keeps flexible, truncated cells from resizing neighboring columns. */
  tableLayout?: 'auto' | 'fixed';
  actions?: RowAction<T>[];
  /** Targets explicit selection on the current page, never every server match implicitly. */
  bulkActions?: DataTableBulkAction<T>[];
  searchable?: boolean | DataTableSearchOptions;
  sortable?: boolean;
  filterable?: boolean;
  filterColumns?: string[];
  paginated?: boolean | { pageSize?: number };
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  /** Legacy edit notification after the source write; acts as writer for array sources. */
  onCellEdit?: (rowId: string, columnId: string, value: unknown, context?: DataTableMutationContext) => void | Promise<void>;
  /** Custom authoritative writer that replaces, rather than duplicates, the source update. */
  onCellCommit?: (rowId: string, columnId: string, value: unknown, context?: DataTableMutationContext) => void | Promise<void>;
  onRowClick?: (row: T) => void;
  onRowDoubleClick?: (row: T) => void;
  highlightedRowId?: string;
  initialState?: DataTableInitialState;
  /** Control only needed facets; other facets remain internal. */
  state?: Partial<DataTableState>;
  onStateChange?: (state: DataTableState) => void;
  toolbarActions?: DataTableToolbarSlot<T>;
  toolbarSlots?: DataTableToolbarSlots<T>;
  toolbarLabel?: string;
  toolbarClassName?: string;
  showToolbar?: boolean;
  exportFilename?: string;
  showExport?: boolean;
  showColumnVisibility?: boolean;
  emptyState?: React.ReactNode;
  loadingState?: React.ReactNode;
  errorState?: (error: Error | string, retry: () => void) => React.ReactNode;
  getRowClassName?: (row: T) => string | undefined;
  className?: string;
}

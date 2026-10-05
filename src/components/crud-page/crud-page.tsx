'use client';

/**
 * Composes schema-backed CRUD table/detail layouts. Source actions and the
 * shared mutation runner own acknowledged writes, cancellation and failures;
 * this component owns forms, action placement and accepted UI effects only.
 */

import { createElement, useCallback, useMemo } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { Row } from '../../sync/types';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { ResourceFieldAccess } from '../../resources/resource-field-access';
import type { RowAction } from '../data-table/data-table-row-actions';
import type {
  NavigationAction,
  RecordPrimaryAction,
} from '../ui/record-navigation-bar';
import type { LazyCollectionOptions } from '../../frontend/client/data-hooks';
import { useDataTableSource, type DataTableSourceActions } from '../data-table/data-table-source';
import { invokeDataTableSourceWrite } from '../data-table/data-table-source-action-guard';
import { mutationCancelledError } from '../data-table/use-data-table-mutation';
import { useCrudMutation, type CrudMutationRunner } from './use-crud-mutation';
import { DataTable } from '../data-table';
import type {
  DataTableSearchOptions,
  DataTableToolbarSlots,
} from '../data-table';
import {
  ensureRowPrimaryKey,
  getSchemaPrimaryKey,
  requireRowPrimaryKey,
  stripRowPrimaryKey,
} from '../data-table/row-identity';
import { MasterDetailPage } from '../master-detail';
import { AutoForm } from '../forms';
import { modals } from '../../modals';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface FieldOverrides {
  autoFocus?: boolean;
  hidden?: boolean;
  useSwitch?: boolean;
}

export interface CrudPageProps<T extends Row = Row> {
  /** Table name for the reactive collection. */
  table: string;
  /** Schema descriptor from defineTable().schema — provides field metadata. */
  schema: SchemaDescriptor;
  /** Which field names to show as columns in the list/table. */
  columns: string[];
  /** Primary key override. Defaults to `schema.primaryKey`. */
  primaryKey?: string;
  /** Shared defineResourceFields() contract for safe columns and forms. */
  resourceFields?: ResourceFieldAccess;

  // ── Layout ──────────────────────────────────────────────────
  /**
   * Layout mode.
   * - `'table'` (default): Full-width DataTable with modal-based create/edit.
   * - `'master-detail'`: Split-panel list + detail sidebar with inline editing.
   */
  layout?: 'table' | 'master-detail';

  // ── Sync mode ─────────────────────────────────────────────
  /** Use lazy-synced data (REST fetch on mount). Default: false. */
  lazy?: boolean;
  /** Filters for lazy collection fetch. Only used when lazy=true. */
  filters?: Record<string, string>;
  /** Sorting and pagination options for lazy `/api/data` fetches. */
  lazyOptions?: LazyCollectionOptions;

  // ── Create/Edit form ──────────────────────────────────────
  /** Field overrides for the create form. */
  createFields?: Record<string, FieldOverrides>;
  /** Field overrides for the edit form (table layout) or detail form (master-detail). */
  editFields?: Record<string, FieldOverrides>;
  /** Editable field names for master-detail inline form. Defaults to all schema fields. */
  editableFields?: string[];
  /** Number of form columns. Default: 2. */
  formColumns?: number;

  // ── Labels ────────────────────────────────────────────────
  /** Page title rendered above the table. */
  title?: string;
  /** Label for the create button. Default: 'Create'. */
  createLabel?: string;
  /** Custom empty state content. */
  emptyState?: ReactNode;

  // ── Table features ────────────────────────────────────────
  searchable?: boolean | DataTableSearchOptions;
  /** Controls and actions inserted into the generated table toolbar. */
  tableToolbarSlots?: DataTableToolbarSlots<T>;
  /** Accessible name for the generated table toolbar control group. */
  tableToolbarLabel?: string;
  sortable?: boolean;
  paginated?: boolean | { pageSize?: number };

  // ── Callbacks ─────────────────────────────────────────────
  /** Called when a row is clicked (table layout) or selected (master-detail). */
  onRowClick?: (row: T) => void;
  /** Transform data before insert. */
  onBeforeCreate?: (data: T) => T;
  /** Transform data before update. */
  onBeforeUpdate?: (id: string, data: Partial<T>) => Partial<T>;
  /** Called after successful create. */
  onAfterCreate?: (row: T) => void;
  /** Called after successful delete. */
  onAfterDelete?: (id: string) => void;

  // ── Customization (shared) ────────────────────────────────
  /** Additional row actions (merged with default edit/delete). */
  rowActions?: RowAction<T>[];
  /** Hide the create button. */
  hideCreate?: boolean;
  /** Hide the edit action (table layout row action). */
  hideEdit?: boolean;
  /** Hide the delete action. */
  hideDelete?: boolean;
  /** Modal size for create/edit forms. Default: 'lg'. */
  modalSize?: 'sm' | 'md' | 'lg' | 'xl';
  /** Extra content rendered in the toolbar (next to create button). */
  toolbar?: ReactNode;

  // ── Master-detail specific ────────────────────────────────
  /** Custom header component in the detail panel (e.g., avatar, badges). */
  detailHeader?: ComponentType<{ item: T }>;
  /** Content rendered below the detail form (e.g., sub-sections like notes, sessions). */
  detailFooter?: ReactNode | ((item: T | null) => ReactNode);
  /** Navigation bar action buttons for the selected record. */
  navigationActions?: (item: T | null) => NavigationAction[];
  /** Primary action button in the navigation bar. */
  primaryAction?: RecordPrimaryAction;
  /** Detail panel submit label. Default: 'Save Changes'. */
  submitLabel?: string;
  /** Width of the list panel. Default: '3fr'. */
  listWidth?: string;
  /** Width of the detail panel. Default: '2fr'. */
  detailWidth?: string;

  className?: string;
}

// ─── Entry Point ────────────────────────────────────────────────────────────

/**
 * Full CRUD interface from a schema definition.
 *
 * Two layout modes:
 * - `layout="table"` (default): DataTable + modal create/edit/delete.
 * - `layout="master-detail"`: Split-panel list + inline detail editing.
 *
 * @example
 * ```tsx
 * // Simple table CRUD
 * <CrudPage table="programs" schema={programTable.schema} columns={['name', 'active']} lazy />
 *
 * // Rich master-detail
 * <CrudPage
 *   table="clients"
 *   schema={clientTable.schema}
 *   columns={['first_name', 'last_name', 'status']}
 *   layout="master-detail"
 *   detailHeader={ClientHeader}
 *   detailFooter={(item) => item && <ClientSections clientId={item.id} />}
 *   lazy
 * />
 * ```
 */
export function CrudPage<T extends Row = Row>(props: CrudPageProps<T>) {
  const result = useDataTableSource<T>({
    collection: props.table,
    lazy: props.lazy,
    filters: props.filters,
    lazyOptions: props.lazyOptions,
  });
  return createElement(CrudPageCore<T>, {
    ...props,
    data: result.data,
    actions: result.actions,
    isLoading: result.isLoading,
    error: result.error ? (result.error instanceof Error ? result.error : new Error(result.error)) : null,
  });
}

// ─── Core ───────────────────────────────────────────────────────────────────

interface CrudPageCoreProps<T extends Row> extends CrudPageProps<T> {
  data: T[];
  actions: DataTableSourceActions<T> | null;
  isLoading: boolean;
  error: Error | null;
}

function CrudError({ error }: { error: Error }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {error.message}
    </div>
  );
}

function CrudPageCore<T extends Row = Row>(props: CrudPageCoreProps<T>) {
  const layout = props.layout ?? 'table';
  const mutation = useCrudMutation(JSON.stringify([props.table, layout]));

  if (layout === 'master-detail') {
    return createElement(MasterDetailLayout<T>, { ...props, mutation });
  }
  return createElement(TableLayout<T>, { ...props, mutation });
}

// ─── Table Layout ───────────────────────────────────────────────────────────

function TableLayout<T extends Row = Row>({
  table,
  schema,
  columns,
  primaryKey: primaryKeyOverride,
  resourceFields,
  data,
  actions,
  mutation,
  isLoading,
  error,
  title,
  createLabel = 'Create',
  emptyState,
  createFields,
  editFields,
  formColumns = 2,
  searchable,
  tableToolbarSlots,
  tableToolbarLabel,
  sortable,
  paginated,
  onRowClick,
  onBeforeCreate,
  onBeforeUpdate,
  onAfterCreate,
  onAfterDelete,
  rowActions,
  hideCreate,
  hideEdit,
  hideDelete,
  modalSize = 'lg',
  toolbar,
  className,
}: CrudPageCoreProps<T> & { mutation: CrudMutationRunner }) {
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);

  const openCreateModal = useCallback(() => {
    const modalId = modals.open({
      title: createLabel,
      size: modalSize,
      content: createElement(AutoForm<T>, {
        schema,
        mode: 'create',
        columns: formColumns,
        fields: createFields,
        includeFields: resourceFields?.create,
        submitLabel: createLabel,
        onSubmit: async (formData: T) => {
          let row!: T;
          await mutation.run(JSON.stringify(['create', modalId]), ({ signal }) => {
            const draft = onBeforeCreate ? onBeforeCreate(formData) : formData;
            row = ensureRowPrimaryKey(draft, primaryKey, { table, identity: schema.identity });
            return invokeDataTableSourceWrite('insert', true, actions ? () => actions.insert(row, { signal }) : undefined);
          },
          () => {
            toast.success(`${createLabel} successful`);
            try { onAfterCreate?.(row); }
            finally { modals.close(modalId); }
          });
        },
      }),
    });
  }, [table, schema, createLabel, modalSize, formColumns, createFields, resourceFields, actions, mutation, onBeforeCreate, onAfterCreate, primaryKey]);

  const openEditModal = useCallback((row: T) => {
    const rowId = requireRowPrimaryKey(row, primaryKey);
    const modalId = modals.open({
      title: 'Edit',
      size: modalSize,
      content: createElement(AutoForm<T>, {
        schema,
        mode: 'edit',
        defaultValues: row,
        columns: formColumns,
        fields: editFields,
        includeFields: resourceFields?.update,
        submitLabel: 'Save',
        onSubmit: async (formData: T) => {
          const id = rowId;
          await mutation.run(JSON.stringify(['edit', modalId]), ({ signal }) => {
            const updateData = stripRowPrimaryKey(formData as Partial<T>, primaryKey);
            const changes = onBeforeUpdate ? onBeforeUpdate(id, updateData) : updateData;
            return invokeDataTableSourceWrite('update', true, actions ? () => actions.update(id, stripRowPrimaryKey(changes, primaryKey), { signal }) : undefined);
          },
          () => {
            toast.success('Updated successfully');
            modals.close(modalId);
          });
        },
      }),
    });
  }, [schema, modalSize, formColumns, editFields, resourceFields, actions, mutation, onBeforeUpdate, primaryKey]);

  const handleDelete = useCallback(async (row: T) => {
    const id = requireRowPrimaryKey(row, primaryKey);
    try {
      await mutation.run(JSON.stringify(['delete', id]), async ({ signal }) => {
        const confirmed = await modals.confirm({
          title: 'Delete record?', description: 'This action cannot be undone.',
          variant: 'destructive', holdToConfirm: true,
        });
        if (!confirmed || signal.aborted) throw mutationCancelledError();
        await invokeDataTableSourceWrite('remove', true, actions ? () => actions.remove(id, { signal }) : undefined);
      }, () => {
        toast.success('Deleted successfully');
        onAfterDelete?.(id);
      });
    } catch {
      // The shared runner owns safe errors, observability and cancellation.
    }
  }, [actions, mutation, onAfterDelete, primaryKey]);

  const allActions = useMemo((): RowAction<T>[] => {
    const defaults: RowAction<T>[] = [];
    if (!hideEdit) {
      defaults.push({ label: 'Edit', icon: Pencil, onClick: openEditModal });
    }
    if (!hideDelete) {
      defaults.push({ label: 'Delete', icon: Trash2, onClick: handleDelete, variant: 'destructive' });
    }
    return [...defaults, ...(rowActions ?? [])];
  }, [hideEdit, hideDelete, openEditModal, handleDelete, rowActions]);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between">
        {title && <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>}
        <div className="flex items-center gap-2 ml-auto">
          {toolbar}
          {!hideCreate && (
            <Button onClick={openCreateModal} size="sm">
              <Plus className="mr-1 size-4" />
              {createLabel}
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : error ? (
        <CrudError error={error} />
      ) : data.length === 0 && emptyState ? (
        emptyState
      ) : (
        <DataTable<T>
          schema={schema}
          data={data}
          columns={resourceFields
            ? columns.filter((column) => resourceFields.read.includes(column))
            : columns}
          primaryKey={primaryKey}
          actions={allActions}
          searchable={searchable}
          toolbarSlots={tableToolbarSlots}
          toolbarLabel={tableToolbarLabel}
          sortable={sortable}
          paginated={paginated}
          onRowClick={onRowClick}
        />
      )}
    </div>
  );
}

// ─── Master-Detail Layout ───────────────────────────────────────────────────

function MasterDetailLayout<T extends Row = Row>({
  table,
  schema,
  columns,
  primaryKey: primaryKeyOverride,
  resourceFields,
  data,
  actions,
  mutation,
  isLoading,
  error,
  title,
  createLabel = 'Create',
  emptyState,
  createFields,
  editableFields,
  formColumns = 2,
  searchable = true,
  tableToolbarSlots,
  tableToolbarLabel,
  sortable = true,
  paginated,
  onRowClick,
  onBeforeCreate,
  onBeforeUpdate,
  onAfterCreate,
  onAfterDelete,
  hideCreate,
  hideDelete,
  modalSize = 'lg',
  toolbar,
  detailHeader,
  detailFooter,
  navigationActions,
  primaryAction,
  submitLabel = 'Save Changes',
  listWidth,
  detailWidth,
  className,
}: CrudPageCoreProps<T> & { mutation: CrudMutationRunner }) {
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);

  const openCreateModal = useCallback(() => {
    const modalId = modals.open({
      title: createLabel,
      size: modalSize,
      content: createElement(AutoForm<T>, {
        schema,
        mode: 'create',
        columns: formColumns,
        fields: createFields,
        includeFields: resourceFields?.create,
        submitLabel: createLabel,
        onSubmit: async (formData: T) => {
          let row!: T;
          await mutation.run(JSON.stringify(['create', modalId]), ({ signal }) => {
            const draft = onBeforeCreate ? onBeforeCreate(formData) : formData;
            row = ensureRowPrimaryKey(draft, primaryKey, { table, identity: schema.identity });
            return invokeDataTableSourceWrite('insert', true, actions ? () => actions.insert(row, { signal }) : undefined);
          },
          () => {
            toast.success(`${createLabel} successful`);
            try { onAfterCreate?.(row); }
            finally { modals.close(modalId); }
          });
        },
      }),
    });
  }, [table, schema, createLabel, modalSize, formColumns, createFields, resourceFields, actions, mutation, onBeforeCreate, onAfterCreate, primaryKey]);

  const handleUpdate = useCallback(async (id: string, changes: Partial<T>) => {
    await mutation.run(JSON.stringify(['detail-update', id]), ({ signal }) => {
      const updateData = stripRowPrimaryKey(changes, primaryKey);
      const final = onBeforeUpdate ? onBeforeUpdate(id, updateData) : updateData;
      return invokeDataTableSourceWrite('update', true, actions ? () => actions.update(id, stripRowPrimaryKey(final, primaryKey), { signal }) : undefined);
    },
    () => toast.success('Updated successfully'));
  }, [actions, mutation, onBeforeUpdate, primaryKey]);

  // Build navigation actions — inject delete if not hidden
  const navActions = useCallback((item: T | null) => {
    const custom = navigationActions?.(item) ?? [];
    if (hideDelete || !item) return custom;
    return [
      ...custom,
      {
        label: 'Delete',
        icon: createElement(Trash2, { className: 'size-4' }),
        variant: 'destructive' as const,
        disabled: mutation.isPending(JSON.stringify(['delete', requireRowPrimaryKey(item, primaryKey)])),
        onClick: async () => {
          const id = requireRowPrimaryKey(item, primaryKey);
          try {
            await mutation.run(JSON.stringify(['delete', id]), async ({ signal }) => {
              const confirmed = await modals.confirm({
                title: 'Delete record?', description: 'This action cannot be undone.',
                variant: 'destructive', holdToConfirm: true,
              });
              if (!confirmed || signal.aborted) throw mutationCancelledError();
              await invokeDataTableSourceWrite('remove', true, actions ? () => actions.remove(id, { signal }) : undefined);
            }, () => {
              toast.success('Deleted successfully');
              onAfterDelete?.(id);
            });
          } catch {
            // The shared runner owns safe errors, observability and cancellation.
          }
        },
      },
    ];
  }, [navigationActions, hideDelete, actions, mutation, onAfterDelete, primaryKey]);

  // Build primary action — default to create button if not provided and not hidden
  const resolvedPrimaryAction = primaryAction ?? (!hideCreate ? {
    label: createLabel,
    ariaHasPopup: 'dialog' as const,
    onClick: openCreateModal,
  } : undefined);

  if (isLoading) {
    return (
      <div className={cn('space-y-2', className)}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('space-y-2', className)}>
        <CrudError error={error} />
      </div>
    );
  }

  return (
    <div className={cn('h-full', className)}>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
        </div>
      )}
      <MasterDetailPage<T>
        schema={schema}
        data={data}
        listColumns={resourceFields
          ? columns.filter((column) => resourceFields.read.includes(column))
          : columns}
        primaryKey={primaryKey}
        editableFields={resourceFields
          ? (editableFields ?? resourceFields.update)
            .filter((field) => resourceFields.update.includes(field))
          : editableFields}
        detailHeader={detailHeader}
        emptyState={emptyState}
        detailFooter={detailFooter}
        navigationActions={navActions}
        primaryAction={resolvedPrimaryAction}
        onSelect={onRowClick}
        onUpdate={handleUpdate}
        searchable={searchable}
        tableToolbarSlots={tableToolbarSlots}
        tableToolbarLabel={tableToolbarLabel}
        sortable={sortable}
        paginated={paginated}
        formColumns={formColumns}
        submitLabel={submitLabel}
        listWidth={listWidth}
        detailWidth={detailWidth}
      />
    </div>
  );
}

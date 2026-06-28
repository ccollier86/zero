'use client';

import * as React from 'react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { Row } from '../../sync/types';
import { DataTable } from '@/components/data-table';
import { getSchemaPrimaryKey, requireRowPrimaryKey } from '../data-table/row-identity';
import { AutoForm } from '../../components/forms';
import { ListDetailLayout } from '@/components/ui/list-detail-layout';
import { DetailPanel } from '@/components/ui/detail-panel';
import {
  RecordNavigationBar,
  type NavigationAction,
} from '@/components/ui/record-navigation-bar';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MasterDetailPageProps<T extends Row = Row> {
  // ── Schema & column config ──────────────────────────────────────
  /** Schema defining all fields for table + form generation. */
  schema: SchemaDescriptor;
  /** Field names shown as columns in the list table. */
  listColumns: string[];
  /** Primary key override. Defaults to `schema.primaryKey`. */
  primaryKey?: string;
  /** Field names editable in the detail form. Defaults to all schema fields. */
  editableFields?: string[];

  // ── Data source ─────────────────────────────────────────────────
  /** Static data array. */
  data?: T[];
  /** Collection name for live reactive data (overrides `data`). */
  collection?: string;

  // ── Detail header ───────────────────────────────────────────────
  /** Custom header component rendered above the edit form in the detail panel. */
  detailHeader?: React.ComponentType<{ item: T }>;
  /** Empty state text when no record is selected. */
  emptyStateText?: string;

  // ── Navigation bar ──────────────────────────────────────────────
  /** Factory function returning action buttons for the selected record. */
  navigationActions?: (selectedItem: T | null) => NavigationAction[];
  /** Primary action button config (right side of nav bar). */
  primaryAction?: {
    label: string;
    sublabel?: string;
    shortcut?: string;
    onClick: () => void;
  };

  // ── Callbacks ───────────────────────────────────────────────────
  /** Called when a row is clicked / selected. */
  onSelect?: (item: T) => void;
  /** Called when the detail form is submitted. */
  onUpdate?: (id: string, changes: Partial<T>) => void;

  // ── Table features ──────────────────────────────────────────────
  /** Enable search bar in the table toolbar. Default: true. */
  searchable?: boolean;
  /** Enable column sorting. Default: true. */
  sortable?: boolean;
  /** Enable pagination. Default: false. */
  paginated?: boolean | { pageSize?: number };

  // ── Form config ─────────────────────────────────────────────────
  /** Number of CSS grid columns in the detail form. Default: 2. */
  formColumns?: number;
  /** Submit button label. Default: 'Save Changes'. */
  submitLabel?: string;
  /** Content rendered below the form in the detail panel. */
  detailFooter?: React.ReactNode;

  // ── Layout ──────────────────────────────────────────────────────
  /** Width ratio for list panel. Default: '3fr'. */
  listWidth?: string;
  /** Width ratio for detail panel. Default: '2fr'. */
  detailWidth?: string;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

function MasterDetailPage<T extends Row = Row>({
  schema,
  listColumns,
  primaryKey: primaryKeyOverride,
  editableFields,
  data: dataProp,
  collection,
  detailHeader: DetailHeader,
  emptyStateText,
  navigationActions,
  primaryAction,
  onSelect,
  onUpdate,
  searchable = true,
  sortable = true,
  paginated = false,
  formColumns = 2,
  submitLabel = 'Save Changes',
  detailFooter,
  listWidth,
  detailWidth,
  className,
}: MasterDetailPageProps<T>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const primaryKey = getSchemaPrimaryKey(schema, primaryKeyOverride);

  // Resolve data — collection prop not wired here (DataTable handles it internally)
  const data = dataProp ?? [];

  // Auto-select first record on mount / when data changes
  useEffect(() => {
    if (data.length === 0) {
      setSelectedId(null);
      return;
    }
    const ids = data.map((r) => requireRowPrimaryKey(r, primaryKey));
    if (selectedId == null || !ids.includes(selectedId)) {
      setSelectedId(ids[0]!);
    }
  }, [data, selectedId, primaryKey]);

  const selectedItem = useMemo(
    () => data.find((r) => requireRowPrimaryKey(r, primaryKey) === selectedId) ?? null,
    [data, selectedId, primaryKey],
  );

  const selectedIndex = useMemo(
    () => data.findIndex((r) => requireRowPrimaryKey(r, primaryKey) === selectedId),
    [data, selectedId, primaryKey],
  );

  // ─── Navigation ───────────────────────────────────────────────────

  const handlePrevious = useCallback(() => {
    if (selectedIndex > 0) {
      setSelectedId(requireRowPrimaryKey(data[selectedIndex - 1]!, primaryKey));
    }
  }, [data, selectedIndex, primaryKey]);

  const handleNext = useCallback(() => {
    if (selectedIndex < data.length - 1) {
      setSelectedId(requireRowPrimaryKey(data[selectedIndex + 1]!, primaryKey));
    }
  }, [data, selectedIndex, primaryKey]);

  const handleRowClick = useCallback(
    (row: T) => {
      setSelectedId(requireRowPrimaryKey(row, primaryKey));
      onSelect?.(row);
    },
    [onSelect, primaryKey],
  );

  // ─── Navigation actions ───────────────────────────────────────────

  const navActions = useMemo(
    () => navigationActions?.(selectedItem) ?? [],
    [selectedItem, navigationActions],
  );

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className={cn('h-full', className)}>
      <ListDetailLayout
        hasSelection={selectedItem != null}
        selectedKey={selectedId ?? undefined}
        listWidth={listWidth}
        detailWidth={detailWidth}
        list={
          <DataTable<T>
            schema={schema}
            data={collection ? undefined : data}
            collection={collection}
            columns={listColumns}
            primaryKey={primaryKey}
            searchable={searchable}
            sortable={sortable}
            paginated={paginated}
            onRowClick={handleRowClick}
            highlightedRowId={selectedId ?? undefined}
            className="h-full"
          />
        }
        detail={
          <DetailPanel
            isEmpty={selectedItem == null}
            emptyState={
              emptyStateText ? (
                <p className="text-sm">{emptyStateText}</p>
              ) : undefined
            }
            header={
              selectedItem && DetailHeader ? (
                <DetailHeader item={selectedItem} />
              ) : undefined
            }
            footer={detailFooter}
          >
            {selectedItem && (
              <AutoForm
                key={selectedId}
                schema={schema}
                mode="edit"
                defaultValues={selectedItem as Record<string, unknown>}
                columns={formColumns}
                onSubmit={(values) => {
                  onUpdate?.(requireRowPrimaryKey(selectedItem, primaryKey), values as Partial<T>);
                }}
                submitLabel={submitLabel}
                className="mt-2"
              />
            )}
          </DetailPanel>
        }
        bottomBar={
          <RecordNavigationBar
            currentIndex={selectedIndex}
            totalCount={data.length}
            onPrevious={handlePrevious}
            onNext={handleNext}
            actions={navActions}
            primaryAction={primaryAction}
          />
        }
      />
    </div>
  );
}

export { MasterDetailPage };

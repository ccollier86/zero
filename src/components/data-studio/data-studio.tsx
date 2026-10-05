'use client';

import type * as React from 'react';
import {
  useDataStudio,
  type DataStudioAccess,
  type UseDataStudioOptions,
} from '../../frontend/client/data-studio-hooks';
import { DataStudioWorkspace, type DataStudioWorkspaceProps } from './data-studio-workspace';

export interface DataStudioProps extends UseDataStudioOptions, Pick<DataStudioWorkspaceProps,
  'detailsOpen' | 'defaultDetailsOpen' | 'onDetailsOpenChange' | 'resizableDetails'> {
  /** UI-only permission narrowing; the server remains authoritative. */
  readonly capabilities?: Partial<DataStudioAccess>;
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
  readonly emptyState?: React.ReactNode;
}

/** Connected, organization-scoped Data Studio control plane. */
export function DataStudio({
  enabled,
  initialTableId,
  tableStatus,
  pageSize,
  rowLoading = 'progressive',
  initialSearch,
  initialFilters,
  capabilities,
  title,
  description,
  className,
  emptyState,
  detailsOpen,
  defaultDetailsOpen,
  onDetailsOpenChange,
  resizableDetails,
}: DataStudioProps) {
  const controller = useDataStudio({
    enabled,
    initialTableId,
    tableStatus,
    pageSize,
    rowLoading,
    initialSearch,
    initialFilters,
  });
  return (
    <DataStudioWorkspace
      controller={controller}
      capabilities={capabilities}
      title={title}
      description={description}
      className={className}
      emptyState={emptyState}
      detailsOpen={detailsOpen}
      defaultDetailsOpen={defaultDetailsOpen}
      onDetailsOpenChange={onDetailsOpenChange}
      resizableDetails={resizableDetails}
    />
  );
}

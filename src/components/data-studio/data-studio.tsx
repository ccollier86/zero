'use client';

import type * as React from 'react';
import {
  useDataStudio,
  type DataStudioAccess,
  type UseDataStudioOptions,
} from '../../frontend/client/data-studio-hooks';
import { DataStudioWorkspace } from './data-studio-workspace';

export interface DataStudioProps extends UseDataStudioOptions {
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
  initialSearch,
  initialFilters,
  capabilities,
  title,
  description,
  className,
  emptyState,
}: DataStudioProps) {
  const controller = useDataStudio({
    enabled,
    initialTableId,
    tableStatus,
    pageSize,
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
    />
  );
}

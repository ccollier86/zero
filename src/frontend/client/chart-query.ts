'use client';

/**
 * chart-query.ts
 *
 * Bridges existing authorized Sync collections into caller-owned chart data.
 * Subscription, transport and identity retirement stay in Zero's data hooks;
 * chart rendering and future server-side aggregate queries live elsewhere.
 */

import { useMemo } from 'react';
import type { Row } from '../../sync/types';
import { useClientMaybe } from './client-context';
import { useQuery, useStatus } from './data-hooks';
import { useAuthorizationScopeBoundary } from './authorization-scope-hooks';
import type { InternalClient } from './sdk';
import {
  ChartQueryError,
  projectChartQueryRows,
  type ChartQueryProjection,
  type ChartQueryProjectionResult,
} from './chart-query-projection';

export {
  CHART_QUERY_DEFAULT_MAX_ROWS,
  CHART_QUERY_MAX_ROWS,
  ChartQueryError,
  projectChartQueryRows,
} from './chart-query-projection';
export type {
  ChartQueryErrorCode,
  ChartQueryProjection,
  ChartQueryProjectionResult,
} from './chart-query-projection';

/** Bind a bounded, full-sync aggregate collection; never a lazy/paged raw history. */
export interface ChartQueryOptions<T extends Row, TData> extends ChartQueryProjection<T, TData> {
  readonly table: string;
}

/** No loading/total/completeness is inferred from an empty or connected cache. */
export interface ChartQueryResult<TData> extends ChartQueryProjectionResult<TData> {
  /** Transport connectivity, not proof that the server baseline has arrived. */
  readonly connected: boolean;
  /** False during SSR or authorization retirement; data and errors are masked. */
  readonly readable: boolean;
}

const acceptEveryChartRow = (_row: Row): boolean => true;

/**
 * Reactively project an already authorized, full-sync collection for a chart.
 * This does not run a server query or authorize a predicate: the server must
 * expose a bounded aggregate collection using existing resource/Sync policy.
 * Keep `project` pure and stable. Lazy/auto sources fail closed because their
 * cached rows cannot represent an honest full-population chart.
 */
export function useChartQuery<T extends Row, TData>(
  options: ChartQueryOptions<T, TData>,
): ChartQueryResult<TData> {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  // Predicate execution belongs to the guarded pure projection so a bad
  // application predicate produces a result error, not a render-time crash.
  const rows = useQuery<T>(options.table, acceptEveryChartRow);
  const { connected } = useStatus();
  const readable = typeof window !== 'undefined' && client !== null && boundary.ready;
  const syncMode = (client as InternalClient | null)?._syncClient?.tables[options.table]?._sync;
  const projected = useMemo<ChartQueryProjectionResult<TData>>(() => {
    if (!readable) return { data: null, error: null, rowCount: 0 };
    if (syncMode !== undefined && syncMode !== 'full') {
      return {
        data: null,
        error: new ChartQueryError(
          'CHART_QUERY_SOURCE_PARTIAL',
          'Chart query requires a resolved full-sync aggregate collection, not a lazy or auto source.',
        ),
        rowCount: rows.length,
      };
    }
    return projectChartQueryRows(rows, options);
  }, [boundary.key, readable, rows, syncMode, options.table, options.predicate, options.project, options.maxRows]);
  return { ...projected, connected: readable && connected, readable };
}

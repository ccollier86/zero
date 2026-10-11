/**
 * chart-query-projection.ts
 *
 * Owns bounded, synchronous projection of already supplied chart rows. It does
 * not fetch rows, infer collection completeness, authorize data or aggregate
 * across tenant/database boundaries.
 */

import type { Row } from '../../sync/types';

/** Small rollup collections, rather than raw event histories, are the intended input. */
export const CHART_QUERY_DEFAULT_MAX_ROWS = 1_000;
/** An application may lower or raise its local budget, but not remove the hard cap. */
export const CHART_QUERY_MAX_ROWS = 10_000;

export type ChartQueryErrorCode =
  | 'CHART_QUERY_LIMIT_INVALID'
  | 'CHART_QUERY_LIMIT_EXCEEDED'
  | 'CHART_QUERY_SOURCE_PARTIAL'
  | 'CHART_QUERY_PREDICATE_INVALID'
  | 'CHART_QUERY_PREDICATE_ASYNC'
  | 'CHART_QUERY_PROJECTION_FAILED'
  | 'CHART_QUERY_PROJECTION_ASYNC';

/** A presentation-source failure; it never includes SQL, credentials or source rows. */
export class ChartQueryError extends Error {
  constructor(readonly code: ChartQueryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ChartQueryError';
  }
}

/** Pure, synchronous chart transformation; a predicate must return an actual boolean, never truthy coercible data. */
export interface ChartQueryProjection<T extends Row, TData> {
  readonly predicate?: (row: T) => boolean;
  readonly project: (rows: readonly T[]) => TData;
  readonly maxRows?: number;
}

/** Local input count is not an exact database total or a claim of completeness. */
export interface ChartQueryProjectionResult<TData> {
  readonly data: TData | null;
  readonly error: ChartQueryError | null;
  /** Number of available source rows before the optional presentation predicate. */
  readonly rowCount: number;
}

/**
 * Project one bounded local row snapshot without mutating its array. Predicate
 * and projector errors become typed result errors. This helper neither loads
 * missing rows nor proves that a supplied snapshot represents the full dataset.
 */
export function projectChartQueryRows<T extends Row, TData>(
  rows: readonly T[],
  options: ChartQueryProjection<T, TData>,
): ChartQueryProjectionResult<TData> {
  const maxRows = options.maxRows ?? CHART_QUERY_DEFAULT_MAX_ROWS;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > CHART_QUERY_MAX_ROWS) {
    return failure(rows.length, new ChartQueryError(
      'CHART_QUERY_LIMIT_INVALID',
      `Chart query maxRows must be an integer from 1 to ${CHART_QUERY_MAX_ROWS}.`,
    ));
  }
  // Check the whole available collection before filtering: a predicate must
  // not disguise an unbounded source scan as a small projected result.
  if (rows.length > maxRows) {
    return failure(rows.length, new ChartQueryError(
      'CHART_QUERY_LIMIT_EXCEEDED',
      `Chart query exceeds its ${maxRows}-row local projection budget.`,
    ));
  }
  try {
    const selected: T[] = [];
    for (const row of rows) {
      if (!options.predicate) { selected.push(row); continue; }
      const accepted = options.predicate(row);
      if (isThenable(accepted)) {
        consumeAsync(accepted);
        return failure(rows.length, new ChartQueryError(
          'CHART_QUERY_PREDICATE_ASYNC',
          'Chart query predicates must be synchronous booleans.',
        ));
      }
      if (typeof accepted !== 'boolean') {
        return failure(rows.length, new ChartQueryError(
          'CHART_QUERY_PREDICATE_INVALID',
          'Chart query predicates must return booleans.',
        ));
      }
      if (accepted) selected.push(row);
    }
    const data = options.project(Object.freeze(selected));
    if (isThenable(data)) {
      // A rejected async projector must not become an unhandled rejection.
      // Its value is never admitted to the synchronous chart snapshot.
      consumeAsync(data);
      return failure(rows.length, new ChartQueryError(
        'CHART_QUERY_PROJECTION_ASYNC',
        'Chart query projections must be synchronous.',
      ));
    }
    return { data, error: null, rowCount: rows.length };
  } catch (cause) {
    return failure(rows.length, new ChartQueryError(
      'CHART_QUERY_PROJECTION_FAILED',
      'Chart query projection failed.',
      { cause },
    ));
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';
}

/** Retire invalid async callback results so rejection cannot escape the synchronous failure boundary. */
function consumeAsync(value: PromiseLike<unknown>): void {
  void Promise.resolve(value).catch(() => undefined);
}

function failure<TData>(rowCount: number, error: ChartQueryError): ChartQueryProjectionResult<TData> {
  return { data: null, error, rowCount };
}

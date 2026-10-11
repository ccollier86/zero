/** Pure chart-source budget and failure qualification; no database or transport. */
import { describe, expect, test } from 'bun:test';
import {
  CHART_QUERY_DEFAULT_MAX_ROWS,
  CHART_QUERY_MAX_ROWS,
  ChartQueryError,
  type ChartQueryProjection,
  projectChartQueryRows,
} from './chart-query-projection';

const rows = [{ id: 'a', value: 2 }, { id: 'b', value: 4 }];

describe('chart query projection', () => {
  test('projects a detached read-only array and keeps local input count honest', () => {
    let selected: readonly { id: string; value: number }[] | undefined;
    const result = projectChartQueryRows(rows, {
      predicate: row => row.value > 2,
      project: next => { selected = next; return next.reduce((total, row) => total + row.value, 0); },
    });
    expect(result).toEqual({ data: 4, error: null, rowCount: 2 });
    expect(selected).toEqual([rows[1]!]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(rows).toHaveLength(2);
  });

  test('a readable empty snapshot remains a legitimate caller projection', () => {
    expect(projectChartQueryRows([], { project: next => ({ count: next.length }) }))
      .toEqual({ data: { count: 0 }, error: null, rowCount: 0 });
  });

  test('default budget rejects oversize before predicate or projector runs', () => {
    let calls = 0;
    const result = projectChartQueryRows(Array.from({ length: CHART_QUERY_DEFAULT_MAX_ROWS + 1 }, () => rows[0]!), {
      predicate: () => { calls++; return false; },
      project: () => { calls++; return 1; },
    });
    expect(calls).toBe(0);
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('CHART_QUERY_LIMIT_EXCEEDED');
    expect(result.rowCount).toBe(CHART_QUERY_DEFAULT_MAX_ROWS + 1);
  });

  test('explicit budgets accept the exact boundary', () => {
    expect(projectChartQueryRows(rows, { maxRows: 2, project: next => next.length }).data).toBe(2);
    expect(projectChartQueryRows(rows, { maxRows: 1, project: next => next.length }).error?.code)
      .toBe('CHART_QUERY_LIMIT_EXCEEDED');
    expect(projectChartQueryRows(rows, { maxRows: CHART_QUERY_MAX_ROWS, project: next => next.length }).error).toBeNull();
  });

  for (const maxRows of [0, -1, 1.5, NaN, Infinity, CHART_QUERY_MAX_ROWS + 1]) {
    test(`rejects invalid budget ${maxRows}`, () => {
      const result = projectChartQueryRows(rows, { maxRows, project: () => 1 });
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(ChartQueryError);
      expect(result.error?.code).toBe('CHART_QUERY_LIMIT_INVALID');
    });
  }

  test('predicate failures become bounded sanitized result errors', () => {
    const cause = new Error('app-specific private row detail');
    const result = projectChartQueryRows(rows, {
      predicate: () => { throw cause; }, project: () => 1,
    });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    expect(result.error?.message).toBe('Chart query projection failed.');
    expect(result.error?.cause).toBe(cause);
  });

  test('projection failures never return an old data value', () => {
    const result = projectChartQueryRows(rows, { project: () => { throw 'projection'; } });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
  });

  test('cannot mutate the borrowed source array through the projector', () => {
    const result = projectChartQueryRows(rows, {
      project: next => { (next as typeof rows).push(rows[0]!); return 1; },
    });
    expect(result.error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    expect(rows).toHaveLength(2);
  });

  test('rejects and consumes asynchronous projector rejection', async () => {
    const result = projectChartQueryRows(rows, { project: async () => { throw new Error('async'); } });
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('CHART_QUERY_PROJECTION_ASYNC');
    await Promise.resolve();
  });

  for (const predicate of [async () => false, async () => true, async () => { throw new Error('predicate rejection'); }]) {
    test('runtime asynchronous predicates fail closed before projection and consume rejected promises', async () => {
      let projected = false, calls = 0;
      // JavaScript consumers can violate the TypeScript-only boolean contract.
      const options = { predicate: () => { calls++; return predicate(); }, project: () => { projected = true; return 'not admitted'; } } as unknown as ChartQueryProjection<typeof rows[number], string>;
      const result = projectChartQueryRows(rows, options);
      expect(result).toMatchObject({ data: null, rowCount: 2 });
      expect(result.error?.code).toBe('CHART_QUERY_PREDICATE_ASYNC');
      expect(result.error?.message).toBe('Chart query predicates must be synchronous booleans.');
      expect(projected).toBe(false); expect(calls).toBe(1);
      await Promise.resolve(); await Promise.resolve();
    });
  }

  test.each([undefined, null, 0, 1, '', 'false', {}, [], new Boolean(false), { then: 1 }].map(accepted => ({ accepted })))('nonboolean runtime predicate result %p is never truthiness-coerced', ({ accepted }) => {
    let projected = false;
    const options = { predicate: () => accepted, project: () => { projected = true; return 1; } } as unknown as ChartQueryProjection<typeof rows[number], number>;
    const result = projectChartQueryRows(rows, options);
    expect(result.data).toBeNull(); expect(result.error?.code).toBe('CHART_QUERY_PREDICATE_INVALID');
    expect(projected).toBe(false);
  });

  test('thenable callback results reject synchronously and drain assimilation failures without unhandled errors', async () => {
    let projected = false;
    const rejectedThenable = { then() { throw new Error('thenable failure'); } };
    const predicate = (() => rejectedThenable) as unknown as (row: typeof rows[number]) => boolean;
    expect(projectChartQueryRows(rows, { predicate, project: () => { projected = true; return 1; } }).error?.code).toBe('CHART_QUERY_PREDICATE_ASYNC');
    expect(projectChartQueryRows(rows, { project: () => rejectedThenable }).error?.code).toBe('CHART_QUERY_PROJECTION_ASYNC');
    expect(projected).toBe(false);
    await Promise.resolve(); await Promise.resolve();
  });

  test('a malformed then accessor stays inside the typed callback failure boundary', () => {
    const malformed = { get then() { throw new Error('invalid then accessor'); } };
    const predicate = (() => malformed) as unknown as (row: typeof rows[number]) => boolean;
    expect(projectChartQueryRows(rows, { predicate, project: () => 1 }).error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
    expect(projectChartQueryRows(rows, { project: () => malformed }).error?.code).toBe('CHART_QUERY_PROJECTION_FAILED');
  });

  test('an ordinary false predicate intentionally projects an empty frozen selection', () => {
    expect(projectChartQueryRows(rows, { predicate: () => false, project: selected => { expect(Object.isFrozen(selected)).toBe(true); return selected.length; } }))
      .toEqual({ data: 0, error: null, rowCount: 2 });
  });

  test('a null projection is valid and distinct from an error', () => {
    expect(projectChartQueryRows(rows, { project: () => null }))
      .toEqual({ data: null, error: null, rowCount: 2 });
  });
});

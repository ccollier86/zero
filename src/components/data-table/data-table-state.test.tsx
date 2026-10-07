/** Regression coverage for query resets, controlled facets, and manual row models. */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import { applyDataTableStateChange, type DataTableState } from './data-table-state';
import { useDataTable } from './use-data-table';

const schema = defineSchema({ name: field.text(), value: field.text() });
const base: DataTableState = {
  globalFilter: '', columnFilters: [], sorting: [], columnVisibility: {},
  rowSelection: { old: true }, pagination: { pageIndex: 3, pageSize: 20 },
};

describe('DataTable interaction state', () => {
  test('query changes reset the page and retire page-local selection', () => {
    const search = applyDataTableStateChange(base, 'globalFilter', 'Ada');
    const filters = applyDataTableStateChange(base, 'columnFilters', [{ id: 'name', value: 'Ada' }]);
    const sorting = applyDataTableStateChange(base, 'sorting', [{ id: 'name', desc: true }]);
    for (const state of [search, filters, sorting]) {
      expect(state.pagination.pageIndex).toBe(0);
      expect(state.rowSelection).toEqual({});
    }
    expect(base.pagination.pageIndex).toBe(3);
    expect(base.rowSelection).toEqual({ old: true });
  });

  test('preserves TanStack first-row anchoring on offset size changes and resets opaque cursor batches', () => {
    const anchored = applyDataTableStateChange(base, 'pagination', previous => ({ pageIndex: Math.floor(previous.pageIndex * previous.pageSize / 50), pageSize: 50 }));
    expect(anchored.pagination).toEqual({ pageIndex: 1, pageSize: 50 }); expect(anchored.rowSelection).toEqual({});
    const cursor = applyDataTableStateChange(base, 'pagination', { pageIndex: 1, pageSize: 50 }, 'cursor');
    expect(cursor.pagination).toEqual({ pageIndex: 0, pageSize: 50 }); expect(cursor.rowSelection).toEqual({});
    expect(applyDataTableStateChange(base, 'pagination', { pageIndex: 2, pageSize: 20 }, 'cursor').pagination.pageIndex).toBe(2);
  });

  test('functional updates retain independent visibility and query state', () => {
    const next = applyDataTableStateChange(base, 'columnVisibility', (previous) => ({ ...previous, value: false }));
    expect(next.columnVisibility).toEqual({ value: false });
    expect(next.pagination).toEqual(base.pagination);
    expect(next.rowSelection).toEqual(base.rowSelection);
  });

  test('server mode renders the accepted page without local filtering, sorting, or pagination', () => {
    function AcceptedPage() {
      const dt = useDataTable({
        schema,
        data: [{ id: 'b', name: 'server-first' }, { id: 'a', name: 'server-second' }],
        manualQuery: true,
        paginated: true,
        state: {
          globalFilter: 'does-not-match-locally',
          sorting: [{ id: 'name', desc: true }],
          pagination: { pageIndex: 4, pageSize: 1 },
        },
      });
      return <span>{dt.table.getRowModel().rows.map((row) => row.original.name).join(',')}</span>;
    }
    expect(renderToStaticMarkup(<AcceptedPage />)).toContain('server-first,server-second');
  });

  test('accepts controlled search and visibility without requiring every facet', () => {
    const markup = renderToStaticMarkup(
      <DataTable schema={schema} data={[{ id: '1', name: 'Ada', value: 'private-column-value' }, { id: '2', name: 'Casey', value: 'private-column-value' }]}
        state={{ globalFilter: 'Ada', columnVisibility: { value: false } }} />,
    );
    expect(markup).toContain('Ada');
    expect(markup).not.toContain('Casey');
    expect(markup).not.toContain('private-column-value');
  });

  test('normalizes numeric custom server identities to stable TanStack string IDs', () => {
    function CustomIdentity() {
      const dt = useDataTable({ schema, data: [{ name: 'Ada', order_id: 42 }], getRowId: (row) => row.order_id });
      return <span>{typeof dt.table.getRowModel().rows[0]?.id}:{dt.table.getRowModel().rows[0]?.id}</span>;
    }
    expect(renderToStaticMarkup(<CustomIdentity />)).toContain('string:42');
  });

  test('supports a fixed layout with a flexible truncated value column', () => {
    const markup = renderToStaticMarkup(
      <DataTable schema={schema} data={[{ id: '1', name: 'API key', value: 'x'.repeat(500) }]}
        tableLayout="fixed" columnOverrides={{ name: { width: 200, minWidth: 100, maxWidth: 250 }, value: { flex: true, truncate: true } }} />,
    );
    expect(markup).toContain('table-fixed');
    expect(markup).toContain('<colgroup><col style="width:200px"/><col/>');
    expect(markup).toContain('overflow-hidden text-ellipsis whitespace-nowrap');
  });
});

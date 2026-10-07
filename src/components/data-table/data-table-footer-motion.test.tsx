/** SSR verifies truthful footer counts and compatible TanStack sorting without a DOM or animation engine. */
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCoreRowModel, getPaginationRowModel, useReactTable, type SortingState } from '@tanstack/react-table';
import { DataTablePagination, type DataTablePaginationProps } from './data-table-pagination';
import { DataTableColumnHeader } from './data-table-column-header';
import { DataTableRollingNumber } from './data-table-rolling-number';
import { DataTableNewRecordsButton } from './data-table-new-records-button';
type RecordRow = { id: string; name: string };
function Footer({ count = 25, pageIndex = 0, ...props }: Omit<DataTablePaginationProps<RecordRow>, 'table'> & { count?: number; pageIndex?: number }) {
  const table = useReactTable({ data: Array.from({ length: count }, (_, index) => ({ id: String(index), name: `Row ${index}` })),
    columns: [{ accessorKey: 'name' }], state: { pagination: { pageIndex, pageSize: 10 } },
    manualPagination: props.serverPage !== undefined, getCoreRowModel: getCoreRowModel(), getPaginationRowModel: getPaginationRowModel() });
  return <DataTablePagination table={table} {...props} />;
}
test('known counts expose complete accessible sentences, no first-render animation, and transform-only progress', () => {
  const html = renderToStaticMarkup(<Footer />);
  expect(html).toContain('aria-label="Showing 1-10 of 25"'); expect(html).toContain('aria-label="Page 1 of 3"');
  expect(html).toContain('data-slot="data-table-page-progress"'); expect(html).toContain('scaleX(0.3333333333333333)');
  expect(html).not.toContain('animation:'); expect(html).not.toContain('style="width:');
});
test('unknown offset and unloaded pages never claim a total or page count', () => {
  const offset = renderToStaticMarkup(<Footer count={7} pageIndex={2} serverPage={{ mode: 'offset', offset: 20, hasMore: true }} />);
  expect(offset).toContain('aria-label="Showing 21-27"'); expect(offset).toContain('aria-label="Page 3"');
  expect(offset).not.toContain('data-table-page-track'); expect(offset).not.toContain('Last page');
  const unloaded = renderToStaticMarkup(<Footer count={0} serverPage={null} loading />);
  expect(unloaded).toContain('Loading records…'); expect(unloaded).not.toContain('of 1');
});
test('opaque cursor batches do not invent absolute positions or total page counts even with an exact total', () => {
  const html = renderToStaticMarkup(<Footer count={7} pageIndex={3} serverPage={{ mode: 'cursor', total: 35, hasMore: true, nextCursor: 'opaque' }} />);
  expect(html).toContain('aria-label="7 records on this page"'); expect(html).toContain('aria-label="Page 4"');
  expect(html).not.toContain('Showing 31'); expect(html).not.toContain('data-table-page-track'); expect(html).not.toContain('Last page');
});
test('known empty data has zero pages; an optional new-record action uses only its supplied count', () => {
  const empty = renderToStaticMarkup(<Footer count={0} />);
  expect(empty).toContain('aria-label="Page 0 of 0"'); expect(empty).not.toContain('data-table-page-track');
  const html = renderToStaticMarkup(<Footer newCount={12} onRevealNew={() => {}} />);
  expect(html).toContain('aria-label="Reveal 12 new records"');
  expect(renderToStaticMarkup(<Footer newCount={12} />)).not.toContain('data-table-new-records');
  expect(renderToStaticMarkup(<Footer newCount={-1} onRevealNew={() => {}} />)).not.toContain('data-table-new-records');
});
test('same-scope background loading does not disable page-size or valid pager targets', () => {
  const html = renderToStaticMarkup(<Footer loading />);
  const buttons = html.match(/<button\b[^>]*>/g)!;
  expect(buttons.find(button => button.includes('aria-label="Next page"'))).not.toContain('disabled=""');
  expect(buttons.find(button => button.includes('aria-label="Rows per page"'))).not.toContain('disabled=""');
});
test('held arrivals may override the displayed total but never invent a navigable local page', () => {
  const html = renderToStaticMarkup(<Footer totalCountOverride={100} />);
  expect(html).toContain('aria-label="Showing 1-10 of 100"'); expect(html).toContain('aria-label="Page 1 of 3"');
  const server = renderToStaticMarkup(<Footer count={7} totalCountOverride={100} serverPage={{ mode: 'offset', offset: 0, total: 7, hasMore: false }} />);
  expect(server).toContain('aria-label="Showing 1-7 of 7"'); expect(server).not.toContain('of 100');
});
function Header({ sorting }: { sorting: SortingState }) {
  const table = useReactTable({ data: [{ id: '1', name: 'One' }], columns: [{ accessorKey: 'name' }],
    state: { sorting }, getCoreRowModel: getCoreRowModel() });
  return <DataTableColumnHeader column={table.getColumn('name')!} title="Name" />;
}
test('single sort arrow preserves the cycle and announces current direction', () => {
  const neutral = renderToStaticMarkup(<Header sorting={[]} />);
  const ascending = renderToStaticMarkup(<Header sorting={[{ id: 'name', desc: false }]} />);
  const descending = renderToStaticMarkup(<Header sorting={[{ id: 'name', desc: true }]} />);
  expect(neutral).toContain('aria-label="Name"'); expect(neutral).toContain('Activate to sort ascending.');
  expect(ascending).toContain('aria-label="Name, sorted ascending"'); expect(ascending).toContain('rotate(180deg)');
  expect(descending).toContain('aria-label="Name, sorted descending"'); expect(descending).toContain('rotate(0deg)');
});
test('initial rolling values are SSR-safe, grouped, and use hidden per-character visual slots', () => {
  const html = renderToStaticMarkup(<DataTableRollingNumber value={1234} />);
  expect(html).toContain('aria-hidden="true"'); expect(html).toContain('data-value="1234"');
  expect(html.match(/data-slot="data-table-digit"/g)).toHaveLength(5);
  expect(html).toContain('<span>,</span>');
});
test('held-new action can render without a fake pager and preserves native accessible button props', () => {
  const html = renderToStaticMarkup(<DataTableNewRecordsButton count={5} onReveal={() => {}} disabled id="held" />);
  expect(html).toContain('aria-label="Reveal 5 new records"'); expect(html).toContain('id="held"');
  expect(html).toContain('disabled=""'); expect(html).not.toContain('data-table-pagination');
  expect(renderToStaticMarkup(<DataTableNewRecordsButton count={0} onReveal={() => {}} />)).toBe('');
});

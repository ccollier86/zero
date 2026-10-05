/** Public headless-hook admission using synthetic rows and in-memory React only. */
import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { defineSchema, field } from '../../schema';
import { createHookContainer, installMinimalHookDom } from '../../frontend/client/test-fixtures/react-hook-dom';
import { useDataTable, type UseDataTableOptions, type UseDataTableReturn } from './index';

const schema = defineSchema({ name: field.text() });
const data = [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Casey' }, { id: 'c', name: 'Eve' }];
type RecordRow = typeof data[number];
type Options = Omit<UseDataTableOptions<RecordRow>, 'schema' | 'data'>;
function Projected({ options }: { options: Options }) {
  const current = useDataTable({ schema, data, ...options });
  return <span>{current.globalFilter}:{current.table.getRowModel().rows.map(row => row.original.name).join(',')}</span>;
}

test('legacy globalFilter initializes the real public hook search and row model', () => {
  expect(renderToStaticMarkup(<Projected options={{ globalFilter: 'Ada' }} />)).toContain('Ada:Ada');
});

test('explicit initial/controlled search overrides the shorthand, including an intentional blank', () => {
  expect(renderToStaticMarkup(<Projected options={{ globalFilter: 'Ada', initialState: { globalFilter: 'Casey' } }} />))
    .toContain('Casey:Casey');
  expect(renderToStaticMarkup(<Projected options={{ globalFilter: 'Ada', state: { globalFilter: 'Eve' } }} />))
    .toContain('Eve:Eve');
  expect(renderToStaticMarkup(<Projected options={{ globalFilter: 'Ada', initialState: { globalFilter: '' } }} />))
    .toContain(':Ada,Casey,Eve');
});

test('undefined partial controlled facets retain their uncontrolled defaults', () => {
  expect(renderToStaticMarkup(<Projected options={{ state: {
    globalFilter: undefined, columnFilters: undefined, sorting: undefined,
    pagination: undefined, rowSelection: undefined, columnVisibility: undefined,
  } }} />)).toContain(':Ada,Casey,Eve');
});

test('an undefined controlled search does not erase an explicit initial search', () => {
  expect(renderToStaticMarkup(<Projected options={{
    initialState: { globalFilter: 'Ada' }, state: { globalFilter: undefined },
  }} />)).toContain('Ada:Ada');
});

let cleanup: (() => void | Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

test('initialized shorthand does not prevent local setters or reseed on later renders', async () => {
  const restore = installMinimalHookDom(), root = createRoot(createHookContainer());
  cleanup = async () => { try { await act(() => root.unmount()); } finally { restore(); } };
  let current!: UseDataTableReturn<RecordRow>;
  function Probe({ filter }: { filter: string }) { current = useDataTable({ schema, data, globalFilter: filter }); return null; }
  await act(() => root.render(<Probe filter="Ada" />));
  expect(current.globalFilter).toBe('Ada');
  await act(() => current.setGlobalFilter('Casey'));
  expect(current.globalFilter).toBe('Casey');
  expect(current.table.getRowModel().rows.map(row => row.original.name)).toEqual(['Casey']);
  await act(() => root.render(<Probe filter="Eve" />));
  expect(current.globalFilter).toBe('Casey');
});

test('manual server mode retains accepted rows even with initialized search', () => {
  expect(renderToStaticMarkup(<Projected options={{ globalFilter: 'Ada', manualQuery: true }} />))
    .toContain('Ada:Ada,Casey,Eve');
});

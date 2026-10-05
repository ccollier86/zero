/** Synthetic controlled page replacement must not expand page action scope. */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableState } from './data-table-state';

const schema = defineSchema({ name: field.text({ required: true }) });
const rows = [{ id: 'a', name: 'First page row' }, { id: 'b', name: 'Second page row' }];
let nextPage: () => void = () => undefined;
let selected: string[] = [];

function Fixture() {
  const [state, setState] = React.useState<Partial<DataTableState>>({
    rowSelection: { a: true }, pagination: { pageIndex: 0, pageSize: 1 },
  });
  nextPage = () => setState((previous) => ({ ...previous, pagination: { pageIndex: 1, pageSize: 1 } }));
  return <DataTable
    schema={schema} data={rows} columns={['name']} selectable paginated={{ pageSize: 1 }}
    state={state} onStateChange={setState} onSelectionChange={(ids) => { selected = ids; }}
    toolbarSlots={{ supplemental: (context) => <output data-page-selection="toolbar">{context.selectedRowIds.join(',')}</output> }}
    bulkActions={[{ id: 'inspect', label: 'Run selected action', onClick: () => undefined }]}
  />;
}

window.__tablePageSelection = { nextPage: () => nextPage(), selection: () => selected };
createRoot(document.getElementById('root')!).render(<Fixture />);

declare global {
  interface Window { __tablePageSelection: { nextPage(): void; selection(): string[] } }
}

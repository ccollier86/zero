/** Synthetic authenticated public SDK/native-table fixture. All HTTP is intercepted; no app DB, real identity, provider or writer is opened. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineTable, field } from '../../schema';
import { ClientProvider, useClient } from '../../frontend/client/client-context';
import { createClient, FetchError } from '../../frontend/client/sdk';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { useAuth } from '../../frontend/client/auth-hooks';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { DataTableView } from './data-table';
import type { DataTableState } from './data-table-state';
import type { DataTableServerResult, DataTableServerSource } from './data-table-server-types';
import { Button } from '../ui/button';
import { MasterDetailPage } from '../master-detail/master-detail-page';

type Item = { id: string; name: string };
const schema = defineTable('synthetic_read_rejection_roster', { name: field.text({ label: 'Patient' }) }, { pk: 'id', sync: 'lazy' }).schema;
configureFrontendObservability({ console: false, http: false });
const client = createClient({ url: location.origin, auth: true, autoConnect: false, tables: {}, authorizationRevalidationIntervalMs: 0 });
let rowActions = 0, bulkActions = 0, acceptedWrites = 0;
const snapshots: number[] = [];
const harness = { snapshots, actions: () => ({ rowActions, bulkActions, acceptedWrites }),
  page: (_page: number) => {}, search: (_search: string) => {}, edit: (_enabled: boolean) => {},
  async replaceIdentity() { await client.login('synthetic-other', 'fictional-password'); },
};
declare global { interface Window { __readDenial: typeof harness } }
window.__readDenial = harness;
const columns = ['name'], readOnly: string[] = [], canEdit = ['name'];
function Fixture() {
  const client = useClient(), authority = useAuthorizationScopeBoundary();
  const { isAuthenticated } = useAuth();
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0), [editable, setEditable] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [state, setState] = React.useState<DataTableState>({ globalFilter: '', columnFilters: [], sorting: [], columnVisibility: {},
    rowSelection: {}, pagination: { pageIndex: 0, pageSize: 25 } });
  harness.page = pageIndex => setState(value => ({ ...value, pagination: { ...value.pagination, pageIndex } }));
  harness.search = globalFilter => setState(value => ({ ...value, globalFilter })); harness.edit = setEditable;
  const source = React.useMemo<DataTableServerSource<Item>>(() => ({ type: 'server', table: 'synthetic_read_rejection_roster',
    pagination: 'offset', live: false, prefetch: false, adapter: { query(query, { signal }) {
      const params = new URLSearchParams({ page: String(query.pagination.pageIndex), search: query.search });
      return client.fetch<DataTableServerResult<Item>>('/synthetic-roster?' + params, { signal });
    } } }), [client]);
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-testid="source-read-failure"][data-status="403"]'))
        snapshots.push(document.querySelectorAll('tbody [data-row-id]').length);
    });
    observer.observe(document.body, { childList: true, subtree: true }); return () => observer.disconnect();
  }, []);
  return <main>
    <output data-testid="source-authority">{JSON.stringify({ ready: authority.ready, stable: authority.stable, key: authority.key, authenticated: isAuthenticated })}</output>
    <output data-testid="selected-ids">{JSON.stringify(selected)}</output>
    <Button type="button" onClick={refresh}>Refresh synthetic roster</Button>
    {new URL(location.href).searchParams.has('master') ? <div style={{ height: 700 }}><MasterDetailPage<Item>
      schema={schema} source={source} refreshKey={revision} primaryKey="id" listColumns={columns} paginated={{ pageSize: 25 }}
      renderDetail={item => <p data-testid="private-detail">{item.name}</p>}
      errorState={(error, retry) => <div role="alert" data-testid="source-read-failure" data-status={error instanceof FetchError ? error.status : undefined}>
        Synthetic source read failed.<Button type="button" onClick={() => { void retry(); }}>Retry protected read</Button></div>} />
    </div> : <DataTableView<Item> schema={schema} source={source} refreshKey={revision} primaryKey="id" columns={columns}
      editable={editable ? canEdit : readOnly} searchable sortable={false} selectable state={state} onStateChange={setState}
      paginated={{ pageSize: 25 }} onSelectionChange={setSelected} showExport={false} showColumnVisibility={false}
      actions={[{ id: 'synthetic-open', label: 'Open synthetic record', refreshOnSuccess: false, onClick() { rowActions++; } }]}
      bulkActions={[{ id: 'synthetic-bulk', label: 'Act on selected records', refreshOnSuccess: false, onClick() { bulkActions++; } }]}
      onCellCommit={async (id, key, value) => { await client.fetch('/synthetic-write', { method: 'POST', body: { id, key, value } }); acceptedWrites++; }}
      onRowClick={() => { rowActions++; }} errorState={(error, retry) => <div role="alert" data-testid="source-read-failure"
        data-status={error instanceof FetchError ? error.status : undefined}>Synthetic source read failed.
        <Button type="button" onClick={() => { void retry(); }}>Retry protected read</Button></div>} />}
  </main>;
}
async function main() {
  await client.login('synthetic-clinician', 'fictional-password');
  createRoot(document.getElementById('root')!).render(<ClientProvider client={client}><Fixture /></ClientProvider>);
}
void main();

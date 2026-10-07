/** Actual standalone DataTable with app-controlled records/loading and acknowledged writes; no SDK transport or backend. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { defineSchema, field } from '../../schema';
import { DataTable } from './data-table';
import type { DataTableState } from './data-table-state';
import type { DataTableMutationContext } from './data-table-mutation';
import { ClientProvider } from '../../frontend/client/client-context';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import type { Client } from '../../frontend/client/sdk';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';

type RecordRow = { id: string; alternateId: string; name: string; rank: number };
const schema = defineSchema({ name: field.text({ required: true }), rank: field.number() });
const initialRows: RecordRow[] = Array.from({ length: 30 }, (_, index) => ({ id: `r${index + 1}`, alternateId: `other-r${index + 1}`,
  name: `${index % 2 ? 'Beta' : 'Alpha'} record ${String(index + 1).padStart(2, '0')}`, rank: 30 - index }));
// Observable collection and admitted message receipts are synthetic. The real
// ClientProvider, collection source, boundary and INSERT hook run unchanged.
const authListeners = new Set<() => void>(), collectionListeners = new Set<() => void>();
const syncListeners = new Set<(message: { type: string; [key: string]: unknown }) => void>();
let scopeKey = 'organization-a';
const stores = new Map<string, Record<string, RecordRow>>([
  [scopeKey, Object.fromEntries(initialRows.map(row => [row.id, row]))],
  ['organization-b', { 'new-scope': { id: 'new-scope', alternateId: 'other-new-scope', name: 'New scope record', rank: 1 } }],
]);
const auth = { user: { userId: 'synthetic-user' }, activeTenant: { tenantId: scopeKey }, isAuthenticated: true,
  isLoading: false, isRestoring: false, get authorizationScopeKey() { return scopeKey; },
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null }, authorizationState: { status: 'ready' },
  subscribe(listener: () => void) { authListeners.add(listener); return () => { authListeners.delete(listener); }; },
  subscribeAuthorization(listener: () => void) { authListeners.add(listener); return () => { authListeners.delete(listener); }; },
};
const collection = { getAll: () => stores.get(scopeKey)!, subscribe(listener: () => void) { collectionListeners.add(listener); return () => { collectionListeners.delete(listener); }; } };
const syntheticClient = { auth, _authorizationDataBoundary: new AuthorizationDataBoundaryController(), collection: () => collection,
  _syncClient: { onMessage(listener: (message: { type: string; [key: string]: unknown }) => void) { syncListeners.add(listener); return () => { syncListeners.delete(listener); }; } } } as unknown as Client;
const saved = new Map<string, Element>(), clicks: string[] = [];
const events: FrontendObservabilityEvent[] = [];
configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
const writes: { id: string; field: string; value: unknown; signal?: AbortSignal; accept(): void; reject(): void }[] = [];
const refreshes: { accept(): void; reject(): void }[] = [];
const stateChanges: DataTableState[] = [];
let latestState: Partial<DataTableState>, latestFlags: Flags;
let configure: (patch: Partial<Flags>) => void, update: (id: string, patch: Partial<RecordRow>) => void;
let insert: (row: RecordRow) => void, replace: (rows: RecordRow[]) => void;
let changeState: (state: Partial<DataTableState>) => void;
interface Flags { loading: boolean; error: string | null; motion: boolean; liveUpdates: boolean; primaryKey: 'id' | 'alternateId' }

function Fixture() {
  const firstLoading = document.documentElement.dataset.initialLoading === 'true';
  const paginated = document.documentElement.dataset.unpaginated !== 'true';
  const collectionMode = document.documentElement.dataset.collection === 'true';
  const [rows, setRows] = React.useState(firstLoading ? [] : initialRows);
  const [flags, setFlags] = React.useState<Flags>({ loading: firstLoading, error: null, motion: true, liveUpdates: true, primaryKey: 'id' });
  const [state, setState] = React.useState<Partial<DataTableState>>({ sorting: [{ id: 'rank', desc: true }], pagination: { pageIndex: 0, pageSize: 10 } });
  latestState = state; latestFlags = flags;
  const publishState = React.useCallback((next: DataTableState) => { stateChanges.push(structuredClone(next)); setState(next); }, []);
  configure = patch => setFlags(previous => ({ ...previous, ...patch }));
  update = (id, patch) => setRows(previous => previous.map(row => row.id === id ? { ...row, ...patch } : row));
  insert = row => setRows(previous => [...previous, row]); replace = setRows;
  changeState = next => setState(previous => ({ ...previous, ...next }));
  const refresh = React.useCallback(() => {
    setFlags(previous => ({ ...previous, loading: true }));
    return new Promise<void>((resolve, reject) => refreshes.push({
      accept: () => { setFlags(previous => ({ ...previous, loading: false })); resolve(); },
      reject: () => { setFlags(previous => ({ ...previous, loading: false })); reject(new Error('PRIVATE_REFRESH_CAUSE')); },
    }));
  }, []);
  const commit = React.useCallback((id: string, field: string, value: unknown, context?: DataTableMutationContext) => new Promise<void>((resolve, reject) => writes.push({
    id, field, value, signal: context?.signal,
    accept: () => { setRows(previous => previous.map(row => row.id === id ? { ...row, [field]: value } : row)); resolve(); },
    reject: () => reject(new Error('PRIVATE_WRITE_CAUSE')),
  })), []);
  return <div data-fixture-owner style={{ height: paginated ? undefined : 280, overflowY: paginated ? undefined : 'auto', maxWidth: 850 }}>
    <DataTable<RecordRow> schema={schema} source={collectionMode ? { type: 'collection', table: 'records' }
      : { type: 'data', data: rows, isLoading: flags.loading, error: flags.error, refresh }}
      primaryKey={flags.primaryKey} columns={['name', 'rank']} editable={['name']} tableLayout="fixed"
      columnOverrides={{ name: { flex: true }, rank: { width: 90 } }}
      searchable={{ fields: ['name'], ariaLabel: 'Search live records' }} sortable selectable
      paginated={paginated ? { pageSize: 10 } : false} motion={flags.motion} liveUpdates={flags.liveUpdates}
      state={state} onStateChange={publishState} onCellCommit={commit} onRowClick={row => clicks.push(row.id)}
      showExport={false} showColumnVisibility={false}
      toolbarSlots={{ supplemental: context => <output data-current-query>{context.query}</output> }} />
  </div>;
}
declare global {
  interface Window {
    __liveMotion: {
      configure(patch: Partial<Flags>): void;
      update(id: string, patch: Partial<RecordRow>): void;
      insert(row: Omit<RecordRow, 'alternateId'>): void;
      replace(rows: Omit<RecordRow, 'alternateId'>[]): void;
      state(state: Partial<DataTableState>): void;
      save(id: string): void;
      same(id: string): boolean;
      writes(): { id: string; field: string; value: unknown; aborted: boolean }[];
      acceptWrite(index: number): void;
      rejectWrite(index: number): void;
      refreshCount(): number;
      acceptRefresh(index: number): void;
      rejectRefresh(index: number): void;
      clicks(): string[];
      collectionLoad(rows: Omit<RecordRow, 'alternateId'>[]): void;
      collectionInsert(row: Omit<RecordRow, 'alternateId'>): void;
      sync(message: { type: string; [key: string]: unknown }): void;
      scope(scope: string, publish?: boolean): void;
      notify(): void;
      snapshot(): { state: Partial<DataTableState>; flags: Flags; changes: DataTableState[] };
      events(): FrontendObservabilityEvent[];
    };
  }
}
const withAlternateId = (row: Omit<RecordRow, 'alternateId'>): RecordRow => ({ ...row, alternateId: `other-${row.id}` });
window.__liveMotion = {
  configure: patch => configure(patch), update: (id, patch) => update(id, patch), insert: row => insert(withAlternateId(row)),
  replace: rows => replace(rows.map(withAlternateId)), state: next => changeState(next),
  save: id => { const node = document.querySelector(`[data-row-id="${id}"]`); if (node) saved.set(id, node); },
  same: id => saved.get(id) === document.querySelector(`[data-row-id="${id}"]`),
  writes: () => writes.map(write => ({ id: write.id, field: write.field, value: write.value, aborted: write.signal?.aborted ?? false })),
  acceptWrite: index => writes[index]?.accept(), rejectWrite: index => writes[index]?.reject(),
  refreshCount: () => refreshes.length, acceptRefresh: index => refreshes[index]?.accept(), rejectRefresh: index => refreshes[index]?.reject(), clicks: () => clicks,
  collectionLoad: rows => { stores.set(scopeKey, Object.fromEntries(rows.map(row => [row.id, withAlternateId(row)]))); for (const listener of collectionListeners) listener(); },
  collectionInsert: row => { stores.set(scopeKey, { ...stores.get(scopeKey), [row.id]: withAlternateId(row) }); for (const listener of collectionListeners) listener(); },
  sync: message => { for (const listener of syncListeners) listener(message); },
  scope: (scope, publish = true) => { scopeKey = scope; auth.activeTenant = { tenantId: scope }; if (publish) for (const listener of authListeners) listener(); },
  notify: () => { for (const listener of authListeners) listener(); },
  snapshot: () => ({ state: latestState, flags: latestFlags, changes: stateChanges }),
  events: () => events,
};
createRoot(document.getElementById('root')!).render(<React.StrictMode>{document.documentElement.dataset.collection === 'true'
  ? <ClientProvider client={syntheticClient}><Fixture /></ClientProvider> : <Fixture />}</React.StrictMode>);

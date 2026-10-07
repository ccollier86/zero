/** Synthetic shared/action caller acceptance only; no clients, service requests, credentials, or databases. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Pencil, Trash2, Download, Columns3, Archive } from 'lucide-react';
import { RecordNavigationBar } from './record-navigation-bar';
import { StorageStudioActionBar } from '../storage/storage-studio-action-bar';
import { DataStudioWorkspaceActions } from '../data-studio/data-studio-workspace-actions';
import type { StorageManagementController } from '../storage/storage-management-controller';
import type { UseDataStudioResult } from '../../frontend/client/data-studio-hooks';

const invoked: string[] = [];
const actions = [
  { icon: <FolderOpen />, label: 'Open', onClick: () => { invoked.push('Open'); } },
  { icon: <Pencil />, label: 'Rename', onClick: () => { invoked.push('Rename'); } },
  { icon: <Trash2 />, label: 'Delete record', variant: 'destructive' as const, onClick: () => { invoked.push('Delete record'); } },
  { icon: <Download />, label: 'Download', onClick: () => { invoked.push('Download'); } },
  { icon: <Columns3 />, label: 'Edit schema', onClick: () => { invoked.push('Edit schema'); } },
  { icon: <Archive />, label: 'Archive table', variant: 'warning' as const, onClick: () => { invoked.push('Archive table'); } },
  { icon: <Trash2 />, label: 'Forbidden', disabled: true, onClick: () => { invoked.push('Forbidden'); } },
];
const drive = { drive: { drive_id: 'synthetic', access: { canRead: true, canWrite: false } },
  profile: { lifecycle: 'ready' }, control: { canManage: false, canSuspend: false, canRestore: false, canDelete: false } };
const storage = { view: 'drives', drives: [drive], files: [], selectedDrive: drive, capabilities: {},
  busy: false, loading: false, status: 'ready', operations: {}, openDrive: () => { invoked.push('storage.open'); },
  selectDrive() {} } as unknown as StorageManagementController;
const studio = { selectedTable: { status: 'active', schema: { columns: [] } }, selectedRow: { id: 'synthetic' },
  selectedRowIndex: 0, rows: [{ id: 'synthetic' }], totalRows: 1, isLoadingRows: false, isMutating: false,
  rowsNeedRefresh: false, selectPreviousRow() {}, selectNextRow() {} } as unknown as UseDataStudioResult;
let rerender: () => void, replaceContext: (value: string) => void;
declare global { interface Window { __recordActions: { invoked(): string[]; clear(): void; rerender(): void; context(value: string): void } } }
window.__recordActions = { invoked: () => invoked, clear: () => { invoked.length = 0; },
  rerender: () => rerender(), context: value => replaceContext(value) };
function Fixture() {
  const [revision, setRevision] = React.useState(0), [context, setContext] = React.useState('A');
  rerender = () => setRevision(value => value + 1); replaceContext = setContext;
  return <main data-render={revision} data-context={context} style={{ margin: 12 }}>
  <button type="button" id="keyboard-start">Start keyboard</button>
  <section data-testid="shared" style={{ marginBlock: 12 }}><RecordNavigationBar currentIndex={1} totalCount={10} status="10 records"
    onPrevious={() => {}} onNext={() => {}} actionContextKey={context} actions={actions.map(action => ({ ...action, onClick: () => action.onClick() }))}
    primaryAction={{ label: 'Create record', onClick: () => { invoked.push('Create record'); } }} /></section>
  <section data-testid="visible" style={{ marginBlock: 12 }}><RecordNavigationBar currentIndex={0} totalCount={0} showNavigation={false}
    onPrevious={() => {}} onNext={() => {}} actionLabelMode="visible" actions={[actions[0]!]} /></section>
  <section data-testid="storage" style={{ marginBlock: 12 }}><StorageStudioActionBar controller={storage} /></section>
  <section data-testid="studio" style={{ marginBlock: 12 }}><DataStudioWorkspaceActions controller={studio}
    access={{ canRead: true, canWrite: false, canManage: false }} onAddRecord={() => {}} onAddColumn={() => {}}
    onEditSchema={() => {}} onInspect={() => { invoked.push('studio.inspect'); }} onDeleteRecord={() => {}} onChangeStatus={() => {}} /></section>
</main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);

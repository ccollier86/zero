/** Isolated Cascader browser fixture; callbacks use deferred local promises, never live app services. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Bell, Clipboard, FileSpreadsheet, Mail, Plus, Table2, User } from 'lucide-react';
import { configureFrontendObservability } from '../../frontend/client/observability';
import {
  Cascader, CascaderAction, CascaderBreadcrumb, CascaderContent, CascaderFooter,
  CascaderImportMenu, CascaderInput, CascaderItems, CascaderList, CascaderPanel,
  CascaderSelectionChips, CascaderTrigger, CascaderValue, useCascaderSelection,
  type CascaderChildrenLoader, type CascaderNode, type CascaderSearchLoader,
  type CascaderSearchResult,
} from './index';

type Configuration = {
  kind: 'static' | 'async' | 'remote';
  defaultValues: readonly string[];
  max: number;
  disabled: boolean;
  readOnly: boolean;
  scope: string;
};
type Deferred<T> = { id: number; value: string | null; signal?: AbortSignal; settled: boolean;
  resolve: (result: T) => void; reject: (error: Error) => void };

const DEFAULT: Configuration = {
  kind: 'static', defaultValues: ['people.name', 'projects.name'], max: 3,
  disabled: false, readOnly: false, scope: 'first-organization',
};
const ITEMS: readonly CascaderNode[] = [
  { value: 'people', label: 'People', icon: <User />, description: 'Profile and contact attributes', children: [
    { value: 'people.name', label: 'Name', description: 'Public display name', icon: <User /> },
    { value: 'people.email', label: 'Email', description: 'Primary contact address', icon: <Mail /> },
    { value: 'people.blocked', label: 'Restricted field', disabled: true },
  ] },
  { value: 'projects', label: 'Projects', icon: <Table2 />, description: 'Project details and preferences', children: [
    { value: 'projects.name', label: 'Name', icon: <Table2 /> },
    { value: 'projects.settings', label: 'Settings', icon: <Bell />, children: [
      { value: 'projects.settings.notifications', label: 'Notifications', icon: <Bell /> },
    ] },
  ] },
  { value: 'lazy', label: 'Connected data', icon: <Table2 />, hasChildren: true, description: 'Load attributes on demand' },
  { value: 'empty', label: 'Empty data', hasChildren: true },
  { value: 'disabled', label: 'Unavailable collection', disabled: true, children: [
    { value: 'disabled.field', label: 'Hidden field' },
  ] },
];
let sequence = 0;
const children: Deferred<readonly CascaderNode[]>[] = [];
const searches: Deferred<readonly CascaderSearchResult[]>[] = [];
const actions: Deferred<void>[] = [];
const events: { code: string; metadata?: Record<string, unknown>; message: string }[] = [];
const errors: { operation: string; code: string }[] = [];
configureFrontendObservability({ sink: { emit(event) {
  events.push({ code: event.code, metadata: event.metadata, message: event.message });
} } });

function pending<T>(value: string | null, records: Deferred<T>[], signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => records.push({
    id: ++sequence, value, signal, settled: false,
    resolve: (result) => { resolve(result); }, reject,
  }));
}
function settle<T>(records: Deferred<T>[], id: number, value: T, reject = false): void {
  const record = records.find((item) => item.id === id && !item.settled);
  if (!record) throw new Error(`Missing fixture request ${id}.`);
  record.settled = true;
  if (reject) record.reject(new Error('Fixture failure with private source detail.'));
  else record.resolve(value);
}
function snapshots<T>(records: Deferred<T>[]) {
  return records.map(({ id, value, signal, settled }) => ({ id, value, settled, aborted: signal?.aborted ?? false }));
}

/** Uses the public hook outside the popup, including the complete node paths. */
function CustomSelection() {
  const selection = useCascaderSelection();
  return <ul aria-label="Custom selection paths" data-testid="custom-paths" className="space-y-1 text-xs text-muted-foreground">
    {selection.items.map((item) => <li key={item.value} data-value={item.value}
      data-path-values={JSON.stringify(item.path.map((node) => node.value))}>{item.pathLabel}</li>)}
  </ul>;
}

function Fixture() {
  const [configuration, configure] = React.useState(DEFAULT);
  const [generation, reset] = React.useState(0);
  const [changes, recordChanges] = React.useState<readonly (readonly string[])[]>([]);
  const getChildren = React.useCallback<CascaderChildrenLoader>((node, { signal }) =>
    pending(node?.value ?? null, children, signal), []);
  const search = React.useCallback<CascaderSearchLoader>((query, { signal }) =>
    pending(query, searches, signal), []);
  const command = React.useCallback((name: string) => pending(name, actions), []);
  React.useEffect(() => {
    window.__cascaderHarness = {
      configure(options) { configure({ ...DEFAULT, ...options }); reset((value) => value + 1); recordChanges([]); },
      scope(value) { configure((previous) => ({ ...previous, scope: value })); },
      flags(options) { configure((previous) => ({ ...previous, ...options })); },
      requests: () => snapshots(children), searches: () => snapshots(searches), actions: () => snapshots(actions),
      resolveChildren: (id, nodes) => settle(children, id, nodes),
      rejectChildren: (id) => settle(children, id, [], true),
      resolveSearch: (id, results) => settle(searches, id, results),
      resolveAction: (id) => settle(actions, id, undefined),
      rejectAction: (id) => settle(actions, id, undefined, true),
      events: () => [...events], errors: () => [...errors],
    };
  }, []);
  return <main className="min-h-screen bg-background px-5 py-10 text-foreground sm:px-12">
    <section className="mx-auto max-w-xl space-y-6 rounded-2xl border border-border bg-card p-6 shadow-sm">
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Attribute selector</p>
        <h1 className="text-xl font-semibold tracking-tight">Connect the right data</h1>
        <p className="text-sm text-muted-foreground">Choose nested attributes, search every collection, or import a new source.</p>
      </header>
      <Cascader key={generation} label="Attributes" id="attribute-picker" name="attributes" items={ITEMS}
        scopeKey={configuration.scope} multiple max={configuration.max} defaultValue={configuration.defaultValues}
        disabled={configuration.disabled} readOnly={configuration.readOnly}
        getChildren={configuration.kind === 'static' ? undefined : getChildren}
        onSearch={configuration.kind === 'remote' ? search : undefined} searchDebounce={25}
        onValueChange={(values) => recordChanges((previous) => [...previous, values])}
        onLoadError={(error) => errors.push({ code: error.code, operation: error.operation })}>
        <div className="space-y-3">
          <CascaderTrigger className="w-full"><CascaderValue placeholder="Choose attributes" /></CascaderTrigger>
          <CascaderSelectionChips emptyLabel="No attributes selected" />
          <CustomSelection />
        </div>
        <CascaderContent>
          <CascaderPanel>
            <CascaderInput />
            <CascaderBreadcrumb />
            <CascaderList><CascaderItems /></CascaderList>
            <CascaderFooter>
              <CascaderAction onSelect={() => command('create')}><Plus className="size-4" />Create attribute</CascaderAction>
              <CascaderImportMenu actions={[
                { id: 'csv', label: 'Import CSV', icon: <FileSpreadsheet className="size-4" />, onSelect: () => command('csv') },
                { id: 'clipboard', label: 'Paste from clipboard', icon: <Clipboard className="size-4" />, onSelect: () => command('clipboard') },
              ]} />
            </CascaderFooter>
          </CascaderPanel>
        </CascaderContent>
      </Cascader>
      <output data-testid="selection-changes" className="sr-only">{JSON.stringify(changes)}</output>
      <span data-testid="fixture-ready" className="sr-only">Ready</span>
    </section>
  </main>;
}

declare global {
  interface Window {
    __cascaderHarness: {
      configure: (options: Partial<Configuration>) => void;
      scope: (value: string) => void;
      flags: (options: Pick<Partial<Configuration>, 'disabled' | 'readOnly'>) => void;
      requests: () => { id: number; value: string | null; settled: boolean; aborted: boolean }[];
      searches: () => { id: number; value: string | null; settled: boolean; aborted: boolean }[];
      actions: () => { id: number; value: string | null; settled: boolean; aborted: boolean }[];
      resolveChildren: (id: number, nodes: readonly CascaderNode[]) => void;
      rejectChildren: (id: number) => void;
      resolveSearch: (id: number, results: readonly CascaderSearchResult[]) => void;
      resolveAction: (id: number) => void;
      rejectAction: (id: number) => void;
      events: () => { code: string; metadata?: Record<string, unknown>; message: string }[];
      errors: () => { operation: string; code: string }[];
    };
  }
}

createRoot(document.getElementById('root')!).render(<Fixture />);

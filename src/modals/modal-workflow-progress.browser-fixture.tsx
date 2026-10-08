/** Synthetic SDK receipts only. Never starts a workflow or reaches a real server. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../frontend/client/client-context';
import { AuthorizationDataBoundaryController } from '../frontend/client/authorization-data-boundary';
import type { Client } from '../frontend/client/sdk';
import type { WorkflowClientInstanceRecord } from '../workflows/types';
import { configureFrontendObservability } from '../frontend/client/observability';
import { ModalWorkflowProgress } from './modal-workflow-progress';

type Receipt = { action: string; id: string; resolve(): void; reject(): void };
const calls: Receipt[] = [];
const diagnostics: string[] = [];
configureFrontendObservability({ console: false, http: false, sink: { emit(event) { diagnostics.push(event.code); } } });
function instance(id: string): WorkflowClientInstanceRecord {
  return { instance_id: id, tenant_id: null, definition_id: 'synthetic-definition', name: 'synthetic-workflow',
    status: 'running', current_step: 0, input: null, output: null, error: null, started_by: 'synthetic-user',
    created_at: '2030-01-01', updated_at: '2030-01-01', completed_at: null };
}
const rows = { A: instance('A'), B: instance('B') };
const empty = {};
const client = {
  _authorizationDataBoundary: new AuthorizationDataBoundaryController(),
  connected: true, onConnectionChange() { return () => {}; },
  collection(name: string) {
    const records = name === 'workflow_instances' ? rows : empty;
    return { getAll: () => records, getOne: (id: string) => records[id as keyof typeof records] ?? null,
      subscribe() { return () => {}; }, subscribeOne() { return () => {}; } };
  },
  fetch: async (path: string) => rows[decodeURIComponent(path.slice('/workflows/'.length)) as keyof typeof rows],
  api: { workflows: new Proxy({}, { get(_target, id) {
    if (id === 'post') return () => { throw new Error('The progress view must not start work.'); };
    return Object.fromEntries(['pause', 'resume', 'cancel'].map(action => [action, { post: () => new Promise((resolve, reject) => {
      calls.push({ action, id: String(id), resolve: () => resolve({ data: { success: true }, error: null }),
        reject: () => reject(new Error('PRIVATE_SYNTHETIC_RECEIPT')) });
    }) }]));
  } }) },
} as unknown as Client;

function Fixture() {
  const [runId, select] = React.useState('A');
  const [workflowName, rename] = React.useState('synthetic-workflow');
  const [open, setOpen] = React.useState(true);
  const [enabled, enable] = React.useState(true);
  React.useEffect(() => {
    Object.assign(window, { workflowFixture: {
      select, rename, close: () => setOpen(false), reopen: () => setOpen(true), enable,
      calls: () => calls.map(({ action, id }) => ({ action, id })),
      resolve: (index: number) => calls[index]!.resolve(), reject: (index: number) => calls[index]!.reject(),
      diagnostics: () => [...diagnostics],
    } });
  }, []);
  return <ClientProvider client={client}>{open && <ModalWorkflowProgress runId={runId} workflowName={workflowName}
    capabilities={enabled ? { pause: true, resume: true, cancel: true } : {}} />}</ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);

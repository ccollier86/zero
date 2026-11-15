/** Synthetic UI transport fixture, not a managed-runtime or provider qualification. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import { createJobsClient } from '../../frontend/client/jobs-client';
import type { Client } from '../../frontend/client/sdk';
import type { JobScheduleSummary } from '../../jobs/contracts';
import { JobsWorkspace } from './jobs-workspace';
import { ModalManager } from '../../modals/modal-manager';
import { TooltipProvider } from '../tooltip';
import { configureFrontendObservability } from '../../frontend/client/observability';

const listeners = new Set<() => void>(), streams = new Set<() => void>();
let tenant = 'north', denied = false, uncertain = false, writes = 0;
const allowed = { allowed: true as const, reason: null };
function job(index: number): JobScheduleSummary {
  return { id: `${tenant}-job-${index}`, definition: index === 0 ? 'reports.daily' : 'notifications.summary', definitionVersion: 'v1',
    ownerId: 'synthetic-operator', runAs: index % 3 ? 'actor' : 'service', control: index === 2 ? 'paused' : 'active', revision: 1, generation: 1,
    createdAt: 1794750000000, updatedAt: 1794750000000, nextDueAt: 1794850000000 + index * 60000,
    skipped: false, blockedCode: index === 1 ? 'JOBS_CAPACITY' : null, latestOccurrence: index === 0 ? occurrence() : null,
    activeOccurrence: null, actions: { pause: allowed, resume: allowed, update: allowed, cancel: allowed, runNow: allowed } };
}
function occurrence() { return { id: 'synthetic-occurrence', generation: 1, scheduledAt: 1794700000000, state: 'terminal' as const,
  workflowId: 'synthetic-workflow', terminalStatus: 'completed', errorCode: null, createdAt: 1794700000000, updatedAt: 1794700060000 }; }
let rows = Array.from({ length: 27 }, (_, index) => job(index));
const receipts = new Map<string, unknown>();
const auth = { user: { userId: 'synthetic-operator' }, activeTenant: { tenantId: tenant }, isAuthenticated: true, isLoading: false, isRestoring: false,
  authorizationState: { status: 'ready' }, get authorizationScopeKey() { return tenant; },
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
const page = (url: URL) => { const matches = rows.filter(row => !url.searchParams.has('control') || row.control === url.searchParams.get('control'));
  const offset = +(url.searchParams.get('offset') ?? 0), limit = +(url.searchParams.get('limit') ?? 25);
  return { items: matches.slice(offset, offset + limit), total: matches.length }; };
function view(row: JobScheduleSummary) { const { nextDueAt, skipped, blockedCode, latestOccurrence, activeOccurrence, actions, ...result } = row; return result; }
const jobs = createJobsClient(async <T,>(path: string, options?: { method?: string; body?: unknown }) => {
  const url = new URL(path, location.origin), tail = url.pathname.replace('/jobs', '');
  if (denied) throw Object.assign(new Error('Synthetic read denied.'), { status: 403, code: 'JOBS_FORBIDDEN' });
  if (tail === '/definitions') return { items: [{ name: 'reports.daily', version: 'v1', default: true, ownership: { actor: true, service: true } }] } as T;
  if (tail.startsWith('/receipts/')) return { receipt: receipts.get(decodeURIComponent(tail.slice('/receipts/'.length))) ?? null } as T;
  if (tail === '/schedules') return page(url) as T;
  const [, , id, action] = tail.split('/'), row = rows.find(row => row.id === id);
  if (!row) throw Object.assign(new Error('Synthetic missing job.'), { status: 404, code: 'JOBS_NOT_FOUND' });
  if (action === 'occurrences') return { items: [occurrence()], total: 1 } as T;
  if (options?.method === 'POST') {
    writes++;
    const body = options.body as { expectedRevision: number; idempotencyKey: string };
    if (body.expectedRevision !== row.revision) throw Object.assign(new Error('Synthetic changed revision.'), { status: 409, code: 'JOBS_REVISION_CONFLICT' });
    const next = { ...row, id: action === 'runNow' ? 'synthetic-new-oneoff' : row.id,
      control: action === 'cancel' ? 'cancelled' as const : action === 'pause' ? 'paused' as const : 'active' as const,
      revision: action === 'runNow' ? 1 : row.revision + 1, updatedAt: row.updatedAt + 1 };
    if (action === 'runNow') rows = [next, ...rows]; else rows = rows.map(value => value === row ? next : value);
    const accepted = view(next); receipts.set(body.idempotencyKey, accepted);
    for (const notify of streams) notify();
    if (uncertain) throw new Error('Synthetic connection lost after acceptance.');
    return accepted as T;
  }
  return { ...row, timing: { kind: 'once', at: new Date(1794850000000).toISOString(), maxLatenessMs: 60_000 }, overlap: 'skip' } as T;
}, async path => {
  const url = new URL(path, location.origin), encoder = new TextEncoder();
  let remove = () => {};
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    const notify = (invalidated = true) => controller.enqueue(encoder.encode('data: ' + JSON.stringify(denied ? { version: 1, error: true } : { version: 1, value: page(url), invalidated }) + '\n\n'));
    remove = () => { streams.delete(notify); };
    streams.add(notify); notify(false);
  }, cancel() { remove(); } });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
});
const client = { auth, jobs, get user() { return auth.user; }, _tables: {} } as unknown as Client;
configureFrontendObservability({ console: false, http: false });
function Fixture() {
  const [count, setCount] = React.useState(0);
  const [created, setCreated] = React.useState(false);
  const update = () => { for (const notify of streams) notify(); setCount(value => value + 1); };
  return <ClientProvider client={client}><TooltipProvider><ModalManager recedeSurface={false}>
    <main className="flex h-screen min-h-0 flex-col bg-background p-4 text-foreground">
      <nav aria-label="Synthetic test controls" className="mb-3 flex flex-wrap gap-4 text-xs">
        <button onClick={() => { uncertain = !uncertain; setCount(value => value + 1); }}>Toggle uncertain acceptance</button>
        <button onClick={() => { denied = !denied; update(); }}>Toggle denied reads</button>
        <button onClick={() => { rows = [job(rows.length), ...rows]; update(); }}>Add synthetic job</button>
        <button onClick={() => { rows = rows.map(row => row.id === `${tenant}-job-0` ? { ...row, revision: row.revision + 1, updatedAt: row.updatedAt + 1 } : row); update(); }}>Change hidden selected job</button>
        <button onClick={() => { tenant = tenant === 'north' ? 'south' : 'north'; auth.activeTenant = { tenantId: tenant }; jobs.clear(); rows = Array.from({ length: 3 }, (_, index) => job(index)); for (const listener of listeners) listener(); update(); }}>Replace synthetic scope</button>
        <output aria-label="Synthetic write count">Writes: {writes} · {count}</output>
      </nav>
      {created && <p role="status">Synthetic application editor requested.</p>}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border"><JobsWorkspace definitionLabels={{ 'reports.daily': 'Daily reports', 'notifications.summary': 'Notification summary' }} onCreate={() => setCreated(true)} /></div>
    </main>
  </ModalManager></TooltipProvider></ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);

/** Local synthetic UI only; no account/session/provider data or external network. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import { configureFrontendObservability } from '../../frontend/client/observability';
import type { Client } from '../../frontend/client/sdk';
import type { LoggingClient } from '../../logging/logging-api-contracts';
import type { LoggingPage, LoggingQuery, StoredLoggingEvent } from '../../logging/logging-contracts';
import { LoggingWorkspace } from './logging-workspace';
import { ModalManager } from '../../modals';
import { TooltipProvider } from '../tooltip';

const listeners = new Set<() => void>(), watches = new Set<() => void>();
const boundary = new AuthorizationDataBoundaryController(); let tenant = 'tenant-a', ordinal = 65;
const auth = { user: { userId: 'fixture-user' }, activeTenant: { tenantId: tenant }, isAuthenticated: true, isLoading: false, isRestoring: false,
  authorizationState: { status: 'ready' }, get authorizationScopeKey() { return tenant; }, sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
function row(n: number): StoredLoggingEvent { return { ordinal: n, ingestedAt: Date.now(), event: { version: 1, id: 'event-' + n, sourceId: 'fixture-source', origin: 'backend', policyVersion: 'fixture-v1',
  requestId: null, correlationId: null, scope: { kind: 'tenant', tenantId: tenant }, actor: { kind: 'user', id: tenant + '-user', sessionId: 'fixture-session', initiatorId: null },
  stream: 'audit', family: 'records', action: 'record.read', level: 'info', outcome: n % 9 === 0 ? 'denied' : 'succeeded', evidence: n % 5 === 0 ? 'browser-observed' : 'server-confirmed',
  occurredAt: 1700000000000 + n * 1000, target: { type: 'record', id: 'record-' + n }, metadata: { count: 1 } } }; }
function page(q: LoggingQuery = {}): LoggingPage {
  const water = Math.min(q.highWaterOrdinal ?? ordinal, ordinal);
  const all = Array.from({ length: water }, (_, i) => row(water - i)).filter(r => (!q.eventIds || q.eventIds.includes(JSON.stringify([r.event.sourceId, r.event.id]))) && (!q.beforeOrdinal || r.ordinal < q.beforeOrdinal) && (!q.actorId || r.event.actor.id === q.actorId) && (!q.outcome || r.event.outcome === q.outcome) && (!q.action || r.event.action === q.action) && (!q.targetId || r.event.target?.id === q.targetId));
  const events = all.slice(0, q.limit ?? 50), hasMore = all.length > events.length;
  return { events, highWaterOrdinal: water, hasMore, nextBeforeOrdinal: hasMore ? events.at(-1)!.ordinal : null };
}
const queries: LoggingQuery[] = [];
(window as unknown as { __loggingQueries: LoggingQuery[] }).__loggingQueries = queries;
const client = { auth, _authorizationDataBoundary: boundary, logging: { page: async (_stream: unknown, q: LoggingQuery) => { queries.push(q); return page(q); },
  watch(_s: unknown, q: LoggingQuery, fn: (p: LoggingPage) => void, options: Parameters<LoggingClient['watch']>[3] = {}) {
    let after = options.afterOrdinal ?? ordinal;
    const notify = () => {
      options.onStatus?.('live'); fn(page({ ...q, limit: 1 }));
      const events = page({ ...q, limit: 100 }).events.filter(row => row.ordinal > after).slice().reverse();
      options.onChanges?.({ events, afterOrdinal: after, throughOrdinal: ordinal, highWaterOrdinal: ordinal, hasMore: false }); after = ordinal;
    };
    watches.add(notify); queueMicrotask(notify);
    return () => { watches.delete(notify); };
  },
  export: async () => { throw new Error('Denied'); } }, _tables: {},
} as unknown as Client;
configureFrontendObservability({ console: false, http: false });
function Fixture() {
  return <ClientProvider client={client}><TooltipProvider><ModalManager><main className="mx-auto max-w-6xl space-y-4 p-5">
    <div className="flex gap-4 text-xs"><button onClick={() => { ordinal++; for (const fn of watches) fn(); }}>Add synthetic activity</button>
      <button onClick={() => { ordinal += 3; for (const fn of watches) fn(); }}>Add synthetic burst</button>
      <button onClick={() => { tenant = tenant === 'tenant-a' ? 'tenant-b' : 'tenant-a'; auth.activeTenant = { tenantId: tenant }; for (const fn of listeners) fn(); }}>Change synthetic scope</button>
      <button onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</button></div>
    <LoggingWorkspace allowExport={false} />
  </main></ModalManager></TooltipProvider></ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

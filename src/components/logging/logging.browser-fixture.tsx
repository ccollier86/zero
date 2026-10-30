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
import type { LoggingPerson } from '../../logging/logging-directory-contracts';

const listeners = new Set<() => void>(), watches = new Set<() => void>();
let disconnected = false;
const boundary = new AuthorizationDataBoundaryController(); let tenant = 'tenant-a', ordinal = 65;
const varied = new URLSearchParams(location.search).has('readable');
const person = (second = false): LoggingPerson => ({ id: tenant + (second ? '-second' : '-user'), username: tenant === 'tenant-a' ? second ? 'blair' : 'avery' : second ? 'morgan' : 'jordan',
  name: tenant === 'tenant-a' ? second ? 'Blair Example' : 'Avery Example' : second ? 'Morgan Example' : 'Jordan Example', revision: 1 });
const photos = { directoryCalls: 0, deliveries: 0, revoked: 0, created: 0, completed: 0 };
(window as any).__loggingPhotos = photos;
const revoke = URL.revokeObjectURL.bind(URL); URL.revokeObjectURL = url => { photos.revoked++; revoke(url); };
const create = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { photos.created++; return create(blob); };
const held: (() => void)[] = []; (window as any).__releaseLoggingPhotos = () => { for (const release of held.splice(0)) release(); };
const auth = { user: { userId: 'fixture-user' }, activeTenant: { tenantId: tenant }, isAuthenticated: true, isLoading: false, isRestoring: false,
  authorizationState: { status: 'ready' }, get authorizationScopeKey() { return tenant; }, sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }, subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
function row(n: number): StoredLoggingEvent { const automated = varied && n % 11 === 0; const result: StoredLoggingEvent = { ordinal: n, ingestedAt: Date.now(), event: { version: 1, id: 'event-' + n, sourceId: 'fixture-source', origin: 'backend', policyVersion: 'fixture-v1',
  requestId: null, correlationId: null, scope: { kind: 'tenant', tenantId: tenant }, actor: { kind: automated ? 'system' : 'user', id: automated ? 'zero.database' : person(varied && n % 3 === 0).id, sessionId: 'fixture-session', initiatorId: null },
  stream: 'audit', family: 'records', action: varied ? ['record.created', 'record.updated', 'record.deleted'][n % 3]! : 'record.read', level: 'info', outcome: varied ? 'succeeded' : n % 9 === 0 ? 'denied' : 'succeeded', evidence: !varied && n % 5 === 0 ? 'browser-observed' : 'server-confirmed',
  occurredAt: 1700000000000 + n * 1000, target: { type: varied ? n % 2 === 0 ? 'table.tasks' : 'table.items' : 'record', id: 'record-' + n }, metadata: { count: 1 } } };
  return n === 65 && new URLSearchParams(location.search).has('changes') ? { ...result, event: { ...result.event, version: 2, action: 'record.updated', outcome: 'succeeded', evidence: 'server-confirmed',
    target: { type: 'table.items', id: 'invoice-7' }, detail: { kind: 'record-change', table: 'items', sequence: 7,
      changes: [{ field: 'status', kind: 'value', beforePresent: true, afterPresent: true, before: 'draft', after: 'approved' },
        { field: 'private_note', kind: 'redacted', beforePresent: true, afterPresent: true }], omittedFields: 0 } } } : result;
}
function page(q: LoggingQuery = {}): LoggingPage {
  const water = Math.min(q.highWaterOrdinal ?? ordinal, ordinal);
  const all = Array.from({ length: water }, (_, i) => row(water - i)).filter(r => (!q.eventIds || q.eventIds.includes(JSON.stringify([r.event.sourceId, r.event.id]))) && (!q.actorId || r.event.actor.id === q.actorId) && (!q.outcome || r.event.outcome === q.outcome) && (!q.action || r.event.action === q.action) && (!q.targetId || r.event.target?.id === q.targetId)
    && (!q.sessionId || r.event.actor.sessionId === q.sessionId) && (!q.targetType || r.event.target?.type === q.targetType) && (!q.family || r.event.family === q.family) && (!q.level || r.event.level === q.level) && (q.since === undefined || r.event.occurredAt >= q.since) && (q.until === undefined || r.event.occurredAt < q.until));
  const filtered = all.filter(r => !q.userId || r.event.actor.kind === 'user' && r.event.actor.id === q.userId || r.event.actor.initiatorId === q.userId);
  const eligible = filtered.filter(r => !q.beforeOrdinal || r.ordinal < q.beforeOrdinal), events = eligible.slice(0, q.limit ?? 50), hasMore = eligible.length > events.length;
  return { events, total: filtered.length, people: [person(), person(true)].filter(person => events.some(row => row.event.actor.kind === 'user' && row.event.actor.id === person.id)), highWaterOrdinal: water, hasMore, nextBeforeOrdinal: hasMore ? events.at(-1)!.ordinal : null };
}
const queries: LoggingQuery[] = [];
(window as unknown as { __loggingQueries: LoggingQuery[] }).__loggingQueries = queries;
const client = { auth, _authorizationDataBoundary: boundary, logging: { page: async (_stream: unknown, q: LoggingQuery) => { queries.push(q); return page(q); },
  people: async ({ search = '' } = {}) => ({ items: [person(), person(true)].filter(person => (person.name + person.username).toLowerCase().includes(search.toLowerCase())), hasMore: false, nextCursor: null }),
  tables: async () => [{ type: 'table.items', names: ['items'] }, { type: 'table.tasks', names: ['tasks'] }],
  watch(_s: unknown, q: LoggingQuery, fn: (p: LoggingPage) => void, options: Parameters<LoggingClient['watch']>[3] = {}) {
    let after = options.afterOrdinal ?? ordinal;
    const notify = () => {
      if (disconnected) { options.onStatus?.('reconnecting'); return; }
      options.onStatus?.('live'); fn(page({ ...q, limit: 1 }));
      const events = page({ ...q, limit: 100 }).events.filter(row => row.ordinal > after).slice().reverse();
      options.onChanges?.({ events, afterOrdinal: after, throughOrdinal: ordinal, highWaterOrdinal: ordinal, hasMore: false }); after = ordinal;
    };
    watches.add(notify); queueMicrotask(notify);
    return () => { watches.delete(notify); };
  },
  export: async () => { throw new Error('Denied'); } }, _tables: {},
  userAvatar: { async directory(userId: string) { photos.directoryCalls++; if (new URLSearchParams(location.search).has('no-photos')) throw new Error('Synthetic photo unavailable'); return { userId, displayName: 'Synthetic photo', asset: { userId } }; },
    async deliver(asset: { userId: string }) { photos.deliveries++; if (new URLSearchParams(location.search).has('hold-photos') && asset.userId.startsWith('tenant-a')) await new Promise<void>(resolve => held.push(resolve));
      photos.completed++; return new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#eee5d9"/><circle cx="32" cy="24" r="13" fill="#836b57"/><ellipse cx="32" cy="60" rx="24" ry="22" fill="#514638"/></svg>'], { type: 'image/svg+xml' }); } },
} as unknown as Client;
configureFrontendObservability({ console: false, http: false });
function changeScope() { tenant = tenant === 'tenant-a' ? 'tenant-b' : 'tenant-a'; auth.activeTenant = { tenantId: tenant }; for (const fn of listeners) fn(); }
(window as unknown as { __loggingChangeScope: () => void }).__loggingChangeScope = changeScope;
function Fixture() {
  return <ClientProvider client={client}><TooltipProvider><ModalManager><main className="mx-auto max-w-6xl space-y-4 p-5">
    <div className="flex gap-4 text-xs"><button onClick={() => { ordinal++; for (const fn of watches) fn(); }}>Add synthetic activity</button>
      <button onClick={() => { ordinal += 3; for (const fn of watches) fn(); }}>Add synthetic burst</button>
      <button onClick={changeScope}>Change synthetic scope</button>
      <button onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</button></div>
    <button onClick={() => { disconnected = !disconnected; for (const notify of watches) notify(); }}>Toggle live connection</button>
    <LoggingWorkspace allowExport={false} initialQuery={{ projection: 'events' }} presentation={{ tables: { items: 'Projects', tasks: 'Tasks' } }} />
  </main></ModalManager></TooltipProvider></ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

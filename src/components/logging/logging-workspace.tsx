'use client';
/** Self-wired, scope-masked investigation organism composed from Zero DataTable, Select, ScrollArea and managed dialogs. */
import * as React from 'react';
import { Activity, CircleHelp, SearchX, ShieldCheck } from 'lucide-react';
import { Download } from '../animate-ui/icons/download';
import { RotateCw as RefreshCw } from '../animate-ui/icons/rotate-cw';
import { DataTable } from '../data-table';
import { Button } from '../ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ModalManager, modals } from '../../modals';
import { useModalHostPresent } from '../../modals/modal-host-context';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { loggingTableSchema as schema } from './logging-table-schema';
import { Checkbox } from '../ui/checkbox';
import type { LoggingQuery, LoggingStream } from '../../logging/logging-contracts';
import { createLoggingTableSource } from './logging-table-source';
import { LoggingEventDetail, LoggingFilters } from './logging-parts';
import { loggingColumns } from './logging-columns';
import type { LoggingTableRow } from './logging-table-source';
import { cn } from '../../lib/utils';
import type { LoggingPerson, LoggingTableChoice } from '../../logging/logging-directory-contracts';
import type { LoggingPresentation } from './logging-readable-activity';
import type { LoggingRecordLinkResolver } from './logging-record-link';

const ACCESS_ERROR = 'Activity access could not be revalidated. Evidence is hidden until a fresh authorized snapshot succeeds.';
const EMPTY_TABLE_CHOICES: readonly LoggingTableChoice[] = Object.freeze([]);
export interface LoggingWorkspaceProps { className?: string; defaultStream?: LoggingStream; initialQuery?: LoggingQuery; allowExport?: boolean; scope?: 'current' | 'platform'; presentation?: LoggingPresentation; resolveRecordLink?: LoggingRecordLinkResolver }
/** UI capability flags affect presentation only. Guardian enforces every read and export on the server. */
export function LoggingWorkspace(props: LoggingWorkspaceProps) {
  const hosted = useModalHostPresent();
  return hosted ? <Workspace {...props} /> : <ModalManager><Workspace {...props} /></ModalManager>;
}
function Workspace({ className, defaultStream = 'audit', initialQuery = {}, allowExport = true, scope = 'current', presentation, resolveRecordLink }: LoggingWorkspaceProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const [stream, setStream] = React.useState(defaultStream), [query, setQuery] = React.useState(initialQuery), [revision, setRevision] = React.useState(0);
  const [directory, setDirectory] = React.useState<{ key: string; tables: readonly LoggingTableChoice[]; error: boolean } | null>(null);
  const [directoryRevision, setDirectoryRevision] = React.useState(0);
  const [person, setPerson] = React.useState<{ key: string; value?: LoggingPerson } | null>(null);
  const [error, setError] = React.useState<{ key: string; message: string } | null>(null), [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [blockedKey, setBlockedKey] = React.useState<string | null>(null);
  const [connection, setConnection] = React.useState<{ key: string; status: 'connecting' | 'live' | 'reconnecting' } | null>(null);
  const [pendingExport, setPendingExport] = React.useState<{ key: string; id: string } | null>(null);
  const key = JSON.stringify([boundary.key, scope, stream, query]), current = React.useRef(key); current.current = key;
  const directoryKey = JSON.stringify([boundary.key, scope]), directoryCurrent = React.useRef(directoryKey); directoryCurrent.current = directoryKey;
  const tables = directory?.key === directoryKey ? directory.tables : EMPTY_TABLE_CHOICES;
  const selectedPerson = person?.key === directoryKey ? person.value : undefined;
  React.useEffect(() => {
    if (!client || !boundary.ready) return;
    const abort = new AbortController(), captured = directoryKey;
    void Promise.resolve().then(() => client.logging.tables({ signal: abort.signal })).then(tables => {
      if (!abort.signal.aborted && directoryCurrent.current === captured) setDirectory({ key: captured, tables, error: false });
    }).catch(() => { if (!abort.signal.aborted && directoryCurrent.current === captured) setDirectory({ key: captured, tables: [], error: true }); });
    return () => abort.abort();
  }, [client, boundary.ready, directoryKey, directoryRevision]);
  const lifetime = React.useRef(0);
  React.useEffect(() => () => { lifetime.current++; }, []);
  const busy = busyKey === key;
  const effectiveQuery: LoggingQuery = { ...query, projection: query.projection ?? (stream === 'audit' ? 'activities' : 'events') };
  const source = React.useMemo(() => client ? createLoggingTableSource({ page: scope === 'platform' ? client.logging.platformPage : client.logging.page, watch: client.logging.watch }, stream, effectiveQuery, { platform: scope === 'platform' }) : null, [client, key]);
  React.useEffect(() => {
    if (!source || !boundary.ready || !boundary.stable) return;
    return source.watchStatus(status => {
      if (current.current !== key) return;
      setConnection({ key, status });
      if (status === 'live') { setBlockedKey(value => value === key ? null : value); setError(value => value?.message === ACCESS_ERROR ? null : value); }
      else if (status === 'reconnecting') {
        setBlockedKey(key); setError({ key, message: ACCESS_ERROR });
      }
    });
  }, [source, boundary.ready, boundary.stable, key]);
  const refresh = () => { setError(null); setRevision(n => n + 1); };
  const exportEvents = async () => {
    if (!client || busy) return;
    const captured = key, generation = lifetime.current;
    const active = () => current.current === captured && lifetime.current === generation;
    setBusyKey(key); setError(null);
    try {
      const policy = await client.logging.collectionPolicy();
      if (!active()) return;
      if (policy.durableExports) {
        // Keep an idempotent request identity even if create loses its response.
        // Checking/retrying a queued export must not create another private job.
        const id = pendingExport?.key === captured ? pendingExport.id : crypto.randomUUID();
        setPendingExport({ key: captured, id });
        const existing = pendingExport?.key === captured ? await client.logging.exportJob(id) : null;
        if (!active()) return;
        const job = existing ?? await client.logging.createExport({ id, stream, query: effectiveQuery });
        if (!active()) return;
        if (job.state === 'pending') return;
        if (job.state !== 'ready') { setPendingExport(null); setError({ key: captured, message: 'The retained export is no longer available. Request a new export when ready.' }); return; }
        const blob = await client.logging.downloadExport(job.id);
        if (!active()) return;
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `zero-logging-${job.id}.ndjson`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setPendingExport(null);
        if (!job.complete) setError({ key: captured, message: `Export is a bounded segment (${job.count} events), not the complete investigation. Continue with its pinned high-water and continuation ordinal.` });
        return;
      }
      const result = await client.logging.export(stream, effectiveQuery);
      if (!active()) return;
      // The manifest remains with the evidence. Generating a browser download is not proof of receipt.
      const manifest = JSON.stringify({ ...result, ndjson: undefined });
      const url = URL.createObjectURL(new Blob([JSON.stringify({ manifest: JSON.parse(manifest) }) + '\n', result.ndjson], { type: 'application/x-ndjson' }));
      const link = document.createElement('a'); link.href = url; link.download = `zero-logging-${result.id}.ndjson`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (!result.complete) setError({ key: captured, message: `Export is a bounded segment (${result.count} events), not the complete investigation. Narrow filters or continue through client.logging.export().` });
    } catch { if (active()) setError({ key: captured, message: 'Export was not completed. Check your export permission and try a narrower query.' }); }
    finally { if (lifetime.current === generation) setBusyKey(value => value === captured ? null : value); }
  };
  const rowTrigger = React.useRef<Element | null>(null);
  const inspect = React.useCallback((row: LoggingTableRow, trigger: Element | null) => {
    modals.show({ title: row.stored.activity ? 'Activity details' : 'Event evidence', description: 'Retained activity · current authorized scope', icon: <Activity className="size-4" />, size: 'lg', trigger,
      body: <LoggingEventDetail stored={row.stored} scopeKey={boundary.key} person={row.person} initiator={row.initiator} tables={tables} presentation={presentation} platform={scope === 'platform'} resolveRecordLink={resolveRecordLink} /> });
  }, [boundary.key, tables, presentation, scope, resolveRecordLink]);
  const filterUser = React.useCallback((id: string, resolved: LoggingPerson | null) => {
    setPerson({ key: directoryKey, value: resolved ?? undefined }); setQuery(query => { const next = { ...query, userId: id }; delete next.actorId; return next; }); setRevision(n => n + 1);
  }, [directoryKey]);
  const filterTarget = React.useCallback((target: { type: string; id: string }) => {
    setQuery(query => ({ ...query, targetType: target.type, targetId: target.id })); setRevision(n => n + 1);
  }, []);
  const columns = React.useMemo(() => loggingColumns(inspect, { tables, presentation, onUser: filterUser, onTarget: filterTarget }), [inspect, tables, presentation, filterUser, filterTarget]);
  if (!client || !source || !boundary.ready || !boundary.stable) return <section role="status" className="p-4 text-sm text-muted-foreground">Logging requires a ready authenticated AppProvider.</section>;
  const status = connection?.key === key ? connection.status : 'connecting';
  return <section data-slot="logging-workspace" className={cn('min-w-0 space-y-4', className)} aria-label="Logging investigation">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-start gap-3"><div className="rounded-xl border border-primary/15 bg-primary/5 p-2 text-primary"><Activity className="size-5" /></div><div><h2 className="text-lg font-semibold tracking-tight">Activity</h2><p className="mt-0.5 text-sm text-muted-foreground">See who did what, when, and what happened.</p></div></div><div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => { refresh(); setDirectoryRevision(n => n + 1); }}><RefreshCw className="size-3.5" />Refresh</Button>
      {allowExport && scope !== 'platform' && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void exportEvents(); }}><Download className="size-3.5" />{busy ? 'Exporting…' : pendingExport?.key === key ? 'Check export' : 'Export'}</Button>}
    </div></header>
    <Tabs value={stream} onValueChange={value => { setStream(value as LoggingStream); refresh(); }}>
    <div className="flex flex-wrap items-center justify-between gap-2"><TabsList aria-label="Log stream"><TabsTrigger value="audit"><ShieldCheck className="size-3.5" />Audit activity</TabsTrigger><TabsTrigger value="operational"><Activity className="size-3.5" />Diagnostics</TabsTrigger></TabsList>
      <span role="status" aria-label="Activity connection" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><span aria-hidden="true" className={cn('size-1.5 rounded-full', source.live && status === 'live' ? 'bg-success' : 'bg-muted-foreground')} />{!source.live ? 'Snapshot only' : status === 'live' ? 'Live updates connected' : status === 'connecting' ? 'Connecting to live updates…' : 'Revalidating access…'}</span></div>
    <TabsContent value={stream} className="mt-2 space-y-3">
    <div className="rounded-xl border border-border bg-card p-3"><LoggingFilters value={query} tables={tables} presentation={presentation} selectedPerson={selectedPerson}
      onPersonChange={value => setPerson({ key: directoryKey, value })} onApply={next => { setQuery(previous => ({ ...next, projection: previous.projection })); refresh(); }} />
      {stream === 'audit' && <label className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={effectiveQuery.projection === 'events'} onCheckedChange={checked => { setQuery(query => ({ ...query, projection: checked === true ? 'events' : 'activities' })); refresh(); }} />Show raw supporting evidence instead of grouped activities</label>}
      {directory?.key === directoryKey && directory.error && <p role="status" className="mt-2 text-xs text-muted-foreground">Table choices could not be loaded. Existing filters remain active; refresh to retry.</p>}
    </div>
    {error?.key === key && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error.message}</p>}
    {!busy && pendingExport?.key === key && error?.key !== key && <p role="status" className="text-xs text-muted-foreground">Your private export request is retained. Use Check export to download it when ready.</p>}
    {blockedKey === key ? <div role="status" className="rounded-xl border border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">Protected evidence is hidden while the connection is revalidated.</div> : <div
      onClickCapture={event => { rowTrigger.current = event.target instanceof Element ? event.target.closest('[data-row-id]') : null; }}
      onKeyDownCapture={event => { rowTrigger.current = event.target instanceof Element ? event.target.closest('[data-row-id]') : null; }}>
      <DataTable key={key} refreshKey={revision} schema={schema} source={source} columns={schema.fieldNames as string[]} columnOverrides={columns} tableLayout="fixed" className="[&_[data-slot=table]]:min-w-[76rem] [&_[data-slot=table-cell]]:py-1.5" paginated={{ pageSize: 20 }} searchable={false} sortable={false} filterable={false}
      selectable={false} showExport={false} cellMotion={false} showHorizontalScrollbar={false}
      onRowClick={row => inspect(row, rowTrigger.current)}
      emptyState={<div className="grid justify-items-center gap-2 py-12 text-center"><SearchX className="mb-1 size-6 text-muted-foreground" /><p className="text-sm font-medium">No retained events match these filters.</p><p className="max-w-sm text-xs leading-relaxed text-muted-foreground">Try a wider time range or fewer criteria. Only evidence you are authorized to access is shown.</p></div>}
      errorState={(_error, retry) => <div role="alert" className="grid justify-items-center gap-3 py-10 text-center"><p className="text-sm">Events could not be loaded under the current access.</p><Button variant="outline" size="sm" onClick={retry}>Retry loading events</Button></div>} />
    </div>}
    <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><CircleHelp className="mt-0.5 size-3.5 shrink-0" /><p>Newest activity first · supporting stages update their existing row. Browser signals are observations, not proof of attention, clipboard contents or physical printing. Connection status is not an integrity or compliance verdict.</p></div>
    </TabsContent></Tabs>
  </section>;
}

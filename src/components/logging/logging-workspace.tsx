'use client';
/** Self-wired, scope-masked investigation organism composed from Zero DataTable, Select, ScrollArea and managed dialogs. */
import * as React from 'react';
import { Activity, Download, RefreshCw } from 'lucide-react';
import { DataTable } from '../data-table';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ModalManager, modals } from '../../modals';
import { useModalHostPresent } from '../../modals/modal-host-context';
import { useClientMaybe } from '../../frontend/client/client-context';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { defineSchema, field } from '../../schema';
import type { LoggingQuery, LoggingStream } from '../../logging/logging-contracts';
import { createLoggingTableSource } from './logging-table-source';
import { LoggingEventDetail, LoggingFilters } from './logging-parts';
import { cn } from '../../lib/utils';

const schema = defineSchema({ time: field.text({ label: 'Occurred' }), actor: field.text({ label: 'Actor' }), action: field.text({ label: 'Action' }), target: field.text({ label: 'Resource' }), outcome: field.text({ label: 'Outcome' }), evidence: field.text({ label: 'Evidence' }) });
const ACCESS_ERROR = 'Activity access could not be revalidated. Evidence is hidden until a fresh authorized snapshot succeeds.';
export interface LoggingWorkspaceProps { className?: string; defaultStream?: LoggingStream; initialQuery?: LoggingQuery; allowExport?: boolean; scope?: 'current' | 'platform' }
/** UI capability flags affect presentation only. Guardian enforces every read and export on the server. */
export function LoggingWorkspace(props: LoggingWorkspaceProps) {
  const hosted = useModalHostPresent();
  return hosted ? <Workspace {...props} /> : <ModalManager><Workspace {...props} /></ModalManager>;
}
function Workspace({ className, defaultStream = 'audit', initialQuery = {}, allowExport = true, scope = 'current' }: LoggingWorkspaceProps) {
  const client = useClientMaybe(), boundary = useAuthorizationScopeBoundary(client);
  const [stream, setStream] = React.useState(defaultStream), [query, setQuery] = React.useState(initialQuery), [revision, setRevision] = React.useState(0);
  const [error, setError] = React.useState<{ key: string; message: string } | null>(null), [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [blockedKey, setBlockedKey] = React.useState<string | null>(null);
  const [pendingExport, setPendingExport] = React.useState<{ key: string; id: string } | null>(null);
  const key = JSON.stringify([boundary.key, scope, stream, query]), current = React.useRef(key); current.current = key;
  const busy = busyKey === key;
  const source = React.useMemo(() => client ? createLoggingTableSource({ page: scope === 'platform' ? client.logging.platformPage : client.logging.page, watch: client.logging.watch }, stream, query, { platform: scope === 'platform' }) : null, [client, key]);
  React.useEffect(() => {
    if (!source || !boundary.ready || !boundary.stable) return;
    return source.watchStatus(status => {
      if (current.current !== key) return;
      if (status === 'live') { setBlockedKey(value => value === key ? null : value); setError(value => value?.message === ACCESS_ERROR ? null : value); }
      else if (status === 'reconnecting') {
        setBlockedKey(key); setError({ key, message: ACCESS_ERROR });
      }
    });
  }, [source, boundary.ready, boundary.stable, key]);
  const refresh = () => { setError(null); setRevision(n => n + 1); };
  const exportEvents = async () => {
    if (!client || busy) return;
    const captured = key; setBusyKey(key); setError(null);
    try {
      const policy = await client.logging.collectionPolicy();
      if (current.current !== captured) return;
      if (policy.durableExports) {
        // Keep an idempotent request identity even if create loses its response.
        // Checking/retrying a queued export must not create another private job.
        const id = pendingExport?.key === captured ? pendingExport.id : crypto.randomUUID();
        setPendingExport({ key: captured, id });
        const existing = pendingExport?.key === captured ? await client.logging.exportJob(id) : null;
        if (current.current !== captured) return;
        const job = existing ?? await client.logging.createExport({ id, stream, query });
        if (current.current !== captured) return;
        if (job.state === 'pending') return;
        if (job.state !== 'ready') { setPendingExport(null); setError({ key: captured, message: 'The retained export is no longer available. Request a new export when ready.' }); return; }
        const blob = await client.logging.downloadExport(job.id);
        if (current.current !== captured) return;
        const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `zero-logging-${job.id}.ndjson`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        setPendingExport(null);
        if (!job.complete) setError({ key: captured, message: `Export is a bounded segment (${job.count} events), not the complete investigation. Continue with its pinned high-water and continuation ordinal.` });
        return;
      }
      const result = await client.logging.export(stream, query);
      if (current.current !== captured) return;
      // The manifest remains with the evidence. Generating a browser download is not proof of receipt.
      const manifest = JSON.stringify({ ...result, ndjson: undefined });
      const url = URL.createObjectURL(new Blob([JSON.stringify({ manifest: JSON.parse(manifest) }) + '\n', result.ndjson], { type: 'application/x-ndjson' }));
      const link = document.createElement('a'); link.href = url; link.download = `zero-logging-${result.id}.ndjson`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (!result.complete) setError({ key: captured, message: `Export is a bounded segment (${result.count} events), not the complete investigation. Narrow filters or continue through client.logging.export().` });
    } catch { if (current.current === captured) setError({ key: captured, message: 'Export was not completed. Check your export permission and try a narrower query.' }); }
    finally { setBusyKey(value => value === captured ? null : value); }
  };
  if (!client || !source || !boundary.ready || !boundary.stable) return <section role="status" className="p-4 text-sm text-muted-foreground">Logging requires a ready authenticated AppProvider.</section>;
  return <section data-slot="logging-workspace" className={cn('min-w-0 space-y-4', className)} aria-label="Logging investigation">
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Activity className="size-4 text-primary" /><h2 className="text-base font-semibold tracking-tight">Activity and evidence</h2></div><div className="flex items-center gap-2">
      <Select value={stream} onValueChange={value => { setStream(value as LoggingStream); refresh(); }}><SelectTrigger aria-label="Log stream" className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="audit">Audit activity</SelectItem><SelectItem value="operational">Diagnostics</SelectItem></SelectContent></Select>
      <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="size-3.5" />Refresh</Button>
      {allowExport && scope !== 'platform' && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void exportEvents(); }}><Download className="size-3.5" />{busy ? 'Exporting…' : pendingExport?.key === key ? 'Check export' : 'Export'}</Button>}
    </div></header>
    <LoggingFilters value={query} onApply={next => { setQuery(next); refresh(); }} />
    {error?.key === key && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error.message}</p>}
    {!busy && pendingExport?.key === key && error?.key !== key && <p role="status" className="text-xs text-muted-foreground">Your private export request is retained. Use Check export to download it when ready.</p>}
    {blockedKey !== key && <DataTable key={key} refreshKey={revision} schema={schema} source={source} columns={schema.fieldNames as string[]} paginated={{ pageSize: 25 }} searchable={false} sortable={false} filterable={false}
      selectable={false} showExport={false} cellMotion={false} showHorizontalScrollbar={false}
      onRowClick={row => { modals.open({ title: 'Event evidence', size: 'lg', content: <LoggingEventDetail stored={row.stored} scopeKey={boundary.key} /> }); }}
      emptyState={<div className="py-10 text-center text-sm text-muted-foreground">No retained events match these filters.</div>} />}
    <p className="text-xs text-muted-foreground">Live · newest ingestion first · source times may differ from ingestion order. Browser signals are not proof of attention, clipboard contents or physical printing.</p>
  </section>;
}

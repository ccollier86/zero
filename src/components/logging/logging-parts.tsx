'use client';
/** Reusable logging filters and metadata-only evidence detail; rendering does not confer access. */
import * as React from 'react';
import type { LoggingQuery, StoredLoggingEvent } from '../../logging/logging-contracts';
import { LOGGING_FAMILIES, LOGGING_OUTCOMES } from '../../logging/logging-contracts';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';

/** Closed AND criteria map exactly to the server grammar; there are no decorative unsupported operators. */
export function LoggingFilters({ value, onApply }: { value: LoggingQuery; onApply: (query: LoggingQuery) => void }) {
  const [draft, setDraft] = React.useState(value);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { setDraft(value); }, [value]);
  const set = (key: keyof LoggingQuery, value: unknown) => setDraft(current => { const next = { ...current }; if (value === '' || value === 'all' || value === undefined) delete next[key]; else Object.assign(next, { [key]: value }); return next; });
  const localDate = (value?: number) => value === undefined ? '' : new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return <form className="flex flex-wrap items-end gap-2" aria-label="Filter logging events" onSubmit={event => {
    event.preventDefault();
    if (draft.since !== undefined && draft.until !== undefined && draft.since >= draft.until) { setError('Start must be before end.'); return; }
    setError(null); onApply(draft);
  }}>
    <label className="grid gap-1 text-xs text-muted-foreground">Family<Select value={draft.family ?? 'all'} onValueChange={v => set('family', v)}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All families</SelectItem>{LOGGING_FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent></Select></label>
    <label className="grid gap-1 text-xs text-muted-foreground">Outcome<Select value={draft.outcome ?? 'all'} onValueChange={v => set('outcome', v)}><SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All outcomes</SelectItem>{LOGGING_OUTCOMES.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent></Select></label>
    <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" type="button">More filters{(['actorId', 'action', 'targetId', 'since', 'until'] as const).some(k => draft[k] !== undefined) ? ' · set' : ''}</Button></PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3"><h3 className="mb-3 text-sm font-medium">Narrow the investigation</h3><PopoverViewport className="grid max-h-[50vh] gap-3 pr-1">
        {(['actorId', 'action', 'targetId'] as const).map(key => <label key={key} className="grid gap-1 text-xs text-muted-foreground">{key === 'actorId' ? 'Actor ID' : key === 'targetId' ? 'Resource ID' : 'Exact action'}<Input className="h-8" value={draft[key] ?? ''} maxLength={key === 'action' ? 120 : 200} onChange={e => set(key, e.target.value)} /></label>)}
        {(['since', 'until'] as const).map(key => <label key={key} className="grid gap-1 text-xs text-muted-foreground">{key === 'since' ? 'From' : 'Before'}<Input className="h-8" type="datetime-local" value={localDate(draft[key])} onChange={e => set(key, e.target.value ? new Date(e.target.value).getTime() : undefined)} /></label>)}
        <p className="text-xs text-muted-foreground">All criteria must match. Close this panel and apply filters.</p>
      </PopoverViewport></PopoverContent></Popover>
    <Button size="sm" type="submit">Apply filters</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({}); setError(null); onApply({}); }}>Clear</Button>
    {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
  </form>;
}

const EVIDENCE_LABELS: Record<string, string> = {
  'server-confirmed': 'The server recorded this stage. It does not prove that a person read the response.',
  'provider-confirmed': 'A provider supplied this confirmation; its scope is the named event.',
  'browser-observed': 'An untrusted browser reported this signal. Copy does not include clipboard contents; print does not prove paper output.',
  estimated: 'A derived estimate, not a directly confirmed action.', incomplete: 'Some observations or delivery stages are missing.',
};
/** A retained dialog cannot keep displaying old-tenant evidence during an authorization transition. */
export function LoggingEventDetail({ stored, scopeKey }: { stored: StoredLoggingEvent; scopeKey: string }) {
  const scope = useAuthorizationScopeBoundary();
  if (!scope.ready || !scope.stable || scope.key !== scopeKey) return null;
  const event = stored.event;
  const fields = { Action: event.action, Outcome: event.outcome, Evidence: event.evidence, Occurred: new Date(event.occurredAt).toLocaleString(),
    Ingested: new Date(stored.ingestedAt).toLocaleString(), Actor: event.actor.id ?? event.actor.kind, 'Actor kind': event.actor.kind,
    Scope: event.scope.kind === 'tenant' ? event.scope.tenantId : 'Application', Source: event.sourceId, 'Event ID': event.id,
    'Source position': stored.ordinal, 'Session ID': event.actor.sessionId ?? '—', 'Request ID': event.requestId ?? '—', 'Correlation ID': event.correlationId ?? '—',
    Resource: event.target ? `${event.target.type} · ${event.target.id}` : '—' };
  return <ScrollArea className="max-h-[65vh]" style={{ height: 'min(65vh, 32rem)' }}><div className="space-y-5 pr-4">
    <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{EVIDENCE_LABELS[event.evidence]}</p>
    <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">{Object.entries(fields).map(([key, value]) => <React.Fragment key={key}><dt className="text-muted-foreground">{key}</dt><dd className="break-words font-mono">{String(value)}</dd></React.Fragment>)}</dl>
    {Object.keys(event.metadata).length > 0 && <section><h3 className="mb-2 text-xs font-medium">Allowed metadata</h3><dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">{Object.entries(event.metadata).map(([key, value]) => <React.Fragment key={key}><dt className="break-words text-muted-foreground">{key}</dt><dd className="break-words font-mono">{String(value)}</dd></React.Fragment>)}</dl></section>}
  </div></ScrollArea>;
}

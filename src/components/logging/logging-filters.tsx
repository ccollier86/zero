'use client';
/** Closed-AND investigation controls composed from the native morphing controls. */
import * as React from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { LoggingQuery } from '../../logging/logging-contracts';
import { LOGGING_FAMILIES, LOGGING_LEVELS, LOGGING_OUTCOMES } from '../../logging/logging-contracts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';
import { clearLoggingFilters, loggingDate, loggingFilterError, loggingFilterLabels, loggingLabel, loggingLocalDate, type LoggingFilterKey } from './logging-presentation';

/** All criteria execute on the server; no decorative unsupported operators. */
export function LoggingFilters({ value, onApply }: { value: LoggingQuery; onApply: (query: LoggingQuery) => void }) {
  const [draft, setDraft] = React.useState(value), [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  React.useEffect(() => { setDraft(value); setError(null); }, [value]);
  const set = (key: LoggingFilterKey, value: unknown) => setDraft(current => {
    const next = { ...current }; if (value === '' || value === 'all' || value === undefined) delete next[key]; else Object.assign(next, { [key]: value }); return next;
  });
  const apply = (next: LoggingQuery) => { const invalid = loggingFilterError(next); setError(invalid); if (!invalid) onApply(next); };
  const keys = (Object.keys(loggingFilterLabels) as LoggingFilterKey[]).filter(key => value[key] !== undefined);
  const changed = JSON.stringify(draft) !== JSON.stringify(value);
  return <div className="space-y-2.5" data-slot="logging-filters">
    <form className="flex flex-wrap items-center gap-2" aria-label="Filter logging events" aria-describedby={error ? `${id}-error` : undefined} onSubmit={event => { event.preventDefault(); apply(draft); }}>
      <Choice label="Family" value={draft.family} options={LOGGING_FAMILIES} onChange={value => set('family', value)} />
      <Choice label="Outcome" value={draft.outcome} options={LOGGING_OUTCOMES} onChange={value => set('outcome', value)} />
      <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" type="button"><SlidersHorizontal className="size-3.5" />More filters</Button></PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-4">
          <h3 className="text-sm font-semibold">Narrow the investigation</h3><p className="mb-4 mt-1 text-xs text-muted-foreground">Exact matches · all criteria must match</p>
          <PopoverViewport className="grid max-h-[50vh] gap-3 pr-1">
            {(['actorId', 'sessionId', 'action', 'targetType', 'targetId'] as const).map(key => <label key={key} className="grid gap-1.5 text-xs font-medium">{loggingFilterLabels[key]}
              <Input className="h-8 text-xs" value={draft[key] ?? ''} maxLength={key === 'action' || key === 'targetType' ? 120 : 200} autoComplete="off" spellCheck={false}
                placeholder={key === 'action' ? 'e.g. record.read' : key === 'targetType' ? 'e.g. record' : 'Exact ID'} onChange={event => set(key, event.target.value)} /></label>)}
            <Choice label="Severity" value={draft.level} options={LOGGING_LEVELS} onChange={value => set('level', value)} />
            <div className="border-t border-border pt-3 text-xs font-medium">Source time range <span className="font-normal text-muted-foreground">(your timezone)</span></div>
            {(['since', 'until'] as const).map(key => <label key={key} className="grid gap-1.5 text-xs font-medium">{loggingFilterLabels[key]}
              <Input className="h-8 text-xs" type="datetime-local" value={loggingLocalDate(draft[key])} onChange={event => set(key, event.target.value ? new Date(event.target.value).getTime() : undefined)} /></label>)}
            <p className="text-xs leading-relaxed text-muted-foreground">Close this panel, then apply. IDs are not names or message contents. The end time is exclusive.</p>
          </PopoverViewport>
        </PopoverContent>
      </Popover>
      <Button size="sm" type="submit" variant={changed ? 'default' : 'secondary'}>Apply filters</Button>
      {(keys.length > 0 || changed) && <Button type="button" variant="ghost" size="sm" onClick={() => { const next = clearLoggingFilters(value); setDraft(next); apply(next); }}>Clear filters</Button>}
      {changed && <span className="text-xs text-muted-foreground" role="status">Unapplied changes</span>}
    </form>
    {keys.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label="Applied filters"><span className="mr-1 text-xs text-muted-foreground">Matching all</span>{keys.map(key => <button key={key} type="button"
      aria-label={`Remove ${loggingFilterLabels[key]} filter`} onClick={() => { const next = { ...value }; delete next[key]; setDraft(next); apply(next); }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="shrink-0 text-muted-foreground">{loggingFilterLabels[key]}</span><span className="truncate">{key === 'since' || key === 'until' ? loggingDate(value[key]!) : String(value[key])}</span><X className="size-3 shrink-0" aria-hidden="true" />
    </button>)}</div>}
    {value.eventIds !== undefined && <p className="text-xs text-muted-foreground">Restricted to {value.eventIds.length} selected event identities. Clearing filters does not remove this restriction.</p>}
    {(value.beforeOrdinal !== undefined || value.highWaterOrdinal !== undefined) && <p className="text-xs text-muted-foreground">A pinned ingestion window is active. Live arrivals outside that window will not appear.</p>}
    {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
function Choice({ label, value, options, onChange }: { label: string; value?: string; options: readonly string[]; onChange: (value: string) => void }) {
  return <Select value={value ?? 'all'} onValueChange={onChange}><SelectTrigger aria-label={label} className="h-8 w-auto min-w-32 text-xs"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value="all">{label === 'Family' ? 'All families' : label === 'Outcome' ? 'All outcomes' : 'All severities'}</SelectItem>{options.map(option => <SelectItem key={option} value={option}>{loggingLabel(option)}</SelectItem>)}</SelectContent>
  </Select>;
}

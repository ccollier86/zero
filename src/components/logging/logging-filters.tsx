'use client';
/** Closed-AND investigation controls composed from the native morphing controls. */
import * as React from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { X } from '../animate-ui/icons/x';
import type { LoggingQuery } from '../../logging/logging-contracts';
import { LOGGING_FAMILIES, LOGGING_LEVELS, LOGGING_OUTCOMES } from '../../logging/logging-contracts';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Popover, PopoverContent, PopoverTrigger, PopoverViewport } from '../popover';
import { clearLoggingFilters, loggingDate, loggingFilterError, loggingFilterLabels, loggingLabel, loggingLocalDate, type LoggingFilterKey } from './logging-presentation';
import { LoggingPersonPicker } from './logging-person-picker';
import { LOGGING_ACTIVITY_LABELS, LOGGING_CATEGORY_LABELS, loggingActivityCode, loggingResourceLabel, loggingTableLabel, type LoggingPresentation } from './logging-readable-activity';
import type { LoggingPerson, LoggingTableChoice } from '../../logging/logging-directory-contracts';
// This sentinel cannot collide with an admitted action/resource identifier.
const ALL = '__zero_logging_all__';

/** All criteria execute on the server; no decorative unsupported operators. */
export function LoggingFilters({ value, onApply, tables = [], presentation, selectedPerson, onPersonChange }: { value: LoggingQuery; onApply: (query: LoggingQuery) => void;
  tables?: readonly LoggingTableChoice[]; presentation?: LoggingPresentation; selectedPerson?: LoggingPerson | null; onPersonChange?: (person?: LoggingPerson) => void }) {
  const [draft, setDraft] = React.useState(value), [error, setError] = React.useState<string | null>(null);
  const [draftPerson, setDraftPerson] = React.useState(selectedPerson);
  const id = React.useId();
  React.useEffect(() => { setDraft(value); setError(null); }, [value]);
  React.useEffect(() => { setDraftPerson(selectedPerson); }, [value.actorId, selectedPerson]);
  const set = (key: LoggingFilterKey, value: unknown) => setDraft(current => {
    const next = { ...current }; if (value === '' || value === undefined) delete next[key]; else Object.assign(next, { [key]: value }); return next;
  });
  const apply = (next: LoggingQuery) => { const invalid = loggingFilterError(next); setError(invalid); if (!invalid) {
    const person = draftPerson && next.actorId === draftPerson.id ? draftPerson : selectedPerson && next.actorId === selectedPerson.id ? selectedPerson : undefined;
    onPersonChange?.(person); onApply(next);
  } };
  const keys = (Object.keys(loggingFilterLabels) as LoggingFilterKey[]).filter(key => value[key] !== undefined);
  const changed = JSON.stringify(draft) !== JSON.stringify(value);
  return <div className="space-y-2.5" data-slot="logging-filters">
    <div role="search" className="flex flex-wrap items-center gap-2" aria-label="Filter logging events" aria-describedby={error ? `${id}-error` : undefined}
      onKeyDown={event => { if (event.key === 'Enter' && !event.defaultPrevented && event.target instanceof HTMLInputElement && event.target.getAttribute('role') !== 'combobox' && !event.nativeEvent.isComposing) { event.preventDefault(); apply(draft); } }}>
      <LoggingPersonPicker value={draft.actorId} selected={draftPerson} onChange={(id, person) => { set('actorId', id); setDraftPerson(person); }} />
      <Select value={draft.action ?? ALL} onValueChange={value => set('action', value === ALL ? undefined : value)}><SelectTrigger aria-label="Activity" className="h-8 w-auto min-w-44 text-xs"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value={ALL}>All activities</SelectItem>{Object.entries({ ...LOGGING_ACTIVITY_LABELS, ...presentation?.actions }).map(([action, label]) => <SelectItem key={action} value={action}>{label.label}</SelectItem>)}
        {draft.action && !Object.hasOwn({ ...LOGGING_ACTIVITY_LABELS, ...presentation?.actions }, draft.action) && <SelectItem value={draft.action}>{loggingActivityCode(draft.action, presentation).label}</SelectItem>}
      </SelectContent></Select>
      <Select value={draft.targetType ?? ALL} onValueChange={value => set('targetType', value === ALL ? undefined : value)}><SelectTrigger aria-label="Table" className="h-8 w-auto min-w-36 text-xs"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value={ALL}>All tables</SelectItem>{tables.map(table => <SelectItem key={table.type} value={table.type}>{loggingTableLabel(table, presentation)}</SelectItem>)}
        {draft.targetType && !tables.some(table => table.type === draft.targetType) && <SelectItem value={draft.targetType}>{loggingResourceLabel({ target: { type: draft.targetType, id: '' } }, [], presentation)}</SelectItem>}
      </SelectContent></Select>
      <Choice label="Outcome" value={draft.outcome} options={LOGGING_OUTCOMES} onChange={value => set('outcome', value)} />
      <Popover><PopoverTrigger asChild><Button variant="outline" size="sm" type="button"><SlidersHorizontal className="size-3.5" />More filters</Button></PopoverTrigger>
        <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-4">
          <h3 className="text-sm font-semibold">Narrow the investigation</h3><p className="mb-4 mt-1 text-xs text-muted-foreground">Exact matches · all criteria must match</p>
          <PopoverViewport className="grid max-h-[50vh] gap-3 pr-1">
            <Choice label="Category" value={draft.family} options={LOGGING_FAMILIES} onChange={value => set('family', value)} />
            <p className="text-xs text-muted-foreground">Optional technical identifiers</p>
            {(['actorId', 'sessionId', 'action', 'targetType', 'targetId'] as const).map(key => <label key={key} className="grid gap-1.5 text-xs font-medium">{{ actorId: 'User ID', sessionId: 'Session ID', action: 'Exact activity code', targetType: 'Exact resource type', targetId: 'Record ID' }[key]}
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
      <Button size="sm" type="button" variant={changed ? 'default' : 'secondary'} onClick={() => apply(draft)}>Apply filters</Button>
      {(keys.length > 0 || changed) && <Button type="button" variant="ghost" size="sm" onClick={() => { const next = clearLoggingFilters(value); setDraft(next); apply(next); }}>Clear filters</Button>}
      {changed && <span className="text-xs text-muted-foreground" role="status">Unapplied changes</span>}
    </div>
    {keys.length > 0 && <div className="flex flex-wrap items-center gap-1.5" aria-label="Applied filters"><span className="mr-1 text-xs text-muted-foreground">Matching all</span>{keys.map(key => <button key={key} type="button"
      aria-label={`Remove ${loggingFilterLabels[key]} filter`} onClick={() => { const next = { ...value }; delete next[key]; setDraft(next); apply(next); }}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="shrink-0 text-muted-foreground">{loggingFilterLabels[key]}</span><span className="truncate">{key === 'since' || key === 'until' ? loggingDate(value[key]!) : key === 'actorId' ? selectedPerson && selectedPerson.id === value.actorId ? selectedPerson.name : 'Selected user'
        : key === 'action' ? loggingActivityCode(value.action!, presentation).label
        : key === 'targetType' ? loggingResourceLabel({ target: { type: value.targetType!, id: '' } }, tables, presentation)
        : key === 'family' ? LOGGING_CATEGORY_LABELS[value.family!] : String(value[key])}</span><X className="size-3 shrink-0" aria-hidden="true" />
    </button>)}</div>}
    {value.eventIds !== undefined && <p className="text-xs text-muted-foreground">Restricted to {value.eventIds.length} selected event identities. Clearing filters does not remove this restriction.</p>}
    {(value.beforeOrdinal !== undefined || value.highWaterOrdinal !== undefined) && <p className="text-xs text-muted-foreground">A pinned ingestion window is active. Live arrivals outside that window will not appear.</p>}
    {error && <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
function Choice({ label, value, options, onChange }: { label: string; value?: string; options: readonly string[]; onChange: (value: string | undefined) => void }) {
  return <Select value={value ?? ALL} onValueChange={value => onChange(value === ALL ? undefined : value)}><SelectTrigger aria-label={label} className="h-8 w-auto min-w-32 text-xs"><SelectValue /></SelectTrigger>
    <SelectContent><SelectItem value={ALL}>{label === 'Category' ? 'All categories' : label === 'Outcome' ? 'All outcomes' : 'All severities'}</SelectItem>{options.map(option => <SelectItem key={option} value={option}>{label === 'Category' ? LOGGING_CATEGORY_LABELS[option as keyof typeof LOGGING_CATEGORY_LABELS] : loggingLabel(option)}</SelectItem>)}</SelectContent>
  </Select>;
}

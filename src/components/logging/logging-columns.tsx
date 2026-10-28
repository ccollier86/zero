'use client';
/** Native DataTable cells; the retained row identity and live-update engine stay unchanged. */
import { ArrowUpRight, Bot, FileText } from 'lucide-react';
import type { DataTableColumnOverrides } from '../data-table/use-data-table';
import type { LoggingTableRow } from './logging-table-source';
import { Badge } from '../ui/badge';
import { loggingEvidence, loggingOutcome } from './logging-presentation';
import { LoggingPersonAvatar } from './logging-person-avatar';
import { loggingActivity, loggingResourceLabel, LOGGING_CATEGORY_LABELS, type LoggingPresentation } from './logging-readable-activity';
import type { LoggingPerson, LoggingTableChoice } from '../../logging/logging-directory-contracts';

/** The explicit inspect control provides a real trigger for shared origin-morph dialogs. */
export function loggingColumns(onInspect: (row: LoggingTableRow, trigger: Element) => void,
  options: { tables?: readonly LoggingTableChoice[]; presentation?: LoggingPresentation; onUser?: (id: string, person: LoggingPerson | null) => void } = {}): DataTableColumnOverrides<LoggingTableRow> {
  return {
    time: { width: 166, cell: ({ row }) => <div className="space-y-0.5 py-1 text-xs tabular-nums"><p>{new Date(row.stored.event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p><p className="text-muted-foreground">{new Date(row.stored.event.occurredAt).toLocaleDateString()}</p></div> },
    action: { minWidth: 210, flex: true, cell: ({ row }) => { const activity = loggingActivity(row.stored.event, options.presentation); return <div className="space-y-1 py-1"><p className="truncate text-sm font-medium">{activity.label}</p><p className="truncate text-xs text-muted-foreground">{LOGGING_CATEGORY_LABELS[row.stored.event.family]}</p></div>; } },
    actor: { width: 210, cell: ({ row }) => {
      const actor = row.stored.event.actor;
      if (actor.kind !== 'user') return <span className="flex items-center gap-2.5"><span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-muted/40"><Bot aria-hidden="true" className="size-4 text-muted-foreground" /></span><span className="min-w-0"><span className="block text-sm font-medium">{actor.kind === 'anonymous' ? 'Visitor' : actor.kind === 'service' ? 'API key / service' : 'System automation'}</span><span className="block text-xs text-muted-foreground">{actor.kind === 'anonymous' ? 'Not signed in' : 'Not a signed-in person'}</span></span></span>;
      const name = row.person?.name ?? 'User unavailable';
      const content = <><LoggingPersonAvatar userId={row.person?.id} name={name} revision={row.person?.revision} /><span className="min-w-0 text-left"><span className="block truncate text-sm font-medium">{name}</span><span className="block truncate text-xs text-muted-foreground">{row.person?.username ?? 'Identity retained in event details'}</span></span></>;
      return actor.id && options.onUser ? <button type="button" aria-label={`Show activity by ${name}`} className="flex w-full min-w-0 items-center gap-2.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={event => { event.stopPropagation(); options.onUser!(actor.id!, row.person); }}>{content}</button> : <span className="flex min-w-0 items-center gap-2.5">{content}</span>;
    } },
    target: { minWidth: 160, flex: true, cell: ({ row }) => <span className="flex min-w-0 items-center gap-2 text-sm"><FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{loggingResourceLabel(row.stored.event, options.tables ?? [], options.presentation)}</span></span> },
    outcome: { width: 116, cell: ({ row }) => { const outcome = loggingOutcome[row.stored.event.outcome]; return <Badge variant="outline" className={`text-[11px] ${outcome.className}`}>{outcome.label}</Badge>; } },
    evidence: { width: 160, cell: ({ row }) => <span className="text-xs text-muted-foreground">{loggingEvidence[row.stored.event.evidence].label}</span> },
    inspect: { header: '', width: 48, cell: ({ row }) => <button type="button" aria-label={`Inspect event ${row.stored.event.id}`} className="inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={event => { event.stopPropagation(); onInspect(row, event.currentTarget); }}><ArrowUpRight className="size-3.5" aria-hidden="true" /></button> },
  };
}

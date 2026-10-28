'use client';
/** Native DataTable cells; the retained row identity and live-update engine stay unchanged. */
import { ArrowUpRight, Bot, FileText } from 'lucide-react';
import { User as UserRound } from '../animate-ui/icons/user';
import type { DataTableColumnOverrides } from '../data-table/use-data-table';
import type { LoggingTableRow } from './logging-table-source';
import { Badge } from '../ui/badge';
import { loggingEvidence, loggingLabel, loggingOutcome } from './logging-presentation';

/** The explicit inspect control provides a real trigger for shared origin-morph dialogs. */
export function loggingColumns(onInspect: (row: LoggingTableRow, trigger: Element) => void): DataTableColumnOverrides<LoggingTableRow> {
  return {
    time: { width: 166, cell: ({ row }) => <div className="space-y-0.5 py-1 text-xs tabular-nums"><p>{new Date(row.stored.event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p><p className="text-muted-foreground">{new Date(row.stored.event.occurredAt).toLocaleDateString()}</p></div> },
    action: { minWidth: 170, flex: true, cell: ({ row }) => <div className="space-y-0.5 py-1"><p className="truncate text-xs font-medium">{loggingLabel(row.action)}</p><p className="truncate text-[11px] text-muted-foreground">{loggingLabel(row.stored.event.family)}</p></div> },
    actor: { width: 162, cell: ({ row }) => { const Icon = row.stored.event.actor.kind === 'user' ? UserRound : Bot; return <span className="flex min-w-0 items-center gap-2 text-xs"><Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{row.actor}</span></span>; } },
    target: { minWidth: 160, flex: true, cell: ({ row }) => <span className="flex min-w-0 items-center gap-2 text-xs"><FileText aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /><span className="truncate">{row.target}</span></span> },
    outcome: { width: 116, cell: ({ row }) => { const outcome = loggingOutcome[row.stored.event.outcome]; return <Badge variant="outline" className={`text-[11px] ${outcome.className}`}>{outcome.label}</Badge>; } },
    evidence: { width: 160, cell: ({ row }) => <span className="text-xs text-muted-foreground">{loggingEvidence[row.stored.event.evidence].label}</span> },
    inspect: { header: '', width: 48, cell: ({ row }) => <button type="button" aria-label={`Inspect event ${row.stored.event.id}`} className="inline-grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={event => { event.stopPropagation(); onInspect(row, event.currentTarget); }}><ArrowUpRight className="size-3.5" aria-hidden="true" /></button> },
  };
}

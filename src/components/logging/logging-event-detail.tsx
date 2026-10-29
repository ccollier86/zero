'use client';
/** Readable current-profile presentation stays separate from historical evidence and its exact identity. */
import * as React from 'react';
import { Bot, FileText, Fingerprint, Info, ShieldCheck } from 'lucide-react';
import { User } from '../animate-ui/icons/user';
import type { StoredLoggingEvent } from '../../logging/logging-contracts';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { LoggingPersonAvatar } from './logging-person-avatar';
import { ChevronDown } from '../animate-ui/icons/chevron-down';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../collapsible';
import { loggingActivity, loggingResourceLabel, LOGGING_CATEGORY_LABELS, type LoggingPresentation } from './logging-readable-activity';
import type { LoggingPerson, LoggingTableChoice } from '../../logging/logging-directory-contracts';
import { loggingDate, loggingEvidence, loggingLabel, loggingOutcome } from './logging-presentation';
import { loggingFieldValue } from './logging-change-presentation';
import { loggingWords } from './logging-readable-activity';

/** A dialog masks evidence synchronously when its captured authorization scope retires. */
export function LoggingEventDetail({ stored, scopeKey, person, tables = [], presentation }: { stored: StoredLoggingEvent; scopeKey: string;
  person?: LoggingPerson | null; tables?: readonly LoggingTableChoice[]; presentation?: LoggingPresentation }) {
  const scope = useAuthorizationScopeBoundary();
  if (!scope.ready || !scope.stable || scope.key !== scopeKey) return <p role="status" className="text-sm text-muted-foreground">Evidence is hidden while access is revalidated.</p>;
  if (stored.event.actor.kind !== 'user' || stored.event.actor.id !== person?.id) person = null;
  const { event } = stored, evidence = loggingEvidence[event.evidence], outcome = loggingOutcome[event.outcome];
  const activity = loggingActivity(event, presentation), who = event.actor.kind === 'user' ? person?.name ?? 'User unavailable'
    : event.actor.kind === 'anonymous' ? 'Visitor' : event.actor.kind === 'service' ? 'API key / service' : 'System automation';
  return <ScrollArea className="max-h-[65vh]" style={{ height: 'min(65vh, 36rem)' }}><div className="space-y-5 pr-4" data-slot="logging-event-detail">
    <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={outcome.className}>{outcome.label}</Badge><span className="text-xs text-muted-foreground">{LOGGING_CATEGORY_LABELS[event.family]} · {loggingLabel(event.level)}</span></div>
      <h3 className="text-xl font-semibold tracking-tight">{activity.label}</h3>{activity.description && <p className="text-sm leading-relaxed text-muted-foreground">{activity.description}</p>}
      <div className="flex items-center gap-3 rounded-xl border border-border p-3">{event.actor.kind === 'user' ? <LoggingPersonAvatar userId={person?.id} name={who} revision={person?.revision} className="size-10" />
        : <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted/40" aria-hidden="true">{event.actor.kind === 'anonymous' ? <User className="size-5" /> : <Bot className="size-5" />}</span>}<div className="min-w-0"><p className="text-sm font-semibold">{who}</p><p className="text-xs text-muted-foreground">{person ? 'Current Guardian profile · historical identity retained below' : event.actor.kind === 'user' ? 'Current profile is unavailable' : 'An automated or unauthenticated action'}</p></div></div>
      {event.target && <div className="flex items-start gap-2 text-sm"><FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block">{loggingResourceLabel(event, tables, presentation)}</span><span className="block break-all text-xs text-muted-foreground">{event.target.id}</span></span></div>}
    </div>
    {event.detail?.kind === 'record-change' && <section className="space-y-2" aria-label="Committed field changes"><h4 className="text-sm font-semibold">What changed</h4>
      <p className="text-xs text-muted-foreground">Committed source revision {event.detail.sequence}. Values appear only where the capture policy allowed them.</p>
      <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border">{event.detail.changes.map(field => <div key={field.field} className="grid gap-1.5 px-3 py-2.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className="font-medium" title={field.field}>{loggingWords(field.field)}</dt><dd className="min-w-0 break-words">{field.kind === 'value'
          ? <><span className="text-muted-foreground">{loggingFieldValue(field.before, field.beforePresent)}</span><span aria-label="changed to" className="mx-2 text-muted-foreground">→</span><span>{loggingFieldValue(field.after, field.afterPresent)}</span></>
          : <span className="text-xs text-muted-foreground">Changed · values private</span>}</dd></div>)}</dl>
      {event.detail.omittedFields > 0 && <p className="text-xs text-muted-foreground">{event.detail.omittedFields} changed fields were omitted by privacy policy or the bounded capture budget. This is not a complete value snapshot.</p>}
    </section>}
    <div className="rounded-xl border border-border bg-muted/30 p-3.5"><div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><Info className="size-4 shrink-0 text-primary" />{evidence.label}</div><p className="text-xs leading-relaxed text-muted-foreground">{evidence.description}</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border p-3"><p className="mb-1 text-xs text-muted-foreground">Occurred · source clock</p><time className="text-sm tabular-nums">{loggingDate(event.occurredAt)}</time></div>
      <div className="rounded-lg border border-border p-3"><p className="mb-1 text-xs text-muted-foreground">Ingested · retained order</p><time className="text-sm tabular-nums">{loggingDate(stored.ingestedAt)}</time></div></div>
    <Collapsible className="rounded-xl border border-border px-3.5 py-3"><CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Technical details<ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" /></CollapsibleTrigger><CollapsibleContent><div className="space-y-4 pt-4">
    <Details title="User and record identifiers" icon={<FileText className="size-3.5" />} rows={[
      ['Exact activity code', event.action], ['User / service ID', event.actor.id], ['Identity type', event.actor.kind], ['Initiator ID', event.actor.initiatorId],
      ['Resource type', event.target?.type], ['Resource ID', event.target?.id],
      ['Scope', event.scope.kind === 'tenant' ? event.scope.tenantId : 'Application'],
    ]} />
    <Details title="Trace and provenance" icon={<Fingerprint className="size-3.5" />} rows={[
      ['Event ID', event.id], ['Source ID', event.sourceId], ['Ingestion position', stored.ordinal], ['Origin', event.origin],
      ['Policy version', event.policyVersion], ['Session ID', event.actor.sessionId], ['Request ID', event.requestId], ['Correlation ID', event.correlationId],
    ]} />
    <Details title="Allowed metadata" icon={<ShieldCheck className="size-3.5" />} rows={Object.entries(event.metadata)} />
    </div></CollapsibleContent></Collapsible>
    <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">This is one retained event, not proof that an entire workflow completed. Source timestamps can differ from ingestion order. No message or document contents are shown.</p>
  </div></ScrollArea>;
}
function Details({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: readonly (readonly [string, string | number | boolean | null | undefined])[] }) {
  return <section><h4 className="mb-2 flex items-center gap-2 text-xs font-semibold">{icon}{title}</h4>{rows.length ? <dl className="overflow-hidden rounded-lg border border-border text-xs">{rows.map(([name, value]) => <div key={name} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
    <dt className="text-muted-foreground">{name}</dt><dd className="min-w-0 break-all font-mono">{value === null || value === undefined ? <span className="font-sans text-muted-foreground">Not recorded</span> : String(value)}</dd>
  </div>)}</dl> : <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No additional metadata was retained.</p>}</section>;
}

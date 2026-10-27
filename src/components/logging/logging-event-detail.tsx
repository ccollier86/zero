'use client';
/** Metadata-only evidence, with no identity lookup, raw payload or inferred completion. */
import * as React from 'react';
import { FileText, Fingerprint, Info, ShieldCheck } from 'lucide-react';
import type { StoredLoggingEvent } from '../../logging/logging-contracts';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { loggingDate, loggingEvidence, loggingLabel, loggingOutcome } from './logging-presentation';

/** A dialog masks evidence synchronously when its captured authorization scope retires. */
export function LoggingEventDetail({ stored, scopeKey }: { stored: StoredLoggingEvent; scopeKey: string }) {
  const scope = useAuthorizationScopeBoundary();
  if (!scope.ready || !scope.stable || scope.key !== scopeKey) return <p role="status" className="text-sm text-muted-foreground">Evidence is hidden while access is revalidated.</p>;
  const { event } = stored, evidence = loggingEvidence[event.evidence], outcome = loggingOutcome[event.outcome];
  return <ScrollArea className="max-h-[65vh]" style={{ height: 'min(65vh, 36rem)' }}><div className="space-y-5 pr-4" data-slot="logging-event-detail">
    <div className="space-y-2"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={outcome.className}>{outcome.label}</Badge><span className="text-xs text-muted-foreground">{loggingLabel(event.family)} · {loggingLabel(event.level)}</span></div>
      <h3 className="text-lg font-semibold tracking-tight">{loggingLabel(event.action)}</h3><p className="break-all font-mono text-xs text-muted-foreground">{event.action}</p></div>
    <div className="rounded-xl border border-border bg-muted/30 p-3.5"><div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><Info className="size-4 shrink-0 text-primary" />{evidence.label}</div><p className="text-xs leading-relaxed text-muted-foreground">{evidence.description}</p></div>
    <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border border-border p-3"><p className="mb-1 text-xs text-muted-foreground">Occurred · source clock</p><time className="text-sm tabular-nums">{loggingDate(event.occurredAt)}</time></div>
      <div className="rounded-lg border border-border p-3"><p className="mb-1 text-xs text-muted-foreground">Ingested · retained order</p><time className="text-sm tabular-nums">{loggingDate(stored.ingestedAt)}</time></div></div>
    <Details title="Actor and resource" icon={<FileText className="size-3.5" />} rows={[
      ['Actor ID', event.actor.id], ['Actor kind', event.actor.kind], ['Initiator ID', event.actor.initiatorId],
      ['Resource type', event.target?.type], ['Resource ID', event.target?.id],
      ['Scope', event.scope.kind === 'tenant' ? event.scope.tenantId : 'Application'],
    ]} />
    <Details title="Trace and provenance" icon={<Fingerprint className="size-3.5" />} rows={[
      ['Event ID', event.id], ['Source ID', event.sourceId], ['Ingestion position', stored.ordinal], ['Origin', event.origin],
      ['Policy version', event.policyVersion], ['Session ID', event.actor.sessionId], ['Request ID', event.requestId], ['Correlation ID', event.correlationId],
    ]} />
    <Details title="Allowed metadata" icon={<ShieldCheck className="size-3.5" />} rows={Object.entries(event.metadata)} />
    <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">This is one retained event, not proof that an entire workflow completed. Source timestamps can differ from ingestion order. No message or document contents are shown.</p>
  </div></ScrollArea>;
}
function Details({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: readonly (readonly [string, string | number | boolean | null | undefined])[] }) {
  return <section><h4 className="mb-2 flex items-center gap-2 text-xs font-semibold">{icon}{title}</h4>{rows.length ? <dl className="overflow-hidden rounded-lg border border-border text-xs">{rows.map(([name, value]) => <div key={name} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
    <dt className="text-muted-foreground">{name}</dt><dd className="min-w-0 break-all font-mono">{value === null || value === undefined ? <span className="font-sans text-muted-foreground">Not recorded</span> : String(value)}</dd>
  </div>)}</dl> : <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No additional metadata was retained.</p>}</section>;
}

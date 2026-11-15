'use client';

/** Payload-safe presentation only. The workspace owns reads, confirmations and mutations. */
import { useId, type ReactNode } from 'react';
import type { JobActionUnavailableReason, JobOccurrenceView, JobScheduleDetail, JobScheduleSummary } from '../../jobs/contracts';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ChevronLeft } from '../animate-ui/icons/chevron-left';
import { ChevronRight } from '../animate-ui/icons/chevron-right';

type ScheduleAction = 'pause' | 'resume' | 'cancel' | 'runNow';

const unavailableReasons: Record<JobActionUnavailableReason, string> = {
  cancelled: 'Cancelled schedules cannot be changed or run again.',
  'owner-required': 'Only the schedule owner can perform this action.',
  'definition-unavailable': 'The registered job definition is no longer available.',
  'access-denied': 'You do not currently have access to this job definition.',
  'ownership-unavailable': 'This definition does not currently support the schedule’s execution identity.',
};

const blockedReasons: Readonly<Record<string, string>> = {
  JOBS_CAPACITY: 'Scheduling is blocked by capacity. Review capacity before resuming.',
  JOBS_AUTHORITY_RETIRED: 'The accepted execution authority has retired. Review access before resuming.',
  JOBS_DEFINITION_UNAVAILABLE: 'The accepted job definition is unavailable. Review its registration before resuming or editing.',
  JOBS_NOT_DISPATCHED: 'The occurrence was not dispatched to a workflow.',
};

/** Explicit UTC by default; a cron detail may supply its admitted time zone. */
export function formatJobTimestamp(value: number | null, timezone = 'UTC'): string {
  if (value === null) return '—';
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) return 'Unavailable';
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit',
      timeZone: timezone, timeZoneName: 'short',
    }).format(value);
  } catch { return 'Unavailable'; }
}

export { formatJobTimestamp as formatJobsTimestamp };

/** Closed labels: never render raw terminal/error text from an occurrence. */
export function jobOccurrenceStatus(item: JobOccurrenceView): string {
  if (item.state === 'terminal') {
    switch (item.terminalStatus) {
      case 'completed': return 'Workflow completed';
      case 'failed': return 'Workflow failed';
      case 'cancelled': return 'Workflow cancelled';
      case 'superseded': return 'Superseded';
      case 'expired': return 'Expired before dispatch';
      case 'overlap-skipped': return 'Skipped due to overlap';
      case 'not-dispatched': return 'Not dispatched';
      default: return 'Finished';
    }
  }
  switch (item.state) {
    case 'pending': return 'Pending';
    case 'claimed': return 'Dispatch being reconciled';
    case 'dispatched': return 'Workflow accepted';
    case 'blocked': return 'Blocked';
    case 'cancelled': return 'Cancelled before dispatch';
    default: return 'Status unavailable';
  }
}

export function JobsStatusBadge({ row }: { row: JobScheduleSummary }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={row.control === 'paused' ? 'warning' : 'outline'} className="px-1.5 py-0 font-medium">
        {row.control === 'active' ? 'Active' : row.control === 'paused' ? 'Paused' : 'Cancelled'}
      </Badge>
      {row.blockedCode && <Badge variant="warning" className="px-1.5 py-0 font-medium">Blocked</Badge>}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(6rem,0.7fr)_minmax(0,1.3fr)] gap-3 py-1.5 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function OccurrenceStatus({ item }: { item: JobOccurrenceView }) {
  const warning = item.state === 'blocked' || item.terminalStatus === 'expired' || item.terminalStatus === 'overlap-skipped';
  return (
    <Badge variant={item.terminalStatus === 'failed' ? 'destructive' : warning ? 'warning' : 'outline'} className="px-1.5 py-0 font-medium">
      {jobOccurrenceStatus(item)}
    </Badge>
  );
}

function OccurrenceReference({ item, renderRun }: { item: JobOccurrenceView; renderRun?: (id: string) => ReactNode }) {
  return item.workflowId ? (
    <span className="min-w-0 break-all">{renderRun ? renderRun(item.workflowId) : item.workflowId}</span>
  ) : <span className="text-muted-foreground">No workflow reference</span>;
}

function OccurrenceSummary({ item, renderRun }: { item: JobOccurrenceView | null; renderRun?: (id: string) => ReactNode }) {
  if (!item) return <span className="text-muted-foreground">None recorded</span>;
  return (
    <div className="space-y-1">
      <OccurrenceStatus item={item} />
      <p className="text-muted-foreground">{formatJobTimestamp(item.scheduledAt)} · Generation {item.generation}</p>
      <OccurrenceReference item={item} renderRun={renderRun} />
    </div>
  );
}

export interface JobsScheduleDetailsProps {
  readonly detail: JobScheduleDetail;
  readonly definitionLabel: string;
  readonly renderOwner?: (id: string) => ReactNode;
  readonly renderRun?: (id: string) => ReactNode;
  readonly onAction: (action: ScheduleAction, row: JobScheduleSummary, trigger: HTMLButtonElement) => void;
  readonly disabled?: boolean;
  readonly onEdit?: (detail: JobScheduleDetail, trigger: HTMLButtonElement) => void;
}

export function JobsScheduleDetails({ detail, definitionLabel, renderOwner, renderRun, onAction, disabled = false, onEdit }: JobsScheduleDetailsProps) {
  const reasonId = useId();
  const timing = detail.timing;
  const timezone = timing.kind === 'cron' ? timing.timezone : 'UTC';
  const actions: readonly { action: ScheduleAction; label: string }[] = [
    ...(detail.control === 'active' ? [{ action: 'pause' as const, label: 'Pause' }] : []),
    ...(detail.control === 'paused' || detail.blockedCode ? [{ action: 'resume' as const, label: 'Resume' }] : []),
    { action: 'runNow', label: 'Run now' },
    { action: 'cancel', label: 'Cancel schedule' },
  ];
  const unavailable = actions.filter(({ action }) => !detail.actions[action].allowed);
  const editUnavailable = onEdit && !detail.actions.update.allowed;
  const isCancelled = detail.control === 'cancelled';
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-words text-sm font-semibold">{definitionLabel}</h3>
          <JobsStatusBadge row={detail} />
        </div>
        <p className="break-all text-xs text-muted-foreground">{detail.id}</p>
      </div>

      <dl className="divide-y divide-border">
        <DetailRow label="Definition">{detail.definition} · Version {detail.definitionVersion}</DetailRow>
        <DetailRow label="Owner">{renderOwner ? renderOwner(detail.ownerId) : detail.ownerId}</DetailRow>
        <DetailRow label="Run as">{detail.runAs === 'actor' ? 'Schedule owner (actor)' : 'Service identity'}</DetailRow>
        <DetailRow label="Timing">
          {timing.kind === 'once' ? <>Once · {formatJobTimestamp(Date.parse(timing.at))}</> : <>Cron · <code className="break-all font-mono">{timing.pattern}</code></>}
        </DetailRow>
        <DetailRow label="Time zone">{timezone}</DetailRow>
        <DetailRow label="Next due">{detail.nextDueAt === null ? 'No next due time' : formatJobTimestamp(detail.nextDueAt, timezone)}</DetailRow>
        <DetailRow label="Max lateness">{duration(timing.maxLatenessMs)}</DetailRow>
        {timing.kind === 'cron' && (
          <DetailRow label="Missed times">
            {timing.misfire === 'skip' ? 'Admit at most one due time within the lateness window; skip other missed times.'
              : timing.misfire === 'latest' ? 'Admit only the latest due time within the lateness window.'
                : `Catch up at most ${timing.catchUpLimit} due times within the lateness window; skip the remainder.`}
          </DetailRow>
        )}
        <DetailRow label="Overlap">
          {detail.overlap === 'allow' ? 'Allow overlapping executions.'
            : detail.overlap === 'skip' ? 'Skip an occurrence when earlier work is still active.'
              : 'Keep only the newest pending occurrence while earlier work remains active.'}
        </DetailRow>
        <DetailRow label="Skipped times">{detail.skipped ? 'Some due times were deliberately skipped. No exact count is available.' : 'No skipped due times recorded.'}</DetailRow>
        <DetailRow label="Blocking reason">{detail.blockedCode ? blockedReasons[detail.blockedCode] ?? 'Scheduling is blocked. Review current job state.' : 'Not blocked'}</DetailRow>
        <DetailRow label="Latest occurrence"><OccurrenceSummary item={detail.latestOccurrence} renderRun={renderRun} /></DetailRow>
        <DetailRow label="Active representative">
          <OccurrenceSummary item={detail.activeOccurrence} renderRun={renderRun} />
          <p className="mt-1 text-muted-foreground">One representative of claimed or accepted work, not an active-work count. It may belong to an earlier generation.</p>
        </DetailRow>
        <DetailRow label="Revision / generation">{detail.revision} / {detail.generation}</DetailRow>
        <DetailRow label="Updated">{formatJobTimestamp(detail.updatedAt)}</DetailRow>
      </dl>

      <section aria-label="Schedule actions" className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2">
          {actions.map(({ action, label }) => {
            const availability = detail.actions[action];
            return (
              <Button key={action} type="button" size="sm" variant={action === 'cancel' ? 'outline' : 'secondary'}
                disabled={disabled || isCancelled || !availability.allowed}
                aria-describedby={!availability.allowed ? `${reasonId}-${action}` : undefined}
                onClick={(event) => onAction(action, detail, event.currentTarget)}>
                {label}
              </Button>
            );
          })}
          {onEdit && <Button type="button" size="sm" variant="outline" disabled={disabled || isCancelled || !detail.actions.update.allowed}
            aria-describedby={editUnavailable ? `${reasonId}-update` : undefined}
            onClick={(event) => onEdit(detail, event.currentTarget)}>Edit schedule</Button>}
        </div>
        {(unavailable.length > 0 || editUnavailable) && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {unavailable.map(({ action, label }) => {
              const availability = detail.actions[action];
              return !availability.allowed && <li key={action} id={`${reasonId}-${action}`}>{label}: {unavailableReasons[availability.reason]}</li>;
            })}
            {editUnavailable && !detail.actions.update.allowed && <li id={`${reasonId}-update`}>Edit schedule: {unavailableReasons[detail.actions.update.reason]}</li>}
          </ul>
        )}
        {disabled && <p className="text-xs text-muted-foreground">Schedule controls are temporarily unavailable.</p>}
        <p className="text-xs text-muted-foreground">Pausing or cancelling a schedule does not stop already accepted runs. Run now starts an independent new execution; it is not a replay of an occurrence.</p>
        <p className="text-xs text-muted-foreground">Workflow completion is not proof of provider delivery. Review the workflow and provider status separately.</p>
      </section>
    </div>
  );
}

export interface JobsOccurrenceListProps {
  readonly items: readonly JobOccurrenceView[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly onOffset: (offset: number) => void;
  readonly renderRun?: (id: string) => ReactNode;
}

export function JobsOccurrenceList({ items, total, offset, limit, onOffset, renderRun }: JobsOccurrenceListProps) {
  const hasPrevious = offset > 0;
  const hasNext = offset + limit < total;
  return (
    <section aria-label="Occurrence history" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Occurrence history</h3>
        <span className="text-xs text-muted-foreground">{total === 0 ? 'No occurrences' : `${total} ${total === 1 ? 'occurrence' : 'occurrences'}`}</span>
      </div>
      <p className="text-xs text-muted-foreground">Occurrence state and workflow status are separate from provider delivery.</p>
      {items.length === 0 ? <p className="py-3 text-sm text-muted-foreground">No occurrences on this page.</p> : (
        <ol className="divide-y divide-border">
          {items.map(item => (
            <li key={item.id} className="space-y-1.5 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <OccurrenceStatus item={item} />
                <span className="text-xs text-muted-foreground">Generation {item.generation}</span>
              </div>
              <p className="text-xs">Due {formatJobTimestamp(item.scheduledAt)}</p>
              <p className="break-all text-xs text-muted-foreground">{item.id}</p>
              <div className="text-xs"><span className="text-muted-foreground">Workflow: </span><OccurrenceReference item={item} renderRun={renderRun} /></div>
              {item.errorCode && <p className="text-xs text-muted-foreground">{blockedReasons[item.errorCode] ?? 'This occurrence requires review. No additional safe detail is available.'}</p>}
              <p className="text-xs text-muted-foreground">Updated {formatJobTimestamp(item.updatedAt)}</p>
            </li>
          ))}
        </ol>
      )}
      <nav aria-label="Occurrence pagination" className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">
          {items.length ? `${offset + 1}–${offset + items.length} of ${total}` : `0 shown of ${total}`} · {limit} per page
        </span>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="outline" disabled={!hasPrevious} onClick={() => onOffset(Math.max(0, offset - limit))}>
            <ChevronLeft aria-hidden="true" className="size-3.5" /> Previous
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!hasNext} onClick={() => onOffset(offset + limit)}>
            Next <ChevronRight aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </nav>
    </section>
  );
}

function duration(milliseconds: number): string {
  if (milliseconds === 0) return 'No lateness allowed';
  const unit = (divisor: number, name: string) => `${milliseconds / divisor} ${name}${milliseconds / divisor === 1 ? '' : 's'}`;
  if (milliseconds % 86_400_000 === 0) return unit(86_400_000, 'day');
  if (milliseconds % 3_600_000 === 0) return unit(3_600_000, 'hour');
  if (milliseconds % 60_000 === 0) return unit(60_000, 'minute');
  if (milliseconds % 1000 === 0) return unit(1000, 'second');
  return `${milliseconds} milliseconds`;
}

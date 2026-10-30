/** Readable logical activities without altering their original evidence. */
import type { StoredLoggingEvent } from '../../logging/logging-contracts';
import type { LoggingViewSummary } from '../../logging/logging-activity-summary';
import { loggingChangeSummary } from './logging-change-presentation';

export function loggingDuration(ms: number): string {
  if (ms < 1000) return ms === 0 ? '0s' : '<1s';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
export function loggingViewState(view: LoggingViewSummary): string {
  if (!view.complete) return 'Incomplete observation';
  return view.closedAt === null ? 'Open view' : 'View closed';
}
export function loggingActivityDescription(stored: StoredLoggingEvent): string {
  const view = stored.activity?.view;
  if (view) return [stored.event.metadata.resultKind === 'list' ? `${stored.event.metadata.resultCount} records displayed` : null,
    `${loggingDuration(view.visibleMs)} foreground`, `${loggingDuration(view.activeMs)} active`, loggingViewState(view)].filter(Boolean).join(' · ');
  if (stored.event.detail?.kind === 'result') return `${stored.event.detail.recordCount} ${stored.event.detail.resultKind === 'list' ? 'records returned' : 'record returned'} · ordered historical result retained`;
  return loggingChangeSummary(stored.event) ?? (stored.activity && stored.activity.evidenceCount > 1 ? `${stored.activity.evidenceCount} supporting stages` : '—');
}

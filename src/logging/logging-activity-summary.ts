/** Browser-safe derived activity contract. Original signed evidence is never rewritten as a summary. */
import type { LoggingOutcome } from './logging-contracts';

export interface LoggingViewSummary {
  readonly viewId: string;
  readonly openedAt: number | null;
  readonly closedAt: number | null;
  readonly elapsedMs: number;
  readonly visibleMs: number;
  readonly activeMs: number;
  readonly observations: number;
  readonly maxSequence: number;
  readonly explicitIncomplete: boolean;
  readonly afterClose: boolean;
  readonly closedSequence: number | null;
  readonly complete: boolean;
}
export interface LoggingActivitySummary {
  readonly version: 1;
  readonly id: string;
  readonly action: string;
  readonly outcome: LoggingOutcome;
  readonly firstOrdinal: number;
  readonly revision: number;
  readonly startedAt: number;
  readonly evidenceCount: number;
  readonly resultReceiptId?: string;
  readonly view?: LoggingViewSummary;
}

/** JSON transport validation; actor-side descriptor/identity checks are separate. */
export function isLoggingActivitySummary(raw: unknown): raw is LoggingActivitySummary {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const r = raw as LoggingActivitySummary;
  const integer = (n: unknown, minimum = 0) => typeof n === 'number' && Number.isSafeInteger(n) && n >= minimum;
  if (Object.keys(r).some(k => !['version', 'id', 'action', 'outcome', 'firstOrdinal', 'revision', 'startedAt', 'evidenceCount', 'resultReceiptId', 'view'].includes(k))
    || r.version !== 1 || !/^[a-f0-9]{64}$/.test(r.id) || typeof r.action !== 'string' || !/^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/.test(r.action)
    || !['attempted', 'succeeded', 'denied', 'failed', 'unknown'].includes(r.outcome) || !integer(r.firstOrdinal, 1)
    || !integer(r.revision, r.firstOrdinal) || !integer(r.startedAt) || !integer(r.evidenceCount, 1)
    || r.resultReceiptId !== undefined && (typeof r.resultReceiptId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(r.resultReceiptId))) return false;
  if (r.view === undefined) return true;
  const v = r.view;
  return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(k => ['viewId', 'openedAt', 'closedAt', 'elapsedMs', 'visibleMs', 'activeMs', 'observations', 'maxSequence', 'explicitIncomplete', 'afterClose', 'closedSequence', 'complete'].includes(k))
    && typeof v.viewId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(v.viewId)
    && (v.openedAt === null || integer(v.openedAt)) && (v.closedAt === null || integer(v.closedAt))
    && [v.elapsedMs, v.visibleMs, v.activeMs, v.maxSequence].every(n => integer(n)) && integer(v.observations, 1)
    && v.activeMs <= v.visibleMs && v.visibleMs <= v.elapsedMs && typeof v.explicitIncomplete === 'boolean'
    && typeof v.afterClose === 'boolean' && (v.closedSequence === null || integer(v.closedSequence))
    && typeof v.complete === 'boolean' && v.complete === (!v.explicitIncomplete && !v.afterClose && v.openedAt !== null && v.observations === v.maxSequence + 1);
}

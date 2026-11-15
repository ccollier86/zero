/**
 * Pure bounded time selection for the durable scheduling realm under construction.
 * Does not register timers, persist jobs or execute effects. Calendar recurrence
 * is a different domain: a cron pattern is not an RFC 5545 appointment series.
 */
import { Cron } from 'croner';
import { SchedulerError } from '../scheduler/scheduler-error';
import { workerRecord } from '../workers/worker-value';

export type MisfirePolicy = 'skip' | 'latest' | 'catch-up';
export type ScheduleTiming =
  | Readonly<{ kind: 'once'; at: string; maxLatenessMs: number }>
  | Readonly<{ kind: 'cron'; pattern: string; timezone: string; misfire: MisfirePolicy; maxLatenessMs: number; catchUpLimit: number }>;
export interface DueOccurrences {
  readonly scheduledAt: readonly number[];
  readonly nextDueAt: number | null;
  /** Some nominal occurrences were deliberately dropped. Not a fabricated exact count. */
  readonly skipped: boolean;
}
const MAX_AGE_MS = 366 * 24 * 60 * 60 * 1000;

export function normalizeScheduleTiming(input: unknown): ScheduleTiming {
  try {
    const r = workerRecord(input, ['kind', 'at', 'pattern', 'timezone', 'misfire', 'maxLatenessMs', 'catchUpLimit']);
    const maxLatenessMs = boundedInteger(r.maxLatenessMs ?? 60_000, 0, MAX_AGE_MS);
    if (r.kind === 'once') {
      if (Object.keys(r).some(key => !['kind', 'at', 'maxLatenessMs'].includes(key))) throw invalid();
      return Object.freeze({ kind: 'once', at: utcInstant(r.at), maxLatenessMs });
    }
    if (r.kind !== 'cron' || r.at !== undefined || typeof r.pattern !== 'string' || !r.pattern.trim() || r.pattern.length > 256
      || typeof r.timezone !== 'string' || !r.timezone.trim() || r.timezone.length > 128) throw invalid();
    // A durable schedule never silently inherits a host-local timezone.
    new Intl.DateTimeFormat('en', { timeZone: r.timezone }).format(0);
    const misfire = r.misfire ?? 'latest';
    if (!['skip', 'latest', 'catch-up'].includes(misfire as string)) throw invalid();
    const timing = Object.freeze({ kind: 'cron' as const, pattern: r.pattern, timezone: r.timezone,
      misfire: misfire as MisfirePolicy, maxLatenessMs, catchUpLimit: boundedInteger(r.catchUpLimit ?? 10, 1, 100) });
    withCron(timing, cron => nextAfter(cron, 0));
    return timing;
  } catch { throw invalid(); }
}

export function initialScheduleDue(timing: ScheduleTiming, after: number): number | null {
  instant(after);
  return timing.kind === 'once' ? Date.parse(timing.at) : withCron(timing, cron => nextAfter(cron, after));
}

/** Select one bounded recovery batch; advancing nextDueAt commits with the corresponding occurrence intents. */
export function selectDueOccurrences(timing: ScheduleTiming, nextDueAt: number | null, now: number): DueOccurrences {
  instant(now);
  if (nextDueAt === null) return result([], null, false);
  instant(nextDueAt);
  if (nextDueAt > now) return result([], nextDueAt, false);
  const cutoff = now - timing.maxLatenessMs;
  if (timing.kind === 'once') {
    if (nextDueAt !== Date.parse(timing.at)) throw invalid();
    return result(nextDueAt < cutoff ? [] : [nextDueAt], null, nextDueAt < cutoff);
  }
  return withCron(timing, cron => {
    // Reject a corrupt/stale cursor instead of firing a non-occurrence. Croner
    // strips milliseconds and calculates strictly after its supplied instant.
    if (nextAfter(cron, nextDueAt - 1000) !== nextDueAt) throw invalid();
    const future = nextAfter(cron, now);
    if (timing.misfire === 'skip') return result(nextDueAt < cutoff ? [] : [nextDueAt], future,
      nextDueAt < cutoff || (nextAfter(cron, nextDueAt) ?? Infinity) <= now);
    if (timing.misfire === 'latest') {
      const latest = latestDue(cron, nextDueAt, now);
      return result(latest < cutoff ? [] : [latest], future, latest !== nextDueAt || latest < cutoff);
    }
    let cursor = nextDueAt < cutoff ? nextAfter(cron, cutoff - 1) : nextDueAt;
    const selected: number[] = [];
    while (cursor !== null && cursor <= now && selected.length < timing.catchUpLimit) {
      selected.push(cursor); cursor = nextAfter(cron, cursor);
    }
    // catch-up is a total recovery cap, not an unbounded queue split into pages.
    // Remaining due work is deliberately skipped, and that fact is observable.
    return result(selected, future, nextDueAt < cutoff || cursor !== null && cursor <= now);
  });
}

/** Find the last occurrence in O(log milliseconds), not one iteration per missed second. */
function latestDue(cron: Cron, first: number, now: number): number {
  let low = first, high = now, latest = first, steps = 0;
  while (low <= high) {
    if (++steps > 54) throw invalid();
    const middle = low + Math.floor((high - low) / 2), candidate = nextAfter(cron, middle);
    if (candidate !== null && candidate <= now) { latest = Math.max(latest, candidate); low = middle + 1; }
    else high = middle - 1;
  }
  return latest;
}

/**
 * Croner 6 can resolve the second half of a fall-back hour to its first-fold
 * instant, even when that instant precedes the supplied date. Durable cron uses
 * first-fold-only semantics: find the earliest subsequent wall-clock occurrence
 * with a bounded search, never re-admit that earlier instant or blindly jump an
 * hour (some zones change by 30 minutes and intermediate valid times matter).
 * Spring gaps retain Croner's forward-shift behavior, qualified in tests.
 */
function nextAfter(cron: Cron, after: number): number | null {
  const raw = (date: number) => time(cron.nextRun(new Date(date)));
  const initial = raw(after);
  if (initial === null || initial > after) return initial;
  let low = after + 1, high = after + 1000, distance = 1000, candidate = raw(high);
  const maxWindow = 48 * 60 * 60 * 1000;
  while (candidate !== null && candidate <= after) {
    if (distance >= maxWindow) throw invalid();
    distance = Math.min(distance * 2, maxWindow); high = after + distance; candidate = raw(high);
  }
  if (candidate === null) return null;
  let selected = candidate, steps = 0;
  while (low <= high) {
    if (++steps > 54) throw invalid();
    const middle = low + Math.floor((high - low) / 2), value = raw(middle);
    if (value === null || value > after) { if (value !== null) selected = value; high = middle - 1; }
    else low = middle + 1;
  }
  if (selected <= after) throw invalid();
  return selected;
}
function withCron<T>(timing: Extract<ScheduleTiming, { kind: 'cron' }>, run: (cron: Cron) => T): T {
  let cron: Cron | undefined;
  try { cron = new Cron(timing.pattern, { timezone: timing.timezone, paused: true }); return run(cron); }
  catch { throw invalid(); }
  finally { cron?.stop(); }
}
function utcInstant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) throw invalid();
  const expected = value.includes('.') ? value.replace(/\.(\d{1,3})Z$/, (_, fraction: string) => '.' + fraction.padEnd(3, '0') + 'Z') : value.slice(0, -1) + '.000Z';
  const normalized = new Date(value).toISOString();
  if (normalized !== expected) throw invalid();
  return normalized;
}
function instant(value: number): void { if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) throw invalid(); }
function time(value: Date | null): number | null { return value?.getTime() ?? null; }
function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw invalid();
  return value;
}
function result(scheduledAt: number[], nextDueAt: number | null, skipped: boolean): DueOccurrences {
  return Object.freeze({ scheduledAt: Object.freeze(scheduledAt), nextDueAt, skipped });
}
function invalid() { return new SchedulerError('SCHEDULER_JOB_INVALID', 'Durable scheduling time or recovery policy is invalid.'); }

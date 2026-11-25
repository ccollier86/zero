/** Private current/staged series occupancy. This reports existence only, never
 * private appointment IDs, coverage or authority to ignore a reservation. */
import { cloneDatabaseSerializableValue } from '../databases/database-operation-payload';
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import type { CalendarReadContext } from './calendar-read-store';
import { CalendarError } from './error';
import { CALENDAR_SERIES_MATERIALIZATION_TABLES } from './realm-series-materialization-migration';
import { calendarOverlapSearchStart, type CalendarTimedInterval } from './time';
import { calendarInteger, calendarKey, calendarRecord, calendarScope } from './validation';

export const CALENDAR_SERIES_OCCUPANCY_QUERY = 'calendar.seriesOccupancy';
const t = CALENDAR_SERIES_MATERIALIZATION_TABLES;
const DAY_MS = 86_400_000, DATE_LIMIT_MS = 8_640_000_000_000_000;
export interface CalendarSeriesOccupancyInput {
  readonly scopeId: string;
  readonly resourceIds: readonly string[];
  readonly occupiedStartMs: number;
  readonly occupiedEndMs: number;
  readonly nowMs: number;
  /** Native-only exact reviewed replacement versions (including a candidate's
   * own already staged version while binding its next resource). No series-wide
   * exclusion exists. Ordinary Calendar wrappers never accept this field. */
  readonly excludeVersionIds?: readonly string[];
}
export interface CalendarSeriesOccupancyResult {
  readonly currentConflict: boolean;
  readonly pendingConflict: boolean;
  readonly reconciliationNeeded: boolean;
}
function invalid(): never { throw new CalendarError('CALENDAR_INPUT_INVALID'); }
function notReady(): never { throw new CalendarError('CALENDAR_NOT_READY'); }
/** Closed shape shared by the forward selected-child profile. This does not
 * authorize exclusions; each canonical writer proves that set independently. */
export function admitCalendarSeriesOccupancyInput(value: unknown): CalendarSeriesOccupancyInput {
  // The native 1,000-version exclusion bound can exceed Calendar's unrelated
  // 32KiB per-value cap. Use the existing bounded actor payload validator, then
  // explicit field/list bounds; never serialize getters/proxies for validation.
  let r: Record<string, unknown>;
  try { r = calendarRecord(cloneDatabaseSerializableValue(value), ['scopeId', 'resourceIds', 'occupiedStartMs', 'occupiedEndMs', 'nowMs', 'excludeVersionIds']); }
  catch { return invalid(); }
  if (!Array.isArray(r.resourceIds) || r.resourceIds.length < 1 || r.resourceIds.length > 16) return invalid();
  const resourceIds = r.resourceIds.map(value => calendarKey(value)).sort();
  if (new Set(resourceIds).size !== resourceIds.length) return invalid();
  const occupiedStartMs = calendarInteger(r.occupiedStartMs, -DATE_LIMIT_MS, DATE_LIMIT_MS);
  const occupiedEndMs = calendarInteger(r.occupiedEndMs, -DATE_LIMIT_MS, DATE_LIMIT_MS);
  calendarInteger(occupiedEndMs - occupiedStartMs, 1, 33 * DAY_MS);
  const exclude = r.excludeVersionIds;
  if (exclude !== undefined && (!Array.isArray(exclude) || exclude.length > 1000)) return invalid();
  const excludeVersionIds = exclude === undefined ? [] : (exclude as unknown[]).map(value => calendarKey(value)).sort();
  if (new Set(excludeVersionIds).size !== excludeVersionIds.length) return invalid();
  return Object.freeze({ scopeId: calendarScope(r.scopeId), resourceIds: Object.freeze(resourceIds), occupiedStartMs, occupiedEndMs,
    nowMs: calendarInteger(r.nowMs, 0), excludeVersionIds: Object.freeze(excludeVersionIds) });
}

/** Register only in the private 021 profile. All selection/expiry/exclusion
 * predicates execute in SQL BEFORE LIMIT; retained/superseded history cannot
 * consume a page or turn absence in a filtered prefix into "free". The native
 * source writer separately validates the exact exclusion set at COMMIT. */
export function readCalendarSeriesOccupancy(context: DatabaseReadQueryContext, requested: unknown): CalendarSeriesOccupancyResult {
  const r = admitCalendarSeriesOccupancyInput(requested), resources = r.resourceIds.map(() => '?').join(','), excluded = r.excludeVersionIds!;
  const exclusion = (alias: string) => excluded.length ? ` AND ${alias}.version_id NOT IN (${excluded.map(() => '?').join(',')})` : '';
  const firstCell = Math.floor(r.occupiedStartMs / DAY_MS) * DAY_MS, lastCell = Math.floor((r.occupiedEndMs - 1) / DAY_MS) * DAY_MS;
  const current = context.database.query(`SELECT 1 AS present FROM ${t.selectors} s
    JOIN calendar_series p ON p.id=s.series_id AND p.scope_id=s.scope_id AND p.published_publication_id=s.source_publication_id
    JOIN ${t.cellSets} c ON c.id=s.cell_set_id AND c.scope_id=s.scope_id AND c.series_id=s.series_id AND c.resource_id=s.resource_id AND c.cell_start_ms=s.cell_start_ms
    JOIN ${t.runState} q ON q.id=c.run_id AND q.scope_id=c.scope_id AND q.state='published'
    JOIN ${t.workingMembers} m ON m.selector_id=s.id AND m.cell_set_id=s.cell_set_id AND m.scope_id=s.scope_id AND m.resource_id=s.resource_id
    WHERE s.scope_id=? AND s.resource_id IN (${resources}) AND s.cell_start_ms>=? AND s.cell_start_ms<=?
      AND m.from_ms<? AND m.until_ms>?${exclusion('m')} LIMIT 1`)
    .get(r.scopeId, ...r.resourceIds, firstCell, lastCell, r.occupiedEndMs, r.occupiedStartMs, ...excluded) !== null;
  // These are bounded WORKING whole-interval claims, not historical immutable
  // members. Even a partial cell projection occupies its full claimed interval.
  // Sealed-but-not-published claims remain pending. Retirement or clock expiry
  // cannot erase an admitted claim; only canonical publish/abort reconciliation.
  // An aborted run may still have another bounded physical cleanup page. Those
  // remaining claims are reconciliation work, never a false "free" preview.
  const pending = `FROM ${t.claims} c JOIN ${t.runs} r ON r.id=c.run_id AND r.scope_id=c.scope_id
    JOIN ${t.runState} q ON q.id=r.id AND q.scope_id=r.scope_id
    WHERE c.scope_id=? AND c.resource_id IN (${resources}) AND c.from_ms>=? AND c.from_ms<? AND c.until_ms>?
      AND q.state IN ('preparing','blocked','sealed','aborted')${exclusion('c')}`;
  const parameters = [r.scopeId, ...r.resourceIds, calendarOverlapSearchStart(r.occupiedStartMs), r.occupiedEndMs, r.occupiedStartMs, ...excluded];
  const pendingConflict = context.database.query(`SELECT 1 AS present ${pending} AND q.state<>'aborted' AND c.expires_ms>? AND r.expires_ms>? LIMIT 1`)
    .get(...parameters, r.nowMs, r.nowMs) !== null;
  const reconciliationNeeded = context.database.query(`SELECT 1 AS present ${pending} AND (q.state='aborted' OR c.expires_ms<=? OR r.expires_ms<=?) LIMIT 1`)
    .get(...parameters, r.nowMs, r.nowMs) !== null;
  return Object.freeze({ currentConflict: current, pendingConflict, reconciliationNeeded });
}

/** Ordinary and hard-override admission both call this. Old registered profiles
 * have no 021 marker and perform no series query/schema installation. Presence
 * of that marker without a valid fixed bridge is NOT evidence of free time. */
export function assertCalendarSeriesResourcesAvailable(context: CalendarReadContext, scopeId: string,
  resourceIds: readonly string[], interval: CalendarTimedInterval, nowMs: number): void {
  if (!context.db.hasTable(t.state)) return;
  if (context.db.get(t.state, 'application')?.version !== 21) return notReady();
  const requested = { scopeId, resourceIds: [...resourceIds], occupiedStartMs: interval.occupiedStartMs, occupiedEndMs: interval.occupiedEndMs, nowMs };
  let result: Record<string, unknown>;
  try {
    const value = context.seriesOccupancy ? context.seriesOccupancy(requested)
      : context.query ? context.query(CALENDAR_SERIES_OCCUPANCY_QUERY, requested) : notReady();
    result = calendarRecord(value, ['currentConflict', 'pendingConflict', 'reconciliationNeeded']);
    if (Object.keys(result).length !== 3 || Object.values(result).some(value => typeof value !== 'boolean')) return notReady();
  } catch { return notReady(); }
  if (result.reconciliationNeeded) return notReady();
  if (result.currentConflict || result.pendingConflict) throw new CalendarError('CALENDAR_BOOKING_CONFLICT');
}

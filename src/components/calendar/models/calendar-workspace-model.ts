/** Pure display adapter for authoritative timed core records. Never interprets the browser's timezone as scheduling authority. */
import type { CalendarAppointmentView, CalendarCommandReceipt, CalendarRangeQuery, CalendarResourceView, CalendarLocationSnapshot, CalendarVisitMode,
  CalendarAppointmentTypeSnapshot, CalendarParticipantReference } from '../../../calendar/contracts';
import type { CalendarResource, ScheduleEvent } from '../types';
import type { CalendarViewMode } from '../recovered/calendar/types/calendar-view-mode';
import { dateKey } from './calendar-date';
import { calendarLocalDate } from './calendar-local-date';
import { monthDates, weekDates } from './calendar-model';
const DAY_MS = 86400_000;
const isDay = (value: string) => calendarLocalDate(value) !== null;
export interface CalendarCoreDraft { resourceId: string; title: string; date: string; start: number; end: number;
  visitMode?: CalendarVisitMode | 'unspecified'; visitLocation?: CalendarLocationSnapshot;
  appointmentType?: CalendarAppointmentTypeSnapshot | null; bufferBeforeMinutes?: number; bufferAfterMinutes?: number;
  participants?: readonly CalendarParticipantReference[] }
/** One modal opening owns its accepted base and draft; live data never silently rebases it. */
export interface CalendarCoreSession {
  readonly key: number;
  readonly selection: string;
  readonly initial: CalendarCoreDraft;
  readonly trigger?: HTMLElement;
  readonly record?: CalendarAppointmentView;
  /** Capture optional creation controls; capability retirement cannot silently change an open draft's intent. */
  readonly participantAccess?: boolean;
}
export function calendarDisplayDays(date: Date, view: CalendarViewMode): readonly string[] {
  return view === 'month' ? monthDates(date) : view === 'week' ? weekDates(date) : [dateKey(date)];
}
/** Conservative instant superset for IANA zones; split month views into bounded service-owned range watches. */
export function calendarWorkspaceQueries(days: readonly string[], resourceIds: readonly string[], maxRangeDays = 31, timeZone?: string): readonly CalendarRangeQuery[] {
  if (!resourceIds.length || !days.length) return [];
  if (resourceIds.length > 16 || days.length > 42 || days.some(day => !isDay(day))
    || !Number.isInteger(maxRangeDays) || maxRangeDays < 1 || maxRangeDays > 31) throw new Error('Unsupported calendar display range.');
  let start = Date.parse(days[0]! + 'T00:00:00.000Z') - DAY_MS;
  let end = Date.parse(days.at(-1)! + 'T00:00:00.000Z') + 2 * DAY_MS;
  if (timeZone) {
    const nextDay = new Date(Date.parse(days.at(-1)! + 'T00:00:00.000Z') + DAY_MS).toISOString().slice(0, 10);
    const from = calendarWallTimeCandidates(days[0]!, 0, timeZone), to = calendarWallTimeCandidates(nextDay, 0, timeZone);
    // Unambiguous local midnights give exact display bounds. For unusual
    // missing/folded midnights retain the conservative superset, never guess.
    if (from.length === 1 && to.length === 1) { start = Date.parse(from[0]!); end = Date.parse(to[0]!); }
  }
  const queries: CalendarRangeQuery[] = [];
  while (start < end) {
    const next = Math.min(start + maxRangeDays * DAY_MS, end);
    queries.push({ resourceIds: [...resourceIds], startAt: new Date(start).toISOString(), endAt: new Date(next).toISOString() }); start = next;
  }
  return queries;
}
export function calendarUiResource(resource: CalendarResourceView): CalendarResource {
  return { id: resource.id, name: resource.label, color: 'blue', initials: resource.label.split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toLocaleUpperCase() };
}
export function calendarZonedParts(instant: string | number, timeZone: string): { date: string; minute: number; second: number; offset: number } {
  const epoch = typeof instant === 'number' ? instant : Date.parse(instant);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, calendar: 'gregory', era: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(epoch);
  const value = (kind: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === kind)!.value;
  const year = value('era') === 'BC' ? 1 - Number(value('year')) : Number(value('year'));
  const yearLabel = year < 0 ? '-' + String(-year).padStart(6, '0') : year > 9999 ? '+' + String(year).padStart(6, '0') : String(year).padStart(4, '0');
  const date = `${yearLabel}-${value('month')}-${value('day')}`, minute = Number(value('hour')) * 60 + Number(value('minute')), second = Number(value('second'));
  const wall = Date.parse(`${date}T${value('hour')}:${value('minute')}:${value('second')}.000Z`);
  return { date, minute, second, offset: wall - Math.floor(epoch / 1000) * 1000 };
}
/** All matching instants, not an arbitrary fold preference. Gaps and ambiguous times require an explicit different choice in the core editor. */
export function calendarWallTimeCandidates(date: string, minute: number, timeZone: string): readonly string[] {
  if (!isDay(date) || !Number.isInteger(minute) || minute < 0 || minute >= 1440) return [];
  const wall = Date.parse(`${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00.000Z`), offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) offsets.add(calendarZonedParts(wall + hours * 3600_000, timeZone).offset);
  return [...offsets].map(offset => wall - offset).filter(epoch => {
    const p = calendarZonedParts(epoch, timeZone); return p.date === date && p.minute === minute && p.second === 0;
  }).sort((a, b) => a - b).map(epoch => new Date(epoch).toISOString());
}
export function calendarCoreDraftInterval(draft: CalendarCoreDraft, timeZone: string): { startAt: string; endAt: string } | { error: string } {
  if (!draft.title.trim() || draft.title.length > 512 || /[\u0000-\u001f\u007f]/.test(draft.title)) return { error: 'Enter a valid core appointment title.' };
  if (!isDay(draft.date) || !Number.isInteger(draft.start) || !Number.isInteger(draft.end) || draft.start >= draft.end) return { error: 'Choose a valid date and an end time after the start.' };
  const start = calendarWallTimeCandidates(draft.date, draft.start, timeZone), end = calendarWallTimeCandidates(draft.date, draft.end, timeZone);
  if (!start.length || !end.length) return { error: 'This local time does not exist in the scheduling timezone. Choose another time.' };
  if (start.length !== 1 || end.length !== 1) return { error: 'This local time occurs twice in the scheduling timezone. Choose an unambiguous time; no offset is guessed.' };
  return { startAt: start[0]!, endAt: end[0]! };
}
export interface CalendarWorkspaceProjection {
  readonly events: readonly ScheduleEvent[];
  readonly sourceByEventId: ReadonlyMap<string, CalendarAppointmentView>;
  /** Records not fully representable by the existing 7 AM–7 PM grid, preserved in a real-instant companion list. */
  readonly supplemental: readonly CalendarAppointmentView[];
}
export function projectCalendarAppointments(records: readonly CalendarAppointmentView[], resourceIds: readonly string[], days: readonly string[], timeZone: string, view: CalendarViewMode): CalendarWorkspaceProjection {
  const events: ScheduleEvent[] = [], sourceByEventId = new Map<string, CalendarAppointmentView>(), supplemental = new Map<string, CalendarAppointmentView>();
  const first = days[0], last = days.at(-1); if (!first || !last) return { events, sourceByEventId, supplemental: [] };
  for (const source of records) {
    if (source.interval) continue; // LocalDate authority has a dedicated projection, never midnight minute geometry.
    const start = calendarZonedParts(source.startAt, timeZone), end = calendarZonedParts(source.endAt, timeZone);
    if (start.date > last || end.date < first || end.date === first && end.minute === 0 && end.second === 0) continue;
    const admitted = source.resourceIds.filter(id => resourceIds.includes(id)); if (!admitted.length) continue;
    const unsupported = start.date !== end.date || start.offset !== end.offset || start.second !== 0 || end.second !== 0
      || Date.parse(source.startAt) % 60000 !== 0 || Date.parse(source.endAt) % 60000 !== 0;
    if (unsupported) { supplemental.set(source.id, source); continue; }
    for (const day of days) {
      if (day < start.date || day > end.date) continue;
      const from = day === start.date ? start.minute : 0, to = day === end.date ? end.minute : 1440;
      if (from >= to) continue;
      const grid = view === 'day' || view === 'week', visibleStart = from, visibleEnd = to;
      if (grid && (from < 420 || to > 1140)) { supplemental.set(source.id, source); continue; }
      if (visibleStart >= visibleEnd) continue;
      for (const resourceId of admitted) {
        const id = JSON.stringify([source.id, resourceId, day]); sourceByEventId.set(id, source);
        events.push({ id, resourceId, date: day, title: source.title, titleMode: 'custom', start: visibleStart, end: visibleEnd,
          kind: 'appointment', status: source.lifecycle?.status ?? source.status,
          location: source.visit?.mode === 'in-person' ? 'In-person' : source.visit?.mode === 'video' ? 'Telehealth' : source.visit?.mode === 'phone' ? 'Phone' : 'Unspecified',
          notes: '', patientId: null, attendees: [],
          visitType: null, customVisitType: '', recurrence: null, reminder: null, sendReminder: false });
      }
    }
  }
  return { events, sourceByEventId, supplemental: [...supplemental.values()] };
}
/** One draft opening owns one submitted revision and key. New typing, late receipts and replaced openings cannot close a newer draft. */
export class CalendarDraftReceiptFence {
  private revision = 0;
  private submitted: { revision: number; key: string; operation: CalendarCommandReceipt['operation']; id?: string } | null = null;
  edit(): void { this.revision++; }
  submit(key: string, operation: CalendarCommandReceipt['operation'], id?: string): void {
    if (this.submitted) throw new Error('Reconcile the submitted calendar request first.');
    this.submitted = { revision: this.revision, key, operation, id };
  }
  accepted(receipt: CalendarCommandReceipt): { matches: boolean; canClose: boolean } {
    const submitted = this.submitted;
    const matches = !!submitted && receipt.requestId === submitted.key && receipt.operation === submitted.operation && (submitted.id === undefined || receipt.id === submitted.id);
    return { matches, canClose: matches && submitted!.revision === this.revision };
  }
  rejected(): void { this.submitted = null; }
}

export interface CalendarPendingRequest {
  readonly key: string; readonly operation: CalendarCommandReceipt['operation']; readonly id?: string;
  /** Mutation base survives editor retirement; never settle a receipt for an impossible generation. */
  readonly expectedRevision?: number;
}
export function calendarPendingReceiptMatches(request: CalendarPendingRequest, receipt: CalendarCommandReceipt): boolean {
  if (request.key !== receipt.requestId || request.operation !== receipt.operation || request.id !== undefined && request.id !== receipt.id
    || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || typeof receipt.changed !== 'boolean') return false;
  if (request.operation === 'appointment.created') return receipt.revision === 1 && receipt.changed;
  return request.id !== undefined && request.id.length > 0 && request.expectedRevision !== undefined && Number.isSafeInteger(request.expectedRevision) && request.expectedRevision >= 1
    && receipt.revision === request.expectedRevision + (receipt.changed ? 1 : 0)
    && (request.operation !== 'appointment.transitioned' || receipt.changed);
}
/** Scope-owned recovery survives an editor closing. An older read or editor cannot settle a newer request. */
export class CalendarPendingRequestLedger {
  private pending: CalendarPendingRequest | null = null;
  private reconciling: CalendarPendingRequest | null = null;
  track(request: CalendarPendingRequest): void { this.pending = request; }
  settle(request: CalendarPendingRequest): boolean {
    if (this.pending !== request) return false;
    this.pending = null; return true;
  }
  beginReconciliation(): CalendarPendingRequest | null {
    if (!this.pending || this.reconciling) return null;
    this.reconciling = this.pending; return this.reconciling;
  }
  finishReconciliation(request: CalendarPendingRequest): void { if (this.reconciling === request) this.reconciling = null; }
}

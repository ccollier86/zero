/** Browser-safe scoped calendar commands. The SDK retires this entire transport on every authority replacement. */
import type { CalendarAppointmentInput, CalendarAppointmentPage, CalendarAppointmentView, CalendarBusyPage, CalendarCommandReceipt,
  CalendarControlOptions, CalendarGrant, CalendarRangeQuery, CalendarReadOptions, CalendarRequestOptions, CalendarRescheduleInput, CalendarResourceInput,
  CalendarResourcePage, CalendarResourcePageQuery, CalendarResourceView, CalendarWatchOptions, CalendarWatchUpdate, ScopedCalendar } from '../../calendar/contracts';
import type { FetchInit } from './sdk';
import { calendarFailureDetails, calendarMutationFailure, CalendarReadError } from './calendar-mutation';
import { watchCalendarRange } from './calendar-client-watch';
export interface CalendarClient extends ScopedCalendar { clear(): void }
export function createCalendarClient(fetch: <T = unknown>(path: string, init?: FetchInit) => Promise<T>,
  open?: (path: string, init: RequestInit) => Promise<Response>): CalendarClient {
  let generation = 0, boundary = new AbortController();
  async function call(path: string, method = 'GET', body?: unknown, signal?: AbortSignal, dispatched?: () => void): Promise<unknown> {
    const epoch = generation, combined = AbortSignal.any([boundary.signal, ...(signal ? [signal] : [])]); combined.throwIfAborted();
    const captured = body === undefined ? undefined : structuredClone(body); dispatched?.();
    let result: unknown;
    try { result = await fetch('/api/calendar' + path, { method, ...(captured === undefined ? {} : { body: captured }), signal: combined }); }
    catch (error) { if (epoch !== generation || combined.aborted) throw retired(); throw error; }
    if (epoch !== generation || combined.aborted) throw retired(); return result;
  }
  async function read<T>(path: string, parse: (value: unknown) => T, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
    try { return parse(await call(path, method, body, signal)); }
    catch (cause) { if (cause instanceof Error && cause.name === 'AbortError') throw cause;
      const { code, status } = calendarFailureDetails(cause); throw new CalendarReadError(code, status); }
  }
  async function mutation(path: string, body: unknown, supplied: CalendarRequestOptions,
    operation: CalendarCommandReceipt['operation'], id?: string): Promise<CalendarCommandReceipt> {
    const key = requestKey(supplied.idempotencyKey); let dispatched = false;
    try { const receipt = calendarReceipt(await call(path, 'POST', body, supplied.signal, () => { dispatched = true; }));
      if (receipt.requestId !== key || receipt.operation !== operation || id !== undefined && receipt.id !== id) throw invalid(); return receipt; }
    catch (error) { if (!dispatched) throw error; throw calendarMutationFailure(error, key); }
  }
  return Object.freeze({
    resources: Object.freeze({
      list(supplied?: CalendarResourcePageQuery, readOptions?: CalendarReadOptions) {
        const r = record(supplied ?? {}, ['limit', 'after']), params = new URLSearchParams();
        if (r.limit !== undefined) params.set('limit', String(integer(r.limit, 1, 100)));
        if (r.after !== undefined) params.set('after', requestKey(r.after));
        return read('/resources' + (params.size ? '?' + params : ''), resourcePage, 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarResourceInput, supplied: CalendarRequestOptions) {
        const r = record(input, ['label', 'kind', 'ownerId', 'timeZone']);
        identifier(r.label, 256); zone(r.timeZone); if (r.kind !== 'person' && r.kind !== 'room' && r.kind !== 'equipment') throw invalid();
        if (r.ownerId !== undefined && r.ownerId !== null) requestKey(r.ownerId);
        return mutation('/resources', { resource: r, options: options(supplied) }, supplied, 'resource.created');
      },
      setGrants(id: string, userId: string, grants: readonly CalendarGrant[], supplied: CalendarControlOptions) {
        requestKey(id); requestKey(userId);
        const accepted = values(grants, 4);
        if (accepted.some(grant => grant !== 'busy' && grant !== 'details' && grant !== 'book' && grant !== 'manage')) throw invalid();
        unique(accepted);
        return mutation('/resources/' + encodeURIComponent(id) + '/grants', { userId, grants: accepted, options: options(supplied, true) }, supplied, 'resource.grant-changed', id);
      },
    }),
    appointments: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/appointments/query', appointmentPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      get(id: string, readOptions?: CalendarReadOptions) { return read('/appointments/' + encodeURIComponent(requestKey(id)), appointmentView, 'GET', undefined, readSignal(readOptions)); },
      create(input: CalendarAppointmentInput, supplied: CalendarRequestOptions) {
        const r = appointmentInput(input, true); return mutation('/appointments', { appointment: r, options: options(supplied) }, supplied, 'appointment.created');
      },
      reschedule(id: string, input: CalendarRescheduleInput, supplied: CalendarControlOptions) {
        return mutation('/appointments/' + encodeURIComponent(requestKey(id)) + '/reschedule',
          { appointment: appointmentInput(input, false), options: options(supplied, true) }, supplied, 'appointment.rescheduled', id);
      },
      cancel(id: string, supplied: CalendarControlOptions) {
        return mutation('/appointments/' + encodeURIComponent(requestKey(id)) + '/cancel', { options: options(supplied, true) }, supplied, 'appointment.cancelled', id);
      },
      watch(query: CalendarRangeQuery, listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const r = range(query), o = record(supplied, ['signal', 'onError']);
        if (!open || typeof listener !== 'function' || o.signal !== undefined && !(o.signal instanceof AbortSignal)
          || o.onError !== undefined && typeof o.onError !== 'function') throw invalid();
        const params = new URLSearchParams({ resourceIds: (r.resourceIds as string[]).join(','), startAt: String(r.startAt), endAt: String(r.endAt) });
        if (r.limit !== undefined) params.set('limit', String(r.limit));
        const accepted: CalendarWatchOptions = { ...(o.signal === undefined ? {} : { signal: o.signal as AbortSignal }),
          ...(o.onError === undefined ? {} : { onError: o.onError as (error: unknown) => void }) };
        return watchCalendarRange(open, '/api/calendar/appointments/live?' + params, boundary.signal, listener, appointmentPage, accepted);
      },
    }),
    busy: Object.freeze({ query(query: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/busy/query', busyPage, 'POST', { query: range(query) }, readSignal(readOptions)); } }),
    receipts: Object.freeze({ get(key: string, readOptions?: CalendarReadOptions) { return read('/receipts/' + encodeURIComponent(requestKey(key)), value => {
      const r = record(value, ['receipt']); if (!Object.hasOwn(r, 'receipt')) throw invalid(); return r.receipt === null ? null : calendarReceipt(r.receipt);
    }, 'GET', undefined, readSignal(readOptions)); } }),
    clear() { generation++; boundary.abort(); boundary = new AbortController(); },
  });
}
function options(value: unknown, control = false): Record<string, unknown> {
  const { signal, ...r } = record(value, ['idempotencyKey', 'signal', ...(control ? ['expectedRevision'] : [])]);
  requestKey(r.idempotencyKey); if (signal !== undefined && !(signal instanceof AbortSignal)) throw invalid();
  if (control) integer(r.expectedRevision, 1); return r;
}
function readSignal(value: unknown): AbortSignal | undefined {
  const r = record(value ?? {}, ['signal']); if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw invalid(); return r.signal as AbortSignal | undefined;
}
function appointmentInput(value: unknown, create: boolean): Record<string, unknown> {
  const r = record(value, ['startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', ...(create ? ['resourceIds', 'title'] : [])]);
  const resourceIds = create ? ids(r.resourceIds) : undefined;
  if (create) identifier(r.title, 512);
  instant(r.startAt); instant(r.endAt);
  const duration = Date.parse(String(r.endAt)) - Date.parse(String(r.startAt));
  if (duration <= 0 || duration > 31 * 86400_000) throw invalid(); zone(r.timeZone);
  for (const key of ['bufferBeforeMinutes', 'bufferAfterMinutes']) if (!create || r[key] !== undefined) integer(r[key], 0, 1440);
  return { ...r, ...(resourceIds === undefined ? {} : { resourceIds }) };
}
function range(value: unknown): Record<string, unknown> {
  const r = record(value, ['resourceIds', 'startAt', 'endAt', 'limit']), resourceIds = ids(r.resourceIds, true);
  instant(r.startAt); instant(r.endAt); if (Date.parse(String(r.endAt)) <= Date.parse(String(r.startAt))) throw invalid();
  if (Date.parse(String(r.endAt)) - Date.parse(String(r.startAt)) > 31 * 86400_000) throw invalid();
  if (r.limit !== undefined) integer(r.limit, 1, 100); return { ...r, resourceIds };
}
function resourcePage(value: unknown): CalendarResourcePage {
  const r = record(value, ['items', 'truncated', 'nextAfter']);
  if (typeof r.truncated !== 'boolean') throw invalid();
  if (r.nextAfter !== null) requestKey(r.nextAfter);
  const items = values(r.items, 100).map(resourceView); unique(items.map(item => item.id));
  if (r.truncated !== (r.nextAfter !== null) || r.nextAfter !== null && items.at(-1)?.id !== r.nextAfter) throw invalid();
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated, nextAfter: r.nextAfter as string | null });
}
function resourceView(value: unknown): CalendarResourceView {
  const r = record(value, ['id', 'label', 'kind', 'ownerId', 'timeZone', 'revision', 'active']);
  if (Object.keys(r).length !== 7 || r.kind !== 'person' && r.kind !== 'room' && r.kind !== 'equipment' || typeof r.active !== 'boolean') throw invalid();
  requestKey(r.id); identifier(r.label, 256); if (r.ownerId !== null) requestKey(r.ownerId); zone(r.timeZone); integer(r.revision, 1);
  return Object.freeze(r) as unknown as CalendarResourceView;
}
function appointmentView(value: unknown): CalendarAppointmentView {
  const r = record(value, ['id', 'revision', 'resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'status', 'createdBy']);
  if (Object.keys(r).length !== 11 || r.status !== 'confirmed' && r.status !== 'cancelled') throw invalid();
  requestKey(r.id); integer(r.revision, 1); const resourceIds = ids(r.resourceIds); identifier(r.title, 512); requestKey(r.createdBy);
  instant(r.startAt); instant(r.endAt); if (Date.parse(String(r.endAt)) <= Date.parse(String(r.startAt))) throw invalid(); zone(r.timeZone);
  integer(r.bufferBeforeMinutes, 0, 1440); integer(r.bufferAfterMinutes, 0, 1440);
  return Object.freeze({ ...r, resourceIds: Object.freeze(resourceIds) }) as unknown as CalendarAppointmentView;
}
export function parseCalendarAppointmentPage(value: unknown): CalendarAppointmentPage { return appointmentPage(value); }
function appointmentPage(value: unknown): CalendarAppointmentPage {
  const r = record(value, ['items', 'truncated']);
  if (typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(appointmentView); unique(items.map(item => item.id));
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated });
}
function busyPage(value: unknown): CalendarBusyPage {
  const r = record(value, ['items', 'truncated']);
  if (typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(value => { const b = record(value, ['resourceId', 'startAt', 'endAt']);
    if (Object.keys(b).length !== 3) throw invalid(); requestKey(b.resourceId); instant(b.startAt); instant(b.endAt);
    if (Date.parse(String(b.endAt)) <= Date.parse(String(b.startAt))) throw invalid(); return Object.freeze(b); });
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated }) as unknown as CalendarBusyPage;
}
function calendarReceipt(value: unknown): CalendarCommandReceipt {
  const r = record(value, ['requestId', 'operation', 'id', 'revision', 'changed']);
  if (Object.keys(r).length !== 5 || typeof r.operation !== 'string' || !['resource.created', 'resource.grant-changed', 'appointment.created', 'appointment.rescheduled', 'appointment.cancelled'].includes(r.operation) || typeof r.changed !== 'boolean') throw invalid();
  requestKey(r.requestId); requestKey(r.id); integer(r.revision, 1); return Object.freeze(r) as unknown as CalendarCommandReceipt;
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !fields.includes(key) || !Object.hasOwn(descriptors[key]!, 'value')) throw invalid();
    Object.defineProperty(result, key, { value: descriptors[key]!.value, enumerable: true });
  } return result;
}
function identifier(value: unknown, max = 128): string { if (typeof value !== 'string' || !value || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw invalid(); return value; }
function requestKey(value: unknown): string { const key = identifier(value); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw invalid(); return key; }
function values(value: unknown, max: number, min = 0): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max) throw invalid();
  if (Reflect.ownKeys(value).length !== value.length + 1) throw invalid();
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index)); if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid(); return descriptor.value;
  });
}
function ids(value: unknown, empty = false): string[] { const accepted = values(value, 16, empty ? 0 : 1).map(id => requestKey(id)); unique(accepted); return accepted; }
function unique(value: readonly unknown[]): void { if (new Set(value).size !== value.length) throw invalid(); }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw invalid(); return Number(value); }
function instant(value: unknown): void { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid(); }
function zone(value: unknown): void { const accepted = identifier(value); if (/^[+-]/.test(accepted)) throw invalid(); try { new Intl.DateTimeFormat('en', { timeZone: accepted }); } catch { throw invalid(); } }
function invalid(): Error { return new Error('Invalid calendar request or acknowledgment.'); }
function retired(): DOMException { return new DOMException('Calendar authority scope changed.', 'AbortError'); }

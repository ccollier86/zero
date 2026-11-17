/** Browser-safe scoped calendar commands. The SDK retires this entire transport on every authority replacement. */
import type { CalendarAppointmentInput, CalendarAppointmentPage, CalendarAppointmentView, CalendarBusyPage, CalendarCommandReceipt,
  CalendarAvailabilityInput, CalendarAvailabilityView, CalendarAvailabilityWindow, CalendarBlockInput, CalendarBlockPage, CalendarBlockRescheduleInput, CalendarBlockView,
  CalendarHoldInput, CalendarHoldView, CalendarHoldPage, CalendarHoldConfirmationInput,
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
    operation: CalendarCommandReceipt['operation'], id?: string, forbiddenId?: string): Promise<CalendarCommandReceipt> {
    const key = requestKey(supplied.idempotencyKey); let dispatched = false;
    try { const receipt = calendarReceipt(await call(path, 'POST', body, supplied.signal, () => { dispatched = true; }));
      if (receipt.requestId !== key || receipt.operation !== operation || id !== undefined && receipt.id !== id
        || forbiddenId !== undefined && receipt.id === forbiddenId) throw invalid(); return receipt; }
    catch (error) { if (!dispatched) throw error; throw calendarMutationFailure(error, key); }
  }
  function watch<T>(path: string, parse: (value: unknown) => T, listener: (value: T, update?: CalendarWatchUpdate) => void,
    supplied: CalendarWatchOptions): () => void {
    const o = record(supplied, ['signal', 'onError']);
    if (!open || typeof listener !== 'function' || o.signal !== undefined && !(o.signal instanceof AbortSignal)
      || o.onError !== undefined && typeof o.onError !== 'function') throw invalid();
    const accepted: CalendarWatchOptions = { ...(o.signal === undefined ? {} : { signal: o.signal as AbortSignal }),
      ...(o.onError === undefined ? {} : { onError: o.onError as (error: unknown) => void }) };
    return watchCalendarRange(open, '/api/calendar' + path, boundary.signal, listener, parse, accepted);
  }
  function watchRange<T>(kind: 'appointments' | 'blocks' | 'holds', query: CalendarRangeQuery, parse: (value: unknown) => T,
    listener: (value: T, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions): () => void {
    const r = range(query), params = new URLSearchParams({ resourceIds: (r.resourceIds as string[]).join(','), startAt: String(r.startAt), endAt: String(r.endAt) });
    if (r.limit !== undefined) params.set('limit', String(r.limit));
    return watch('/' + kind + '/live?' + params, parse, listener, supplied);
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
    availability: Object.freeze({
      get(id: string, readOptions?: CalendarReadOptions) {
        const resourceId = requestKey(id);
        return read('/availability/' + encodeURIComponent(resourceId), value => {
          const accepted = availabilityView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      replace(id: string, input: CalendarAvailabilityInput, supplied: CalendarControlOptions) {
        return mutation('/availability/' + encodeURIComponent(requestKey(id)),
          { availability: availabilityInput(input), options: options(supplied, true) }, supplied, 'resource.availability-changed', id);
      },
      watch(id: string, listener: (availability: CalendarAvailabilityView, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        const resourceId = requestKey(id);
        return watch('/availability/' + encodeURIComponent(resourceId) + '/live', value => {
          const accepted = availabilityView(value); if (accepted.resourceId !== resourceId) throw invalid(); return accepted;
        }, listener, supplied);
      },
    }),
    blocks: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/blocks/query', blockPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/blocks/' + encodeURIComponent(targetId), value => {
          const accepted = blockView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      create(input: CalendarBlockInput, supplied: CalendarRequestOptions) {
        return mutation('/blocks', { block: blockInput(input, true), options: options(supplied) }, supplied, 'block.created');
      },
      reschedule(id: string, input: CalendarBlockRescheduleInput, supplied: CalendarControlOptions) {
        return mutation('/blocks/' + encodeURIComponent(requestKey(id)) + '/reschedule',
          { block: blockInput(input, false), options: options(supplied, true) }, supplied, 'block.rescheduled', id);
      },
      cancel(id: string, supplied: CalendarControlOptions) {
        return mutation('/blocks/' + encodeURIComponent(requestKey(id)) + '/cancel', { options: options(supplied, true) }, supplied, 'block.cancelled', id);
      },
      watch(query: CalendarRangeQuery, listener: (page: CalendarBlockPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watchRange('blocks', query, blockPage, listener, supplied);
      },
    }),
    holds: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/holds/query', holdPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/holds/' + encodeURIComponent(targetId), value => {
          const accepted = holdView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
      acquire(input: CalendarHoldInput, supplied: CalendarRequestOptions) {
        return mutation('/holds', { hold: holdInput(input), options: options(supplied) }, supplied, 'hold.acquired');
      },
      release(id: string, supplied: CalendarControlOptions) {
        return mutation('/holds/' + encodeURIComponent(requestKey(id)) + '/release',
          { options: options(supplied, true) }, supplied, 'hold.released', id);
      },
      confirm(id: string, input: CalendarHoldConfirmationInput, supplied: CalendarControlOptions) {
        const appointment = record(input, ['title']); identifier(appointment.title, 512);
        // The server creates a new appointment identity; the hold ID must never
        // be used as the expected appointment receipt identity.
        return mutation('/holds/' + encodeURIComponent(requestKey(id)) + '/confirm',
          { appointment, options: options(supplied, true) }, supplied, 'appointment.created', undefined, id);
      },
      watch(query: CalendarRangeQuery, listener: (page: CalendarHoldPage, update?: CalendarWatchUpdate) => void, supplied: CalendarWatchOptions = {}) {
        return watchRange('holds', query, holdPage, listener, supplied);
      },
    }),
    appointments: Object.freeze({
      query(supplied: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/appointments/query', appointmentPage, 'POST', { query: range(supplied) }, readSignal(readOptions)); },
      get(id: string, readOptions?: CalendarReadOptions) {
        const targetId = requestKey(id);
        return read('/appointments/' + encodeURIComponent(targetId), value => {
          const accepted = appointmentView(value); if (accepted.id !== targetId) throw invalid(); return accepted;
        }, 'GET', undefined, readSignal(readOptions));
      },
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
        return watchRange('appointments', query, appointmentPage, listener, supplied);
      },
    }),
    busy: Object.freeze({ query(query: CalendarRangeQuery, readOptions?: CalendarReadOptions) { return read('/busy/query', busyPage, 'POST', { query: range(query) }, readSignal(readOptions)); } }),
    receipts: Object.freeze({ get(key: string, readOptions?: CalendarReadOptions) {
      const requestId = requestKey(key);
      return read('/receipts/' + encodeURIComponent(requestId), value => {
        const r = record(value, ['receipt']); if (!Object.hasOwn(r, 'receipt')) throw invalid();
        if (r.receipt === null) return null;
        const accepted = calendarReceipt(r.receipt); if (accepted.requestId !== requestId) throw invalid(); return accepted;
      }, 'GET', undefined, readSignal(readOptions));
    } }),
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
function blockInput(value: unknown, create: boolean): Record<string, unknown> {
  const r = record(value, ['startAt', 'endAt', 'timeZone', ...(create ? ['resourceIds', 'title'] : [])]);
  const resourceIds = create ? ids(r.resourceIds) : undefined;
  if (create) identifier(r.title, 512);
  interval(r.startAt, r.endAt); zone(r.timeZone);
  return { ...r, ...(resourceIds === undefined ? {} : { resourceIds }) };
}
function holdInput(value: unknown): Record<string, unknown> {
  const r = record(value, ['resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes', 'ttlSeconds']);
  const resourceIds = ids(r.resourceIds);
  interval(r.startAt, r.endAt); zone(r.timeZone);
  for (const key of ['bufferBeforeMinutes', 'bufferAfterMinutes']) if (r[key] !== undefined) integer(r[key], 0, 1440);
  if (r.ttlSeconds !== undefined) integer(r.ttlSeconds, 1, 900);
  return { ...r, resourceIds };
}
function availabilityInput(value: unknown): CalendarAvailabilityInput {
  const r = record(value, ['mode', 'windows']);
  if (Object.keys(r).length !== 2 || r.mode !== 'unrestricted' && r.mode !== 'windows') throw invalid();
  const windows = availabilityWindows(r.windows);
  if (r.mode === 'unrestricted' && windows.length !== 0) throw invalid();
  return Object.freeze({ mode: r.mode, windows });
}
function availabilityWindows(value: unknown, response = false): readonly CalendarAvailabilityWindow[] {
  const windows = values(value, 100).map(value => {
    const r = record(value, ['startAt', 'endAt']);
    if (Object.keys(r).length !== 2) throw invalid();
    instant(r.startAt); instant(r.endAt); if (Date.parse(String(r.startAt)) >= Date.parse(String(r.endAt))) throw invalid();
    return Object.freeze({ startAt: r.startAt as string, endAt: r.endAt as string });
  });
  if (response) for (let index = 1; index < windows.length; index++) {
    if (Date.parse(windows[index - 1]!.endAt) >= Date.parse(windows[index]!.startAt)) throw invalid();
  }
  return Object.freeze(windows);
}
function availabilityView(value: unknown): CalendarAvailabilityView {
  const r = record(value, ['resourceId', 'resourceRevision', 'timeZone', 'mode', 'windows']);
  if (Object.keys(r).length !== 5) throw invalid();
  requestKey(r.resourceId); integer(r.resourceRevision, 1); zone(r.timeZone);
  if (r.mode !== 'unrestricted' && r.mode !== 'windows') throw invalid();
  const windows = availabilityWindows(r.windows, true);
  if (r.mode === 'unrestricted' && windows.length) throw invalid();
  return Object.freeze({ ...r, windows }) as unknown as CalendarAvailabilityView;
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
function blockView(value: unknown): CalendarBlockView {
  const r = record(value, ['id', 'revision', 'resourceIds', 'title', 'startAt', 'endAt', 'timeZone', 'status', 'createdBy']);
  if (Object.keys(r).length !== 9 || r.status !== 'active' && r.status !== 'cancelled') throw invalid();
  requestKey(r.id); integer(r.revision, 1); const resourceIds = ids(r.resourceIds); identifier(r.title, 512); requestKey(r.createdBy);
  interval(r.startAt, r.endAt); zone(r.timeZone);
  return Object.freeze({ ...r, resourceIds: Object.freeze(resourceIds) }) as unknown as CalendarBlockView;
}
function blockPage(value: unknown): CalendarBlockPage {
  const r = record(value, ['items', 'truncated']);
  if (Object.keys(r).length !== 2 || typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(blockView); unique(items.map(item => item.id));
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated });
}
function holdView(value: unknown): CalendarHoldView {
  const r = record(value, ['id', 'revision', 'resourceIds', 'startAt', 'endAt', 'timeZone', 'bufferBeforeMinutes', 'bufferAfterMinutes',
    'status', 'expiresAt', 'createdBy', 'appointmentId']);
  if (Object.keys(r).length !== 12 || !['held', 'expired', 'released', 'confirmed'].includes(r.status as string)) throw invalid();
  requestKey(r.id); integer(r.revision, 1); const resourceIds = ids(r.resourceIds); requestKey(r.createdBy);
  interval(r.startAt, r.endAt); instant(r.expiresAt); zone(r.timeZone);
  integer(r.bufferBeforeMinutes, 0, 1440); integer(r.bufferAfterMinutes, 0, 1440);
  if (Date.parse(String(r.expiresAt)) > Date.parse(String(r.startAt))) throw invalid();
  if (r.status === 'confirmed') requestKey(r.appointmentId);
  else if (r.appointmentId !== null) throw invalid();
  return Object.freeze({ ...r, resourceIds: Object.freeze(resourceIds) }) as unknown as CalendarHoldView;
}
function holdPage(value: unknown): CalendarHoldPage {
  const r = record(value, ['items', 'truncated']);
  if (Object.keys(r).length !== 2 || typeof r.truncated !== 'boolean') throw invalid();
  const items = values(r.items, 100).map(holdView); unique(items.map(item => item.id));
  if (items.some(item => item.status !== 'held')) throw invalid();
  return Object.freeze({ items: Object.freeze(items), truncated: r.truncated });
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
  if (Object.keys(r).length !== 5 || typeof r.operation !== 'string' || !['resource.created', 'resource.grant-changed', 'resource.availability-changed',
    'block.created', 'block.rescheduled', 'block.cancelled', 'hold.acquired', 'hold.released',
    'appointment.created', 'appointment.rescheduled', 'appointment.cancelled'].includes(r.operation) || typeof r.changed !== 'boolean') throw invalid();
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
function interval(startAt: unknown, endAt: unknown): void {
  instant(startAt); instant(endAt);
  const duration = Date.parse(String(endAt)) - Date.parse(String(startAt));
  if (duration <= 0 || duration > 31 * 86400_000) throw invalid();
}
function zone(value: unknown): void { const accepted = identifier(value); if (/^[+-]/.test(accepted)) throw invalid(); try { new Intl.DateTimeFormat('en', { timeZone: accepted }); } catch { throw invalid(); } }
function invalid(): Error { return new Error('Invalid calendar request or acknowledgment.'); }
function retired(): DOMException { return new DOMException('Calendar authority scope changed.', 'AbortError'); }

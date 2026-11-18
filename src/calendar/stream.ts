/** One coalesced authorized page under backpressure. No permanent streams or raw change payloads. */
import type { CalendarAppointmentTypePageQuery, CalendarLocationPageQuery, CalendarRangeQuery, CalendarResourcePageQuery, CalendarReadOptions, CalendarVisitLocationQuery, CalendarWatchOptions, CalendarWatchUpdate, ScopedCalendar } from './contracts';
export function calendarVisitLocationStream(calendar: ScopedCalendar, query: CalendarVisitLocationQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.locations.forVisit(query, options),
    watch: (listener, options) => calendar.locations.watchForVisit(query, listener, options) }, signal);
}
export function calendarLifecycleStream(calendar: ScopedCalendar, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.lifecycle.get(options),
    watch: (listener, options) => calendar.lifecycle.watch(listener, options) }, signal);
}
export function calendarAppointmentTransitionsStream(calendar: ScopedCalendar, id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.appointments.transitions(id, options),
    watch: (listener, options) => calendar.appointments.watchTransitions(id, listener, options) }, signal);
}
export function calendarTypeStream(calendar: ScopedCalendar, query: CalendarAppointmentTypePageQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.types.list(query, options),
    watch: (listener, options) => calendar.types.watch(query, listener, options) }, signal);
}
export function calendarTypeDetailStream(calendar: ScopedCalendar, id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.types.get(id, options),
    watch: (listener, options) => calendar.types.watchType(id, listener, options) }, signal);
}
export function calendarResourceTypesStream(calendar: ScopedCalendar, id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.types.forResource(id, options),
    watch: (listener, options) => calendar.types.watchForResource(id, listener, options) }, signal);
}
export function calendarResourceStream(calendar: ScopedCalendar, query: CalendarResourcePageQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.resources.list(query, options),
    watch: (listener, options) => calendar.resources.watch(query, listener, options) }, signal);
}
export function calendarLocationStream(calendar: ScopedCalendar, query: CalendarLocationPageQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.locations.list(query, options),
    watch: (listener, options) => calendar.locations.watch(query, listener, options) }, signal);
}
export function calendarLocationDetailStream(calendar: ScopedCalendar, id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.locations.get(id, options),
    watch: (listener, options) => calendar.locations.watchLocation(id, listener, options) }, signal);
}
export function calendarResourceLocationsStream(calendar: ScopedCalendar, id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.locations.forResource(id, options),
    watch: (listener, options) => calendar.locations.watchForResource(id, listener, options) }, signal);
}
export function calendarAppointmentStream(calendar: ScopedCalendar, query: CalendarRangeQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.appointments.query(query, options),
    watch: (listener, options) => calendar.appointments.watch(query, listener, options) }, signal);
}
export function calendarBlockStream(calendar: ScopedCalendar, query: CalendarRangeQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.blocks.query(query, options),
    watch: (listener, options) => calendar.blocks.watch(query, listener, options) }, signal);
}
export function calendarHoldStream(calendar: ScopedCalendar, query: CalendarRangeQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.holds.query(query, options),
    watch: (listener, options) => calendar.holds.watch(query, listener, options) }, signal);
}
export function calendarAvailabilityStream(calendar: ScopedCalendar, id: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return calendarSnapshotStream({ read: options => calendar.availability.get(id, options),
    watch: (listener, options) => calendar.availability.watch(id, listener, options) }, signal);
}
/** Trusted fixed-operation closures only; deferred publication always performs another current-authority read. */
function calendarSnapshotStream<T>(source: {
  read(options: CalendarReadOptions): Promise<T>;
  watch(listener: (value: T, update?: CalendarWatchUpdate) => void, options: CalendarWatchOptions): () => void;
}, signal: AbortSignal): ReadableStream<Uint8Array> {
  const stop = new AbortController(), operationSignal = AbortSignal.any([signal, stop.signal]);
  let controller: ReadableStreamDefaultController<Uint8Array>, closed = false;
  // Do not retain a private page for a later pull: publication may happen after revocation.
  let dirty = false, invalidated = false, reading = false;
  let remove: (() => void) | undefined, lifetime: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    if (closed) return; closed = true; dirty = false; stop.abort();
    try { remove?.(); } finally { clearTimeout(lifetime); signal.removeEventListener('abort', close); }
  };
  const close = () => { if (!closed) { cleanup(); controller.close(); } };
  const publish = (value: T) => {
    const frame = { value, invalidated }; invalidated = false;
    controller.enqueue(new TextEncoder().encode('event: snapshot\ndata: ' + JSON.stringify({ version: 1, ...frame }) + '\n\n'));
  };
  const denied = () => {
    if (closed) return;
    dirty = false;
    controller.enqueue(new TextEncoder().encode('event: invalidated\ndata: {"version":1,"error":true}\n\n')); close();
  };
  const flush = async () => {
    if (closed || !dirty || reading || (controller.desiredSize ?? 0) <= 0) return;
    reading = true;
    try {
      while (!closed && dirty && (controller.desiredSize ?? 0) > 0) {
        dirty = false;
        const page = await source.read({ signal: operationSignal });
        if (closed) return;
        // A commit arrived during the wait; query again instead of publishing an older accepted page.
        if (!dirty) publish(page);
      }
    } catch { denied(); }
    finally { reading = false; }
  };
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      if (signal.aborted) { close(); return; }
      signal.addEventListener('abort', close, { once: true });
      try {
        remove = source.watch((page, update) => {
          if (closed) return;
          invalidated ||= update?.invalidated === true;
          if (!reading && (controller.desiredSize ?? 0) > 0) { dirty = false; publish(page); }
          else dirty = true;
        }, { signal: operationSignal, onError: denied });
        if (closed) { remove(); return; }
      } catch (error) { cleanup(); controller.error(error); return; }
      lifetime = setTimeout(close, 20_000); lifetime.unref?.();
    }, pull() { return flush(); }, cancel() { cleanup(); },
  }, { highWaterMark: 1 });
}

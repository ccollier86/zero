/** One coalesced authorized page under backpressure. No permanent streams or raw change payloads. */
import type { CalendarAppointmentPage, CalendarRangeQuery, ScopedCalendar } from './contracts';
export function calendarAppointmentStream(calendar: ScopedCalendar, query: CalendarRangeQuery, signal: AbortSignal): ReadableStream<Uint8Array> {
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
  const publish = (value: CalendarAppointmentPage) => {
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
        const page = await calendar.appointments.query(query, { signal: operationSignal });
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
        remove = calendar.appointments.watch(query, (page, update) => {
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

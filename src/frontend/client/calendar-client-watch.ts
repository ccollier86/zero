/** Authoritative bounded range snapshots. Reconnects reads only; denial stops and withdraws the last projection. */
import type { CalendarAppointmentPage, CalendarWatchOptions, CalendarWatchUpdate } from '../../calendar/contracts';
import { CalendarReadError } from './calendar-mutation';
export function watchCalendarRange(open: (path: string, init: RequestInit) => Promise<Response>, path: string, boundary: AbortSignal,
  listener: (page: CalendarAppointmentPage, update?: CalendarWatchUpdate) => void,
  parse: (value: unknown) => CalendarAppointmentPage, options: CalendarWatchOptions): () => void {
  const owner = new AbortController(), signal = AbortSignal.any([owner.signal, boundary, ...(options.signal ? [options.signal] : [])]);
  let retry: ReturnType<typeof setTimeout> | undefined, published = false;
  const stop = () => { clearTimeout(retry); signal.removeEventListener('abort', stop); owner.abort(); };
  async function consume() {
    const connection = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, denied = false, failed = false, first = true;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    try {
      const response = await open(path, { signal: connection });
      if (connection.aborted) { await response.body?.cancel(); return; }
      denied = [401, 403, 404, 428].includes(response.status);
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel(); throw new Error('Calendar subscription unavailable.');
      }
      reader = response.body.getReader(); connection.addEventListener('abort', cancel, { once: true });
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
      for (;;) {
        const chunk = await reader.read(); connection.throwIfAborted(); if (chunk.done) break;
        if (chunk.value.byteLength > 1024 * 1024) { denied = true; throw new Error('Invalid calendar projection.'); }
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 1024 * 1024) { denied = true; throw new Error('Invalid calendar projection.'); }
        for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          let page: CalendarAppointmentPage, invalidated = false;
          try {
            const value = JSON.parse(data);
            if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.error
              || Object.keys(value).some(key => !['version', 'value', 'invalidated'].includes(key))
              || Object.hasOwn(value, 'invalidated') && typeof value.invalidated !== 'boolean') throw new Error();
            page = parse(value.value); invalidated = value.invalidated === true;
          } catch { denied = true; throw new Error('Calendar subscription must be reauthorized.'); }
          if (!signal.aborted) {
            listener(page, Object.freeze({ invalidated, ...(first && published ? { reconnected: true } : {}) }));
            first = false; published = true;
          }
        }
      }
    } catch {
      failed = true;
      if (!signal.aborted) try { options.onError?.(new CalendarReadError(null, null, true)); } catch { /* Observer only. */ }
    } finally {
      connection.removeEventListener('abort', cancel); await reader?.cancel().catch(() => {});
      try { reader?.releaseLock(); } catch { /* Already retired. */ }
      if (!signal.aborted && !denied && !failed) retry = setTimeout(() => { void consume(); }, 250); else stop();
    }
  }
  signal.addEventListener('abort', stop, { once: true }); if (!signal.aborted) void consume(); return stop;
}

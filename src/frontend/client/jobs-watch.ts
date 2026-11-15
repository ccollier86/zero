/** Reconnecting read-only projection transport. Never retries a job/control mutation or publishes across a retired scope. */
import type { JobSchedulePage, JobWatchOptions, JobWatchUpdate } from '../../jobs/contracts';
export function watchJobsPage(open: (path: string, init: RequestInit) => Promise<Response>, path: string, boundary: AbortSignal,
  listener: (page: JobSchedulePage, update?: JobWatchUpdate) => void, parse: (value: unknown) => JobSchedulePage, options: JobWatchOptions): () => void {
  const owner = new AbortController(), signal = AbortSignal.any([owner.signal, boundary, ...(options.signal ? [options.signal] : [])]);
  let retry: ReturnType<typeof setTimeout> | undefined;
  const consume = async () => {
    const connection = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, failed = false, denied = false;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    try {
      const response = await open(path, { signal: connection });
      if (connection.aborted) { await response.body?.cancel(); return; }
      denied = [401, 403, 404, 428].includes(response.status);
      if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel(); throw new Error('The jobs subscription could not be authorized.');
      }
      reader = response.body.getReader(); connection.addEventListener('abort', cancel, { once: true });
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
      for (;;) {
        const chunk = await reader.read(); connection.throwIfAborted(); if (chunk.done) break;
        if (chunk.value.byteLength > 256 * 1024) throw new Error('Invalid jobs projection.');
        buffer += decoder.decode(chunk.value, { stream: true });
        if (buffer.length > 256 * 1024) throw new Error('Invalid jobs projection.');
        for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!data) continue;
          const value = JSON.parse(data);
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.error
            || Object.keys(value).some(key => !['version', 'value', 'invalidated'].includes(key))
            || Object.hasOwn(value, 'invalidated') && typeof value.invalidated !== 'boolean') {
            denied = true; throw new Error('The jobs subscription must be reauthorized.');
          }
          // Older servers omit this field. Never expose the wire envelope or
          // arbitrary metadata to callers, including malformed denied frames.
          const update: JobWatchUpdate = Object.freeze({ invalidated: value.invalidated === true });
          const page = parse(value.value); if (!signal.aborted) listener(page, update);
        }
      }
    } catch (error) { failed = true; if (!signal.aborted) try { options.onError?.(error); } catch { /* Observer only. */ } }
    finally {
      connection.removeEventListener('abort', cancel); await reader?.cancel().catch(() => {});
      try { reader?.releaseLock(); } catch { /* Reader already retired. */ }
      if (!signal.aborted && !denied) retry = setTimeout(() => { void consume(); }, failed ? 3000 : 250);
      else stop();
    }
  };
  const stop = () => { clearTimeout(retry); signal.removeEventListener('abort', stop); owner.abort(); };
  signal.addEventListener('abort', stop, { once: true });
  if (!signal.aborted) void consume(); return stop;
}

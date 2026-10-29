/** Final release fences for protected HTTP streams. Producer completion never claims network or human receipt. */
import type { LoggingRuntime } from '../../logging/logging-runtime';

export function guardLoggingResponseStream(response: Response, request: Request, logging: LoggingRuntime,
  revalidate: () => Promise<void>, assertCurrent: () => void, diagnostic: (complete: boolean) => void): Response {
  if (!response.body) return response;
  const reader = response.body.getReader(); let closed = false, remove = () => {};
  const release = () => { try { reader.releaseLock(); } catch { /* Preserve the substantive stream outcome. */ } };
  const cancel = async () => { try { await reader.cancel(); } catch { /* Interruption is separately recorded. */ } finally { release(); } };
  const cleanup = () => { remove(); request.signal.removeEventListener('abort', abort); };
  const terminal = async (complete: boolean) => {
    if (closed) return; closed = true; cleanup();
    diagnostic(complete);
  };
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const abort = () => {
    if (closed) return;
    void cancel(); void terminal(false).catch(() => {});
    // A client disconnect/owner stop is cancellation, not an unhandled server
    // producer rejection. No further bytes are released; interruption is
    // diagnosed above. Failed authority fences still error in pull().
    try { controller.close(); } catch { /* Already stopped. */ }
  };
  try {
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
        remove = logging.subscribe('audit', () => {}, abort);
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
      },
      async pull(value) {
        if (closed) return;
        try {
          await revalidate(); assertCurrent();
          const chunk = await reader.read();
          await revalidate(); assertCurrent();
          if (closed) return;
          if (chunk.done) { release(); await terminal(true); await revalidate(); assertCurrent(); value.close(); }
          else value.enqueue(chunk.value);
        } catch (error) {
          await cancel(); await terminal(false).catch(() => {});
          try { value.error(error); } catch { /* Already retired by abort. */ }
        }
      },
      async cancel() { await cancel(); await terminal(false).catch(() => {}); },
    }, { highWaterMark: 0 });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { cleanup(); void cancel(); throw error; }
}

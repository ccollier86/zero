/** Bounded native SSE reader with owned cancellation. GET reconnects never resend a message or invent delivery/read receipts. */
import type { MessagingWatchOptions } from '../../messaging/client-contracts';
export function watchMessagingProjection<T>(open: (path: string, signal: AbortSignal) => Promise<Response>, path: string, boundary: AbortSignal,
  listener: (value: T) => void, validate: (value: unknown) => void, options: MessagingWatchOptions<unknown>): () => void {
  const owner = new AbortController(), signal = AbortSignal.any([owner.signal, boundary, ...(options.signal ? [options.signal] : [])]); let retry: ReturnType<typeof setTimeout> | undefined;
  const status = (value: Parameters<NonNullable<typeof options.onConnection>>[0]) => { try { options.onConnection?.(value); } catch { /* Observer only. */ } };
  const consume = async () => {
    if (signal.aborted) return;
    const connection = AbortSignal.any([signal, AbortSignal.timeout(30000)]); let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, failed = false;
    const cancel = () => { void reader?.cancel().catch(() => {}); };
    try {
      const response = await open(path, connection); if (connection.aborted) { await response.body?.cancel(); return; }
      if (!response.ok || !response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new Error('Messaging live access is unavailable.'); }
      reader = response.body.getReader(); connection.addEventListener('abort', cancel, { once: true });
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
      for (;;) {
        const chunk = await reader.read(); connection.throwIfAborted(); if (chunk.done) break;
        if (chunk.value.byteLength > 640 * 1024) throw new Error('Messaging snapshot exceeds its byte budget.');
        buffer += decoder.decode(chunk.value, { stream: true }); if (buffer.length > 640 * 1024) throw new Error('Messaging snapshot exceeds its byte budget.');
        for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (!data) continue;
          const envelope = JSON.parse(data);
          if (envelope.version !== 1 || envelope.error) throw new Error('Messaging access must be revalidated.');
          validate(envelope.value); if (!signal.aborted) { status('connected'); listener(envelope.value); }
        }
      }
    } catch (error) { failed = true; if (!signal.aborted) { status('unavailable'); try { options.onError?.(error); } catch { /* Observer only. */ } } }
    finally {
      connection.removeEventListener('abort', cancel); await reader?.cancel().catch(() => {}); try { reader?.releaseLock(); } catch { /* Retired reader. */ }
      if (!signal.aborted) retry = setTimeout(() => { status('reconnecting'); void consume(); }, failed ? 3000 : 250);
    }
  };
  const aborted = () => { clearTimeout(retry); if (!owner.signal.aborted) status('unavailable'); };
  signal.addEventListener('abort', aborted, { once: true }); status('connecting'); void consume();
  return () => { owner.abort(); clearTimeout(retry); signal.removeEventListener('abort', aborted); };
}

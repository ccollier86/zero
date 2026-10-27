/** Bounded native SSE reader with owned cancellation. GET reconnects never resend a message or invent delivery/read receipts. */
import type { MessagingWatchOptions } from '../../messaging/client-contracts';
import { MessagingLiveError, messagingLiveHttpFailure } from '../../messaging/live-error';
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
      if (!response.ok) { await response.body?.cancel(); throw messagingLiveHttpFailure(response.status); }
      if (!response.body || !response.headers.get('Content-Type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false); }
      reader = response.body.getReader(); connection.addEventListener('abort', cancel, { once: true });
      const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
      for (;;) {
        const chunk = await reader.read(); connection.throwIfAborted(); if (chunk.done) break;
        // Network chunks may contain several valid snapshots. Bound each
        // packet while decoding slices, not the transport's arbitrary chunk.
        for (let offset = 0; offset < chunk.value.byteLength; offset += 64 * 1024) {
          try { buffer += decoder.decode(chunk.value.subarray(offset, offset + 64 * 1024), { stream: true }); }
          catch { throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false); }
          buffer = buffer.replace(/\r\n/g, '\n');
          for (let end; (end = buffer.indexOf('\n\n')) >= 0;) {
            if (end > 640 * 1024) throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false);
            const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); if (!data) continue;
            let envelope: any;
            try { envelope = JSON.parse(data); if (!envelope || envelope.version !== 1) throw new Error(); }
            catch { throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false); }
            if (envelope.error) {
              if (envelope.error === true) throw new MessagingLiveError('MESSAGING_LIVE_INVALIDATED', false);
              const code = envelope.error.status;
              if (!Number.isInteger(code) || code < 400 || code > 599) throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false);
              throw messagingLiveHttpFailure(code);
            }
            try { validate(envelope.value); } catch { throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false); }
            if (!signal.aborted) { status('connected'); try { listener(envelope.value); } catch { throw new MessagingLiveError('MESSAGING_LIVE_OBSERVER', false); } }
          }
          if (buffer.length > 640 * 1024) throw new MessagingLiveError('MESSAGING_LIVE_PROTOCOL', false);
        }
      }
    } catch (error) { failed = true; if (!signal.aborted) {
      const code = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined;
      const failure = error instanceof MessagingLiveError ? error : code === undefined
        ? new MessagingLiveError('MESSAGING_LIVE_UNAVAILABLE', true) : messagingLiveHttpFailure(code);
      status('unavailable'); try { options.onError?.(failure); } catch { /* Observer only. */ }
      if (!failure.retryable) owner.abort();
    } }
    finally {
      connection.removeEventListener('abort', cancel); await reader?.cancel().catch(() => {}); try { reader?.releaseLock(); } catch { /* Retired reader. */ }
      if (!signal.aborted) retry = setTimeout(() => { status('reconnecting'); void consume(); }, failed ? 3000 : 250);
    }
  };
  const aborted = () => { clearTimeout(retry); if (!owner.signal.aborted) status('unavailable'); };
  signal.addEventListener('abort', aborted, { once: true }); status('connecting'); void consume();
  return () => { owner.abort(); clearTimeout(retry); signal.removeEventListener('abort', aborted); };
}

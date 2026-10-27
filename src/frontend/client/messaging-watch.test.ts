import { expect, test } from 'bun:test';
import { watchMessagingProjection } from './messaging-watch';
import { MessagingLiveError } from '../../messaging/live-error';

const frame = (value: unknown, ending = '\n') => `event: snapshot${ending}data: ${JSON.stringify({ version: 1, value })}${ending}${ending}`;
function response(chunks: readonly Uint8Array[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
test('real stream reader handles fragmented UTF-8/CRLF, coalesced large packets, and stops callbacks at retirement', async () => {
  const text = frame('First café', '\r\n') + frame('x'.repeat(350000)) + frame('y'.repeat(350000)), bytes = new TextEncoder().encode(text);
  const boundary = new AbortController(), seen: string[] = [], failures: unknown[] = [];
  const done = Promise.withResolvers<void>();
  const stop = watchMessagingProjection(async () => response([bytes.subarray(0, 20), bytes.subarray(20, 21), bytes.subarray(21)]), '/synthetic', boundary.signal, (value: string) => {
    seen.push(value); if (seen.length === 3) { boundary.abort(); done.resolve(); }
  }, value => { if (typeof value !== 'string') throw new Error(); }, { onError: error => failures.push(error) });
  try { await done.promise; expect(seen.map(value => value.length)).toEqual([10, 350000, 350000]); expect(seen[0]).toBe('First café'); expect(failures).toEqual([]); }
  finally { stop(); }
});
test('explicit denial and malformed or invalidated frames fail closed, sanitize errors and never auto-retry', async () => {
  const bytes = (value: string) => new TextEncoder().encode(value);
  for (const open of [
    async () => new Response('NEVER_EXPOSE_BODY', { status: 403 }),
    async () => { throw { status: 404, message: 'NEVER_EXPOSE_BODY' }; },
    async () => response([bytes('data: {"version":1,"error":true}\n\n')]),
    async () => response([bytes('data: {"version":1,"error":{"status":409}}\n\n')]),
    async () => response([bytes('data: {"version":1,"error":{"status":999}}\n\n')]),
    async () => response([bytes('data: NOT_JSON_NEVER_EXPOSE_BODY\n\n')]),
  ]) {
    let attempts = 0, callbacks = 0; const failure = Promise.withResolvers<MessagingLiveError>();
    const stop = watchMessagingProjection(async () => { attempts++; return open(); }, '/synthetic', new AbortController().signal,
      () => { callbacks++; }, () => {}, { onError: error => failure.resolve(error as MessagingLiveError) });
    try { const error = await failure.promise; expect(error).toBeInstanceOf(MessagingLiveError); expect(error.retryable).toBe(false);
      expect(error.message).not.toContain('NEVER_EXPOSE_BODY'); await Bun.sleep(10); expect(attempts).toBe(1); expect(callbacks).toBe(0); }
    finally { stop(); }
  }
});
test('temporary transport errors remain retryable but observer bugs do not create reconnect loops', async () => {
  for (const observer of [false, true]) {
    const failure = Promise.withResolvers<MessagingLiveError>();
    const stop = watchMessagingProjection(async () => { if (!observer) throw new Error('NEVER_EXPOSE_BODY'); return response([new TextEncoder().encode(frame('ok'))]); }, '/synthetic', new AbortController().signal,
      () => { throw new Error('NEVER_EXPOSE_BODY'); }, () => {}, { onError: error => failure.resolve(error as MessagingLiveError) });
    try { const error = await failure.promise; expect(error.retryable).toBe(!observer); expect(error.message).not.toContain('NEVER_EXPOSE_BODY'); } finally { stop(); }
  }
});

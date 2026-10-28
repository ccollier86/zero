/** Synthetic cookie transport only; never a real capability, identity or provider. */
import { expect, test } from 'bun:test';
import { createSupportChatClient } from './visitor-client';

const metadata = () => ({ sessionId: 'session-one', userId: 'visitor-one', conversationId: 'chat-one', csrf: 'a'.repeat(64), expiresAt: Date.now() + 60000 });
const transport = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch =>
  Object.assign(handler, { preconnect: fetch.preconnect });

test('one throwing retirement observer cannot retain other views or permit another request', async () => {
  let calls = 0, notified = 0;
  const client = await createSupportChatClient('website', { resumeOnly: true,
    transport: transport(async () => { calls++; return Response.json(metadata()); }) });
  client.subscribe(() => { throw new Error('Synthetic consumer failure'); });
  client.subscribe(() => { notified++; });
  expect(() => client.clear()).not.toThrow();
  expect(client.active).toBe(false); expect(notified).toBe(1);
  client.clear(); expect(notified).toBe(1);
  await expect(client.typing.set('tab-one', null)).rejects.toMatchObject({ name: 'AbortError' });
  expect(calls).toBe(1);
});

test('retirement cancels an already received but unfinished typing response body', async () => {
  let started!: () => void; const reading = new Promise<void>(resolve => { started = resolve; });
  let cancelled = false;
  const client = await createSupportChatClient('website', { resumeOnly: true,
    transport: transport(async input => {
      if (String(input).endsWith('/session')) return Response.json(metadata());
      return new Response(new ReadableStream<Uint8Array>({ pull() { started(); }, cancel() { cancelled = true; } }));
    }) });
  const pending = client.typing.set('tab-one', 'typing');
  await reading; client.clear();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled).toBe(true);
});

test('explicit end preserves exact request identity and retires only after confirmed success', async () => {
  const requests: RequestInit[] = [];
  const client = await createSupportChatClient('website', { resumeOnly: true,
    transport: transport(async (_input, init) => {
      requests.push(init!); return Response.json(init?.method === 'DELETE' ? { ended: true } : metadata());
    }) });
  await expect(client.end({ requestId: '' })).rejects.toThrow('stable'); expect(requests).toHaveLength(1);
  await client.end({ requestId: 'end-one' });
  const headers = new Headers(requests[1].headers);
  expect(headers.get('Idempotency-Key')).toBe('end-one'); expect(headers.get('X-Zero-Support-CSRF')).toBe('a'.repeat(64));
  expect(headers.get('X-Zero-Support-Session')).toBe('session-one'); expect(headers.get('X-Zero-Support-Client')).toBe('1');
  expect(requests[1].credentials).toBe('same-origin'); expect(requests[1].cache).toBe('no-store');
  expect(requests[1].signal).toBeInstanceOf(AbortSignal); expect(client.active).toBe(false);
});

test('an aborted bootstrap never creates a client even when a custom transport returns a success', async () => {
  const controller = new AbortController();
  const client = createSupportChatClient('website', { resumeOnly: true, signal: controller.signal,
    transport: transport(async () => { controller.abort(); return Response.json(metadata()); }) });
  await expect(client).rejects.toMatchObject({ name: 'AbortError' });
});

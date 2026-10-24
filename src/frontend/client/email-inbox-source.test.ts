import { expect, test } from 'bun:test';
import { createEmailInboxSource } from './email-inbox-source';

test('email SDK fences late JSON and binary completion after its authorization scope is cleared', async () => {
  let release!: (value: any) => void;
  const source = createEmailInboxSource(async () => await new Promise(resolve => { release = resolve; }));
  const accounts = source.accounts(); source.clear(); release([{ id: 'old-account' }]);
  await expect(accounts).rejects.toMatchObject({ name: 'AbortError' });
  let body!: ReadableStreamDefaultController<Uint8Array>;
  const binary = createEmailInboxSource(async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { body = controller; } })) as any);
  const download = binary.attachment('mail', { folder: 'INBOX', uidValidity: '123', uid: 1 }, '0');
  await Bun.sleep(0); binary.clear(); body.enqueue(new TextEncoder().encode('old private bytes')); body.close();
  await expect(download).rejects.toMatchObject({ name: 'AbortError' });
});
test('email SDK preserves typed failures and classifies a lost send response as uncertain, not safe to retry', async () => {
  const network = createEmailInboxSource(async () => { throw new Error('Network disconnected'); });
  await expect(network.send('mail', {} as any)).rejects.toMatchObject({ code: 'EMAIL_SEND_OUTCOME_UNKNOWN', outcome: 'unknown' });
  const conflict = createEmailInboxSource(async () => { throw { body: { code: 'EMAIL_DRAFT_CONFLICT', error: 'Draft changed' } }; });
  await expect(conflict.saveDraft('mail', {} as any)).rejects.toMatchObject({ code: 'EMAIL_DRAFT_CONFLICT', outcome: 'none' });
});
test('clearing the SDK retires an idle live stream through its owned abort signal', async () => {
  let closed = false;
  const source = createEmailInboxSource(async (_path, options) => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"connected"}\n\n')); options?.signal?.addEventListener('abort', () => { closed = true; controller.close(); }, { once: true }); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }) as any);
  const stream = source.watch('mail', 'INBOX')[Symbol.asyncIterator](); expect((await stream.next()).value).toEqual({ type: 'connected' });
  const pending = stream.next(); source.clear(); expect((await pending).done).toBe(true); expect(closed).toBe(true);
});

test('generic server and post-commit authorization failures never become safe new send attempts', async () => {
  for (const code of ['AUTH_FORBIDDEN', 'EMAIL_INBOX_FAILED', 'EMAIL_SEND_OUTCOME_UNKNOWN']) {
    const source = createEmailInboxSource(async () => { throw { body: { code, error: 'Synthetic failure' } }; });
    await expect(source.send('mail', {} as any)).rejects.toMatchObject({ code: 'EMAIL_SEND_OUTCOME_UNKNOWN', outcome: 'unknown' });
  }
});

test('live parsing handles split CRLF and aborts an idle custom response even if fetch ignores cancellation', async () => {
  let cancelled = false; const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    for (const chunk of ['data:{"type":"connected"}\r', '\n\r', '\n']) controller.enqueue(encoder.encode(chunk));
  }, cancel() { cancelled = true; } });
  const source = createEmailInboxSource(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) as any);
  const iterator = source.watch('mail', 'INBOX')[Symbol.asyncIterator](); expect((await iterator.next()).value).toEqual({ type: 'connected' });
  const pending = iterator.next(); source.clear(); expect((await pending).done).toBe(true); expect(cancelled).toBe(true);
});

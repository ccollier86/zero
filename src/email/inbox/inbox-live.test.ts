import { expect, test } from 'bun:test';
import { EmailInboxLive } from './inbox-live';
import type { EmailInboxServerAccount } from './server-types';

test('one provider watch fans out to subscribers, bounds backlog and stops after the final owner leaves', async () => {
  let watches = 0, closed = 0;
  const mailbox = { async *watch({ signal }: { signal: AbortSignal }) {
    watches++;
    try { await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', () => resolve(), { once: true }); }); }
    finally { closed++; }
  } } as unknown as EmailInboxServerAccount['mailbox'];
  const account: EmailInboxServerAccount = { id: 'test', label: 'Test', address: 'mail@example.test', mailbox };
  const live = new EmailInboxLive(), a = new AbortController(), b = new AbortController();
  const first = live.watch(account, 'INBOX', a.signal)[Symbol.asyncIterator](), second = live.watch(account, 'INBOX', b.signal)[Symbol.asyncIterator]();
  try {
    expect((await first.next()).value).toEqual({ type: 'connected' }); expect((await second.next()).value).toEqual({ type: 'connected' }); expect(watches).toBe(1);
    for (let index = 0; index < 1000; index++) live.notify(mailbox);
    expect((await first.next()).value).toEqual({ type: 'connected' });
    a.abort(); expect((await first.next()).done).toBe(true); expect(closed).toBe(0);
    // No further generator pull is needed to release the provider after abort.
    b.abort(); await Bun.sleep(0); expect(closed).toBe(1); expect((await second.next()).done).toBe(true);
  } finally { a.abort(); b.abort(); live.close(); await first.return?.(); await second.return?.(); }
});
test('a provider that ends without throwing still releases blocked listeners for reconnection', async () => {
  let finish!: () => void;
  const mailbox = { async *watch() { await new Promise<void>(resolve => { finish = resolve; }); } } as unknown as EmailInboxServerAccount['mailbox'];
  const live = new EmailInboxLive(), abort = new AbortController(), account = { id: 'test', label: 'Test', address: 'mail@example.test', mailbox };
  const stream = live.watch(account, 'INBOX', abort.signal)[Symbol.asyncIterator]();
  try { await stream.next(); for (let index = 0; index < 128; index++) live.notify(mailbox);
    finish(); await Bun.sleep(0); await expect(stream.next()).rejects.toThrow('disconnected');
    const second = live.watch(account, 'INBOX', abort.signal)[Symbol.asyncIterator](); expect((await second.next()).value).toEqual({ type: 'connected' }); finish(); await second.return?.(); }
  finally { abort.abort(); live.close(); await stream.return?.(); }
});

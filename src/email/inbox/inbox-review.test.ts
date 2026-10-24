/** Review regressions use disposable state and synthetic providers only. */
import { expect, test } from 'bun:test';
import type { ZeroLifecycleContext } from '../../frontend/server/server-extensions';
import type { EmailRuntime } from '../types';
import type { EmailInboxServerAccount } from './server-types';
import { EmailInboxService } from './inbox-service';
import { emptyEmailCompose } from './contracts';
import { emailInboxEvents } from './inbox-stream';

function fixture() {
  let allowed = true, sends = 0;
  const mailbox = Object.fromEntries(['folders', 'browse', 'read', 'setFlags', 'move', 'watch'].map(key => [key, async () => []])) as unknown as EmailInboxServerAccount['mailbox'];
  const sender = { async send() { sends++; return { provider: 'fixture', accepted: ['receiver@example.test'] }; } };
  const account: EmailInboxServerAccount = { id: 'owned', label: 'Synthetic inbox', address: 'sender@example.test', mailbox, sender, sendAs: [{ id: 'from', address: 'sender@example.test' }] };
  const service = new EmailInboxService({ statePath: ':memory:', accounts: () => allowed ? [account] : [] }, {} as EmailRuntime);
  // Real Guardian/resolver enforcement is exercised by the managed integration suite.
  service.authority = () => ({ owner: 'synthetic-owner', check() {} });
  const context = { request: new Request('https://fixture.test') } as ZeroLifecycleContext;
  const input = { operationId: 'synthetic-operation', value: { ...emptyEmailCompose('from'), to: ['receiver@example.test'], subject: 'Original subject', text: 'Synthetic message' } };
  return { service, account, context, input, sender, get sends() { return sends; }, revoke() { allowed = false; }, allow() { allowed = true; } };
}

test('an accepted send remains recoverable after resolver revocation without presenting a safe retry', async () => {
  const value = fixture(), send = value.sender.send;
  value.sender.send = async () => { const result = await send(); value.revoke(); return result; };
  try {
    await expect(value.service.send(value.context, 'owned', value.input)).rejects.toMatchObject({ code: 'EMAIL_SEND_OUTCOME_UNKNOWN', status: 403 });
    value.allow(); expect((await value.service.send(value.context, 'owned', value.input)).status).toBe('accepted'); expect(value.sends).toBe(1);
  } finally { await value.service.close(); }
});

test('receipt storage failure after acceptance always reports an uncertain send outcome', async () => {
  const value = fixture(), finish = value.service.store.finishSend;
  value.service.store.finishSend = () => { throw new Error('Synthetic disk failure'); };
  try { await expect(value.service.send(value.context, 'owned', value.input)).rejects.toMatchObject({ code: 'EMAIL_SEND_OUTCOME_UNKNOWN' }); expect(value.sends).toBe(1); }
  finally { value.service.store.finishSend = finish; await value.service.close(); }
});

test('managed shutdown waits for the accepted send receipt before closing its state database', async () => {
  const value = fixture(); let begin!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { begin = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  value.sender.send = async () => { begin(); await gate; return { provider: 'fixture', accepted: ['receiver@example.test'] }; };
  const pending = value.service.perform(() => value.service.send(value.context, 'owned', value.input));
  await started; let closed = false; const closing = value.service.close().then(() => { closed = true; });
  try {
    await Bun.sleep(0); expect(closed).toBe(false);
    await expect(value.service.perform(async () => {})).rejects.toMatchObject({ code: 'EMAIL_INBOX_UNAVAILABLE' });
    release(); expect((await pending).status).toBe('accepted'); await closing; expect(closed).toBe(true);
  } finally { release(); await closing; }
});

test('asynchronous account resolution cannot mutate the captured outgoing message', async () => {
  const value = fixture(); let captured = '';
  const send = value.sender.send; value.sender.send = async (message?: any) => { captured = message.subject; return send(); };
  try {
    const pending = value.service.send(value.context, 'owned', value.input); value.input.value.subject = 'Changed later';
    await pending; expect(captured).toBe('Original subject');
  } finally { await value.service.close(); }
});

test('provider idempotency keys are scoped by the durable owner and never expose raw owner IDs', async () => {
  const a = fixture(), b = fixture(), keys: string[] = [];
  b.service.authority = () => ({ owner: 'a-different-owner', check() {} });
  for (const value of [a, b]) value.sender.send = async (message?: any) => { keys.push(message.idempotencyKey); return { provider: 'fixture', accepted: ['receiver@example.test'] }; };
  try {
    await a.service.send(a.context, 'owned', a.input); await b.service.send(b.context, 'owned', b.input);
    expect(keys[0]).not.toBe(keys[1]); expect(keys.every(key => /^zero-inbox-[a-f0-9]{64}$/.test(key))).toBe(true);
  } finally { await a.service.close(); await b.service.close(); }
});

test('inbox SSE only pulls bounded frames and releases a paused producer on cancellation', async () => {
  let produced = 0, released = false; const stop = new AbortController(), account = {};
  const service = {
    signal: stop.signal, authority: () => ({ check() {} }), account: async () => account,
    live: { async *watch() { try { while (true) { produced++; yield { type: 'connected' }; } } finally { released = true; } } },
  } as unknown as EmailInboxService;
  const response = await emailInboxEvents(service, { request: new Request('https://fixture.test') } as ZeroLifecycleContext, 'owned', 'INBOX');
  await Bun.sleep(5); expect(produced).toBeLessThanOrEqual(1);
  const reader = response.body!.getReader(); await reader.read(); await Bun.sleep(5); expect(produced).toBeLessThanOrEqual(2);
  await reader.cancel(); await Bun.sleep(0); expect(released).toBe(true);
});

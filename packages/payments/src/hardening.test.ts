import { expect, test } from 'bun:test';
import { ReactiveDB } from '@zero/framework/sync';
import { StripePayments } from './service';
import { authority, customer, fixtureOptions, signedEvent, StripeFixture, subscription } from './payments-fixture';
import { readWebhookBody } from './http';

test('request shutdown drains an accepted command before its database can be disposed', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture();
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient });
  let release: (() => void) | undefined, entered: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  stripe.handle = async r => { if (r.path === '/v1/billing_portal/sessions') { entered!(); await new Promise<void>(resolve => { release = resolve; }); } return undefined; };
  service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
  try {
    const request = service.forAuthority(authority()).portal.create({ operationId: 'draining-operation' }); await ready;
    let stopped = false; const stop = service.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); release!(); await request; await stop;
    expect(db.prepare("SELECT status FROM _zero_payments_commands WHERE id='user:draining-operation'").get()).toEqual({ status: 'complete' });
  } finally { release?.(); await service.stop(); db.dispose(); }
});
test('canonical event callbacks cannot fulfill an old paid snapshot when Stripe says unpaid', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture(); const calls: unknown[] = [];
  stripe.handle = r => r.path === '/v1/checkout/sessions/cs_test_fixture' ? Response.json({ id: 'cs_test_fixture', customer: customer.id, livemode: false, payment_status: 'unpaid', status: 'open' }) : undefined;
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient, onEvent: async event => { calls.push(event); } });
  try {
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    const event = signedEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_fixture', object: 'checkout.session', customer: customer.id, payment_status: 'paid' } } });
    await service.acceptWebhook(event.payload, event.signature); await service.drain();
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ eventId: 'evt_fixture', resource: { paymentStatus: 'unpaid' } });
  } finally { await service.stop(); db.dispose(); }
});
test('stale resource owners cannot commit views, refresh jobs coalesce, and policy changes withhold grants', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture(); const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient });
  const subject = { kind: 'user' as const, id: 'user-fixture' };
  try {
    service.store.bind(subject, customer.id); const view = await service.forAuthority(authority()).reconcile();
    const old = service.store.lock('customer:cus_fixture')!; db.prepare('UPDATE _zero_payments_locks SET lease=0').run(); const fresh = service.store.lock('customer:cus_fixture')!;
    expect(() => service.store.writeView(subject, view, old)).toThrow('lost its resource fence'); service.store.release(old); expect(() => service.store.renew(fresh)).not.toThrow(); service.store.release(fresh);
    db.prepare('UPDATE _zero_payments_views SET next_refresh=0').run(); service.store.queueRefreshes(10000); service.store.queueRefreshes(10000); expect(service.store.pending().pending).toBe(1);
    const changed = new StripePayments(db, { ...fixtureOptions, policyVersion: 'v2', httpClient: stripe.httpClient });
    expect(changed.snapshot(subject).entitlements).toEqual({}); await changed.stop();
    stripe.sub = subscription({ items: { object: 'list', has_more: false, data: [{ id: 'si_expired', quantity: 1, price: { id: 'price_pro' }, current_period_end: 1 }] } });
    expect((await service.forAuthority(authority()).reconcile()).entitlements).toEqual({});
  } finally { await service.stop(); db.dispose(); }
});
test('raw webhook bounds apply with or without a content length', async () => {
  await expect(readWebhookBody(new Request('https://fixture.test', { method: 'POST', body: 'abcdef' }), 5)).rejects.toMatchObject({ code: 'PAYMENTS_WEBHOOK_TOO_LARGE' });
  await expect(readWebhookBody(new Request('https://fixture.test', { method: 'POST', headers: { 'Content-Length': '999999' }, body: 'a' }), 5)).rejects.toMatchObject({ code: 'PAYMENTS_WEBHOOK_TOO_LARGE' });
  expect(await readWebhookBody(new Request('https://fixture.test', { method: 'POST', body: '  {"x": 1}\n' }))).toBe('  {"x": 1}\n');
  expect(await readWebhookBody(new Request('https://fixture.test', { method: 'POST', body: '\uFEFF{}' }))).toBe('\uFEFF{}');
});
test('provider calls never hold SQLite transactions and callback timeouts remain retry work', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture(); let aborted = false;
  stripe.handle = () => { expect(db.getRawDatabase().inTransaction).toBe(false); return undefined; };
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient, callbackTimeoutMs: 100, onChange: async (_event, { signal }) => { await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true })); } });
  try {
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id); await service.forAuthority(authority()).reconcile(); await service.drain();
    expect(aborted).toBe(true); expect(service.store.pending().pending).toBe(1);
    expect(db.prepare("SELECT error FROM _zero_payments_inbox WHERE kind='notify'").get()).toEqual({ error: 'PAYMENTS_CALLBACK_TIMEOUT' });
  } finally { await service.stop(); db.dispose(); }
});
test('refund events resolve their customer through the canonical payment rather than being dropped', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture(); const calls: unknown[] = [];
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient, onEvent: async event => { calls.push(event); } });
  try {
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    const event = signedEvent({ type: 'refund.created', data: { object: { id: 're_fixture', object: 'refund', payment_intent: 'pi_fixture' } } });
    await service.acceptWebhook(event.payload, event.signature); await service.drain();
    expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ resource: { id: 're_fixture', kind: 'refund', total: { amount: 500 } } }); expect(service.store.pending().pending).toBe(0);
  } finally { await service.stop(); db.dispose(); }
});
test('lost refund response replays the original parameters even after the balance is refunded', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture();
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient });
  const subject = { kind: 'user' as const, id: 'admin' }, scoped = service.forAuthority(authority('admin', 'admin'));
  let fail = true;
  const enqueue = service.enqueue.bind(service); service.enqueue = value => { if (fail) { fail = false; throw new Error('Synthetic lost local response'); } enqueue(value); };
  stripe.handle = r => {
    if (r.path === '/v1/refunds' && r.method === 'POST') {
      stripe.pay = { ...stripe.pay, latest_charge: { id: 'ch_fixture', amount_refunded: 1900 } };
      return Response.json({ id: 're_replayed', payment_intent: 'pi_fixture', amount: 1900, currency: 'usd', status: 'succeeded', created: 12345 });
    }
    return undefined;
  };
  try {
    service.store.bind(subject, customer.id); const input = { operationId: 'lost-refund-result', paymentId: 'pi_fixture', amount: 1900 };
    await expect(scoped.refunds.create(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await scoped.operations.read(input.operationId))?.status).toBe('unknown');
    expect((await scoped.refunds.create(input)).id).toBe('re_replayed');
    const posts = stripe.requests.filter(r => r.path === '/v1/refunds' && r.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[0]!.key).toBe(posts[1]!.key); expect(posts[0]!.data.toString()).toBe(posts[1]!.data.toString());
    await expect(scoped.refunds.create({ ...input, operationId: 'new-refund-rejected' })).rejects.toMatchObject({ code: 'PAYMENTS_REFUND_INVALID' });
    expect((await scoped.operations.read(input.operationId))?.status).toBe('complete'); expect(await service.forAuthority(authority('other')).operations.read(input.operationId)).toBeNull();
  } finally { await service.stop(); db.dispose(); }
});
test('lost subscription update reuses the original item parameters after the subscription changes', async () => {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture();
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient });
  let fail = true; const original = stripe.sub;
  const enqueue = service.enqueue.bind(service); service.enqueue = value => { if (fail) { fail = false; throw new Error('Synthetic lost local response'); } enqueue(value); };
  stripe.handle = r => {
    if (r.path === '/v1/subscriptions/sub_fixture' && r.method === 'POST') {
      stripe.sub = subscription({ status: 'canceled', items: { data: [{ id: 'si_new', quantity: 1, price: { id: 'price_pro' }, current_period_end: 1 }] } });
      return Response.json(original);
    }
    return undefined;
  };
  try {
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    const scoped = service.forAuthority(authority()), input = { operationId: 'lost-subscription-result', subscriptionId: 'sub_fixture', offer: 'pro', quantity: 2, proration: 'none' as const, paymentBehavior: 'error_if_incomplete' as const };
    await expect(scoped.subscriptions.change(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    await scoped.subscriptions.change(input);
    const posts = stripe.requests.filter(r => r.path === '/v1/subscriptions/sub_fixture' && r.method === 'POST'); expect(posts).toHaveLength(2); expect(posts[0]!.key).toBe(posts[1]!.key); expect(posts[0]!.data.toString()).toBe(posts[1]!.data.toString()); expect(posts[1]!.data.get('items[0][id]')).toBe('si_fixture');
  } finally { await service.stop(); db.dispose(); }
});

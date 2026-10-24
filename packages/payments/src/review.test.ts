/** Adversarial review regressions; all HTTP is synthetic and all storage is disposable. */
import { afterEach, expect, test } from 'bun:test';
import { ReactiveDB } from '@zero/framework/sync';
import type { BillingSnapshot, ScopedPayments } from '@zero/framework/payments';
import { StripePayments } from './service';
import { fixtureOptions, StripeFixture, authority, customer, signedEvent, subscription, list } from './payments-fixture';
import { paymentEvents } from './http';
import { resolvePaymentsOptions } from './options';
import type { PlatformCodeDefinition, PlatformCodeEmitOptions } from '@zero/framework/observability';

const owned: { service: StripePayments; db: ReactiveDB }[] = [];
function fixture(input: Partial<typeof fixtureOptions> = {}, emitCode?: (code: PlatformCodeDefinition, options?: PlatformCodeEmitOptions) => void) {
  const db = new ReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture();
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient, ...input }, { emitCode });
  owned.push({ service, db }); return { db, stripe, service, scoped: service.forAuthority(authority()) };
}
afterEach(async () => { for (const item of owned.splice(0)) { await item.service.stop(); item.db.dispose(); } });

test('a lost command lease or replay deadline prevents the physical provider write', async () => {
  for (const column of ['lease', 'created']) {
    const { service, stripe, db, scoped } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    stripe.handle = r => { if (r.path === '/v1/prices/price_pro') db.prepare(`UPDATE _zero_payments_commands SET ${column}=0`).run(); return undefined; };
    await expect(scoped.checkout.create({ operationId: `stale-${column}-operation`, offer: 'pro' })).rejects.toMatchObject({ code: 'PAYMENTS_LEASE_LOST', outcome: 'unknown' });
    expect(stripe.requests.filter(r => r.path === '/v1/checkout/sessions')).toHaveLength(0);
  }
});
test('SDK automatic retries revalidate Guardian before another physical request', async () => {
  const { service, stripe } = fixture({ maxNetworkRetries: 1 }), auth = authority();
  service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
  stripe.handle = r => {
    if (r.path === '/v1/billing_portal/sessions') { auth.revoke(); return Response.json({ error: { type: 'api_error', message: 'Synthetic ambiguous server response' } }, { status: 500, headers: { 'Stripe-Should-Retry': 'true' } }); }
    return undefined;
  };
  await expect(service.forAuthority(auth).portal.create({ operationId: 'guarded-sdk-retry' })).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN', outcome: 'unknown' });
  expect(stripe.requests.filter(r => r.path === '/v1/billing_portal/sessions')).toHaveLength(1);
});
test('mutable caller input cannot change the financial intent after its reservation', async () => {
  const { service, stripe, scoped } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
  const input = { operationId: 'captured-input-operation', subscriptionId: 'sub_fixture', offer: 'pro', quantity: 2, proration: 'none' as const, paymentBehavior: 'error_if_incomplete' as const };
  const pending = scoped.subscriptions.change(input); input.quantity = 19; await pending;
  expect(stripe.requests.find(r => r.path === '/v1/subscriptions/sub_fixture' && r.method === 'POST')!.data.get('items[0][quantity]')).toBe('2');
  await expect(scoped.subscriptions.change(input)).rejects.toMatchObject({ code: 'PAYMENTS_COMMAND_CONFLICT' });
});
test('temporary provider permissions do not permanently poison customer creation', async () => {
  const { stripe, scoped, service } = fixture(); let fail = true;
  stripe.handle = r => r.path === '/v1/customers' && fail ? Response.json({ error: { type: 'invalid_request_error', message: 'Synthetic restricted key failure' } }, { status: 403 }) : undefined;
  await expect(scoped.customers.ensure({ operationId: 'retry-permissions' })).rejects.toMatchObject({ code: 'PAYMENTS_PROVIDER_UNAVAILABLE', retryable: true, outcome: 'none' });
  expect((await scoped.operations.read('retry-permissions'))?.status).toBe('retryable');
  fail = false; expect((await scoped.customers.ensure({ operationId: 'retry-permissions' })).id).toBe(customer.id); expect(stripe.customerCount).toBe(1);
});
test('completed receipts remain readable after sales are paused or catalog aliases change', async () => {
  const { service, stripe, scoped, db } = fixture(); const input = { operationId: 'receipt-across-config', offer: 'pro' };
  const receipt = await scoped.checkout.create(input);
  const updated = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient, acceptingSales: false, catalog: {} });
  try { expect(await updated.forAuthority(authority()).checkout.create(input)).toEqual(receipt); }
  finally { await updated.stop(); }
  expect(stripe.requests.filter(r => r.path === '/v1/checkout/sessions')).toHaveLength(1);
});
test('read failures never claim that a payment outcome is unknown', async () => {
  const { scoped, stripe } = fixture(); stripe.handle = r => r.path.startsWith('/v1/prices/') ? Response.json({ error: { type: 'api_error', message: 'Synthetic outage' } }, { status: 500 }) : undefined;
  await expect(scoped.catalog()).rejects.toMatchObject({ code: 'PAYMENTS_READ_UNAVAILABLE', status: 503, outcome: 'none' });
});
test('a receipt-store failure after provider acceptance still reports an unknown financial outcome', async () => {
  const { scoped, service } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
  const finish = service.store.finish; service.store.finish = () => { throw new Error('Synthetic disk failure'); };
  try { await expect(scoped.portal.create({ operationId: 'lost-durable-receipt' })).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN', outcome: 'unknown' }); }
  finally { service.store.finish = finish; }
});
test('changing only webhook delivery bookkeeping does not create a duplicate conflict', async () => {
  const { service } = fixture();
  const a = signedEvent({ pending_webhooks: 3 }), b = signedEvent({ pending_webhooks: 1 });
  await service.acceptWebhook(a.payload, a.signature); await service.acceptWebhook(b.payload, b.signature);
  expect(service.store.pending().pending).toBe(1);
  const hostile = signedEvent({ data: { object: subscription({ customer: 'cus_other' }) } });
  await expect(service.acceptWebhook(hostile.payload, hostile.signature)).rejects.toMatchObject({ code: 'PAYMENTS_EVENT_CONFLICT' });
});
test('reconciliation exhausts nested subscription item pages instead of publishing a partial view', async () => {
  const { service, stripe, scoped } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
  stripe.sub = subscription({ items: { has_more: true, data: [] } });
  const item = { id: 'si_later', object: 'subscription_item', subscription: 'sub_fixture', quantity: 1, price: { id: 'price_pro' }, current_period_end: Math.floor(Date.now() / 1000) + 3600 };
  stripe.handle = r => r.path === '/v1/subscription_items' ? Response.json(list([item])) : undefined;
  const snapshot = await scoped.reconcile(); expect(snapshot.entitlements.search).toBe(true); expect(snapshot.subscriptions[0]!.offers).toEqual(['pro']); expect(snapshot).not.toHaveProperty('_grants');
});
test('one expired trial cannot revoke an independent annual subscription or retain its own grants', async () => {
  const { service, scoped } = fixture(); const subject = { kind: 'user' as const, id: 'user-fixture' }; service.store.bind(subject, customer.id);
  await scoped.reconcile(); const lock = service.store.lock(`customer:${customer.id}`)!;
  service.store.writeView(subject, { ...service.store.view(subject)!, _grants: [{ feature: 'trialOnly', value: true, expiresAt: 1 }, { feature: 'annual', value: true, expiresAt: Date.now() / 1000 + 3600 }] }, lock); service.store.release(lock);
  const snapshot = await scoped.snapshot(); expect(snapshot.stale).toBe(false); expect(snapshot.entitlements).toEqual({ annual: true }); expect(snapshot).not.toHaveProperty('_grants');
});
test('time-dependent grant expiry changes the stream version without needing a database write', async () => {
  const { service, scoped } = fixture(); const subject = { kind: 'user' as const, id: 'user-fixture' }; service.store.bind(subject, customer.id); await scoped.reconcile();
  const lock = service.store.lock(`customer:${customer.id}`)!;
  service.store.writeView(subject, { ...service.store.view(subject)!, _grants: [{ feature: 'expiring', value: true, expiresAt: Date.now() / 1000 + 0.05 }] }, lock); service.store.release(lock);
  const abort = new AbortController(), stream = scoped.watch({ signal: abort.signal })[Symbol.asyncIterator]();
  try { const before = (await stream.next()).value!; const after = (await stream.next()).value!; expect(after.revision).toBe(before.revision); expect(after.version).not.toBe(before.version); expect((await scoped.snapshot()).entitlements).toEqual({}); }
  finally { abort.abort(); await stream.return?.(); }
});
test('slow event stream readers do not accumulate an unbounded producer queue', async () => {
  let produced = 0, released = false;
  const payments = { snapshot: async () => ({}) as BillingSnapshot, async *watch() { try { while (true) yield { revision: ++produced }; } finally { released = true; } } } as unknown as ScopedPayments;
  const response = await paymentEvents(payments, new Request('https://fixture.test'));
  await Bun.sleep(10); expect(produced).toBeLessThanOrEqual(1);
  const reader = response.body!.getReader(); await reader.read(); await Bun.sleep(5); expect(produced).toBeLessThanOrEqual(2); await reader.cancel(); await Bun.sleep(1); expect(released).toBe(true);
});
test('operator job inspection is bounded/redacted and diagnostics never include callback secrets', async () => {
  const diagnostics: unknown[] = [];
  const { service } = fixture({ onChange: async () => { throw new Error('DO-NOT-LOG-THIS-SECRET'); } }, (code, options) => { diagnostics.push({ code: code.code, ...options }); });
  service.store.admit('view-private-job', 'notify', JSON.stringify({ subject: { kind: 'user', id: 'u' }, snapshot: {} }));
  await service.drain();
  const jobs = service.jobs.list({ status: 'retry', limit: 1 }); expect(jobs.items).toHaveLength(1); expect(jobs.items[0]).not.toHaveProperty('payload'); expect(jobs.items[0]!.error).toBe('PAYMENTS_PROCESSING_FAILED');
  expect(JSON.stringify(diagnostics)).toContain('payments.job.retry'); expect(JSON.stringify(diagnostics)).not.toContain('DO-NOT-LOG-THIS-SECRET');
  expect(service.jobs.retry('view-private-job')).toBe(true); expect(service.jobs.retry('missing-job')).toBe(false); expect(() => service.jobs.list({ limit: 1001 })).toThrow('Invalid billing job query');
});
test('background integrations do not inherit a completed financial command execution context', async () => {
  let service: StripePayments, deliveries = 0;
  const value = fixture({ onChange: async () => { await service.native.billingPortal.sessions.create({ customer: customer.id, return_url: fixtureOptions.portalReturnUrl }, { idempotencyKey: 'independent-server-integration' }); deliveries++; } }); service = value.service;
  await value.scoped.customers.ensure({ operationId: 'customer-then-background' });
  for (let i = 0; i < 100 && !deliveries; i++) await Bun.sleep(2);
  expect(deliveries).toBe(1); expect(value.stripe.requests.filter(r => r.path === '/v1/billing_portal/sessions')).toHaveLength(1);
});
test('invalid configuration switches fail before installing tables or opening provider operations', () => {
  for (const input of [{ subject: 'typo' }, { acceptingSales: 'false' }, { allowEphemeralTestMode: 'false' }, { onChange: true }, { access: { typo: 'user' } }, { basePath: '//wrong/path' }]) expect(() => resolvePaymentsOptions({ ...fixtureOptions, ...input } as never)).toThrow();
});

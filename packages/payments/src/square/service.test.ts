/** Real SDK wire contracts, scope isolation, canonical webhook reconciliation and subjectless merchant charges against a synthetic provider only. */
import { expect, test } from 'bun:test';
import { authority, squareFixture, squareOptions } from './square-fixture';
import { dayBoundary } from './models';
import { resolveSquareOptions } from './options';
import { getPayments, getSquarePayments } from '../index';
import { PaymentsError } from '../errors';

test('Square uses the existing facade and admits an explicit merchant/location/environment only', async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority());
    expect(scoped.status().provider).toBe('square'); expect(scoped.status().capabilities?.subscriptionPreview).toBe(false);
    expect((await scoped.catalog()).map(value => value.id)).toEqual(['pro', 'plus', 'credit']);
    expect(getPayments({ payments: f.service })).toBe(f.service); expect(getSquarePayments({ payments: f.service })).toBe(f.service);
    expect(() => getPayments({ payments: scoped } as never)).toThrow();
    expect(f.fixture.requests.every(request => request.headers.get('square-version') === '2026-09-16')).toBe(true);
    f.fixture.locationId = 'WRONG_LOCATION';
    const other = squareFixture(); other.fixture.merchantId = 'WRONG_MERCHANT';
    try { await expect(other.service.forAuthority(authority()).catalog()).rejects.toMatchObject({ code: 'PAYMENTS_MERCHANT_MISMATCH' }); } finally { await other.close(); }
  } finally { await f.close(); }
});
test('custom merchant charges need no catalog, product or user and replay exactly once', async () => {
  const f = squareFixture({ catalog: {} });
  try {
    const input = { operationId: 'custom-charge-1', total: { amount: 1234, currency: 'USD' }, description: 'Manual service', paymentToken: 'cnon:card-nonce-ok', reference: 'external-invoice-42' };
    const charged = await f.service.charges.create(input);
    expect(charged).toMatchObject({ status: 'succeeded', total: { amount: 1234, currency: 'usd' } });
    expect(await f.service.charges.create(input)).toEqual(charged);
    expect(f.fixture.requests.filter(request => request.path === '/v2/payments' && request.method === 'POST')).toHaveLength(1);
    expect(f.fixture.customers.size).toBe(0); expect(f.fixture.requests.some(request => request.path.startsWith('/v2/catalog'))).toBe(false);
    await expect(f.service.charges.create({ ...input, total: { amount: 1235, currency: 'usd' } })).rejects.toMatchObject({ code: 'PAYMENTS_COMMAND_CONFLICT' });
    expect((await f.service.charges.read(charged.id)).id).toBe(charged.id);
    expect(await f.service.charges.clientAction(charged.id)).toBeNull();
  } finally { await f.close(); }
});
test('custom hosted checkout is subjectless and only canonical payment proves completion', async () => {
  const f = squareFixture({ catalog: {} });
  try {
    const checkout = await f.service.charges.checkout({ operationId: 'custom-checkout-1', total: { amount: 899, currency: 'usd' }, description: 'One-off purchase' });
    expect(checkout.url).toContain('sandbox.square.link'); expect(f.fixture.customers.size).toBe(0);
    expect((await f.service.charges.readCheckout(checkout.id)).paymentStatus).toBe('unpaid');
    const completed = f.fixture.complete(checkout.id);
    expect((await f.service.charges.readCheckout(checkout.id)).paymentStatus).toBe('paid');
    expect((await f.service.charges.read(completed.paymentId)).total.amount).toBe(899);
  } finally { await f.close(); }
});
test('Square buyer profiles cannot reassign Zero customer/tenant ownership', async () => {
  const events: string[] = [], f = squareFixture({ onEvent: async event => { events.push(event.eventId); } });
  try {
    const alice = f.service.forAuthority(authority('alice')), bob = f.service.forAuthority(authority('bob'));
    const checkout = await alice.checkout.create({ operationId: 'alice-checkout', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    const webhook = f.fixture.event('invoice.payment_made', completed.invoiceId!);
    await f.service.acceptWebhook(webhook.payload, webhook.signature); await f.service.drain();
    const snapshot = await alice.snapshot();
    expect(snapshot.customer?.id).toBe('CUSTOMER_1'); expect(f.service.store.owner('BUYER_SQUARE_CUSTOMER')).toBeNull();
    expect(snapshot.entitlements).toEqual({ search: true, seats: 20 }); expect(snapshot.subscriptions[0]?.id).toBe(completed.subId!);
    expect((await alice.invoices.read(completed.invoiceId!)).paid).toBe(true);
    await expect(bob.invoices.read(completed.invoiceId!)).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
    await expect(bob.checkout.read(checkout.id)).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
    await expect(bob.refunds.list({ paymentId: completed.paymentId })).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
    expect(events).toEqual([JSON.parse(webhook.payload).event_id]);
    expect((await alice.invoices.document(completed.invoiceId!)).pdfUrl).toBeNull();
  } finally { await f.close(); }
});
test('duplicate and out-of-order webhooks use current canonical state, not raw snapshot claims', async () => {
  let calls = 0; const f = squareFixture({ onEvent: async () => { calls++; } });
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'checkout-ordering', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    const event = f.fixture.event('subscription.created', completed.subId!);
    await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain(); expect(calls).toBe(1);
    expect((await scoped.entitlements.read()).search).toBe(true);
    f.fixture.subscriptions.get(completed.subId!).status = 'CANCELED';
    const older = f.fixture.event('subscription.updated', completed.subId!, 'event-older'); await f.service.acceptWebhook(older.payload, older.signature); await f.service.drain();
    expect(await scoped.entitlements.read()).toEqual({}); expect(calls).toBe(2);
  } finally { await f.close(); }
});
test('Square refunds use bounded provider keys and preserve the same operation receipt', async () => {
  const f = squareFixture();
  try {
    const charge = await f.service.charges.create({ operationId: 'charge-to-refund', total: { amount: 1000, currency: 'usd' }, description: 'Custom amount', paymentToken: 'cnon:card-nonce-ok' });
    const input = { operationId: 'refund-operation', paymentId: charge.id, amount: 250 };
    expect((await f.service.charges.refund(input)).total.amount).toBe(250); await f.service.charges.refund(input);
    expect(f.fixture.requests.filter(request => request.path === '/v2/refunds' && request.method === 'POST')).toHaveLength(1);
    expect(f.fixture.requests.find(request => request.path === '/v2/refunds')!.body.idempotency_key.length).toBe(45);
    expect((await f.service.charges.read(charge.id)).refunded).toBe(250);
  } finally { await f.close(); }
});
test('signature verification binds the exact configured public URL, raw bytes and merchant', async () => {
  const f = squareFixture();
  try {
    const event = f.fixture.event('payment.updated', 'PAYMENT_NONE');
    await expect(f.service.acceptWebhook(event.payload + ' ', event.signature)).rejects.toMatchObject({ code: 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID' });
    await expect(f.service.acceptWebhook(event.payload, 'bad')).rejects.toMatchObject({ code: 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID' });
    const other = squareFixture({ webhookNotificationUrl: 'https://evil.example.test/api/webhooks/square' });
    try { await expect(other.service.acceptWebhook(event.payload, event.signature)).rejects.toMatchObject({ code: 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID' }); } finally { await other.close(); }
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM _zero_payments_inbox').get()).toEqual({ n: 0 });
  } finally { await f.close(); }
});
test('paid grants require the latest paid invoice and expire on the actual provider time zone boundary', async () => {
  expect(dayBoundary('2026-11-01', 'America/New_York')).toBe(Date.parse('2026-11-01T04:00:00Z') / 1000);
  expect(dayBoundary('2026-11-01', 'America/New_York', true)).toBe(Date.parse('2026-11-02T05:00:00Z') / 1000);
  expect(dayBoundary('2026-02-30', 'UTC')).toBeNull();
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'checkout-unpaid', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    f.fixture.invoices.get(completed.invoiceId!).status = 'UNPAID';
    const event = f.fixture.event('subscription.created', completed.subId!); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect(await scoped.entitlements.read()).toEqual({});
  } finally { await f.close(); }
});
test('input bounds, unsupported semantics and live authority fail before financial provider writes', async () => {
  const f = squareFixture();
  try {
    const auth = authority(), scoped = f.service.forAuthority(auth);
    await expect(f.service.charges.create({ operationId: 'invalid-card-data', total: { amount: 10, currency: 'usd' }, description: 'Unsafe', paymentToken: '4111111111111111' })).rejects.toBeDefined();
    await expect(f.service.charges.checkout({ operationId: 'fractional-amount', total: { amount: 1.5, currency: 'usd' }, description: 'Unsafe' })).rejects.toBeDefined();
    await expect(scoped.subscriptions.preview({ subscriptionId: 'SUB_1', offer: 'pro', proration: 'none' })).rejects.toMatchObject({ code: 'PAYMENTS_CAPABILITY_UNSUPPORTED' });
    await expect(scoped.portal.create({ operationId: 'unsupported-portal' })).rejects.toMatchObject({ code: 'PAYMENTS_CAPABILITY_UNSUPPORTED' });
    auth.revoke(); expect(() => scoped.status()).toThrow();
    await expect(scoped.checkout.create({ operationId: 'revoked-checkout', offer: 'pro' })).rejects.toBeDefined();
    expect(f.fixture.requests.filter(request => request.path === '/v2/online-checkout/payment-links')).toHaveLength(0);
    expect(() => resolveSquareOptions({ ...squareOptions, mode: 'live' })).toThrow();
  } finally { await f.close(); }
});

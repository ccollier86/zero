/** Follow-up regressions for policy parity, immutable retries, canonical identity and concurrent ownership. Synthetic provider only. */
import { expect, test } from 'bun:test';
import { SquarePayments } from './service';
import { authority, squareFixture, squareOptions } from './square-fixture';

test('Square sales pause blocks new plan changes while completed receipts and cancellation remain usable', async () => {
  const f = squareFixture(); let paused: SquarePayments | undefined;
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'pause-review-checkout', offer: 'pro' });
    const completed = f.fixture.complete(checkout.id); await f.service.ownership.subscription(completed.subId!);
    paused = new SquarePayments(f.db, { ...squareOptions, fetch: f.fixture.fetch, acceptingSales: false }); paused.worker.wake = () => {};
    const next = paused.forAuthority(authority());
    await expect(next.subscriptions.change({ operationId: 'paused-plan-change', subscriptionId: completed.subId!, offer: 'plus', proration: 'none', paymentBehavior: 'error_if_incomplete' })).rejects.toMatchObject({ code: 'PAYMENTS_SALES_DISABLED' });
    expect(f.fixture.requests.some(request => request.path.endsWith('/swap-plan'))).toBe(false);
    expect((await next.checkout.create({ operationId: 'pause-review-checkout', offer: 'pro' })).id).toBe(checkout.id);
    expect((await next.subscriptions.cancel({ operationId: 'paused-cancellation', subscriptionId: completed.subId!, timing: 'period-end' })).cancelAtPeriodEnd).toBe(true);
  } finally { await paused?.stop(); await f.close(); }
});
for (const catalog of [false, true]) test(`Square ${catalog ? 'catalog' : 'merchant'} checkout retry freezes its return URL across configuration changes`, async () => {
  const f = squareFixture(); let next: SquarePayments | undefined;
  try {
    const input = { operationId: 'checkout-return-replay', total: { amount: 1200, currency: 'usd' }, description: 'Custom work' };
    const scopedInput = { operationId: input.operationId, offer: 'credit' };
    f.fixture.dropAfter = request => request.path === '/v2/online-checkout/payment-links';
    await expect(catalog ? f.service.forAuthority(authority()).checkout.create(scopedInput) : f.service.charges.checkout(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    f.fixture.dropAfter = undefined;
    next = new SquarePayments(f.db, { ...squareOptions, fetch: f.fixture.fetch, successUrl: 'https://app.example.test/new-return' }); next.worker.wake = () => {};
    const result = await (catalog ? next.forAuthority(authority()).checkout.create(scopedInput) : next.charges.checkout(input));
    expect(result.id).toBeTruthy(); const requests = f.fixture.requests.filter(request => request.path === '/v2/online-checkout/payment-links');
    expect(requests[1]!.body).toEqual(requests[0]!.body); expect(f.fixture.links.size).toBe(1);
  } finally { await next?.stop(); await f.close(); }
});
test('concurrent Square ownership lookups for the same buyer do not suppress each other as recursive cycles', async () => {
  const f = squareFixture();
  try {
    const a = await f.service.forAuthority(authority('alpha')).checkout.create({ operationId: 'concurrent-checkout-a', offer: 'pro' });
    const b = await f.service.forAuthority(authority('beta')).checkout.create({ operationId: 'concurrent-checkout-b', offer: 'pro' });
    const first = f.fixture.complete(a.id), second = f.fixture.complete(b.id);
    f.fixture.handle = async request => { if (request.path === '/v2/subscriptions/search') await new Promise(resolve => setTimeout(resolve, 10)); return undefined; };
    const rows = await Promise.all([f.service.ownership.payment(first.paymentId), f.service.ownership.payment(second.paymentId)]);
    expect(rows.map(row => row?.owner)).toEqual([{ kind: 'user', id: 'alpha' }, { kind: 'user', id: 'beta' }]);
  } finally { await f.close(); }
});
for (const kind of ['order', 'payment', 'subscription', 'invoice', 'refund', 'checkout'] as const) test(`Square rejects a canonical ${kind} response containing a different resource ID`, async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'identity-checkout', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    await f.service.ownership.subscription(completed.subId!); await f.service.ownership.invoice(completed.invoiceId!); await f.service.ownership.payment(completed.paymentId);
    const refunded = await f.service.charges.refund({ operationId: 'identity-refund', paymentId: completed.paymentId, amount: 100 });
    const values = { order: [completed.orderId, f.fixture.orders], payment: [completed.paymentId, f.fixture.payments], subscription: [completed.subId!, f.fixture.subscriptions], invoice: [completed.invoiceId!, f.fixture.invoices], refund: [refunded.id, f.fixture.refunds], checkout: [checkout.id, f.fixture.links] } as const;
    const [id, map] = values[kind], original = map.get(id);
    f.fixture.handle = request => request.method === 'GET' && decodeURIComponent(request.path).endsWith('/' + id) ? Response.json({ [kind === 'checkout' ? 'payment_link' : kind]: { ...original, id: 'UNRELATED_RESOURCE' } }) : undefined;
    await expect(kind === 'checkout' ? scoped.checkout.read(id) : f.service.ownership[kind](id)).rejects.toMatchObject({ code: 'PAYMENTS_PROVIDER_RESPONSE_INVALID' });
    if (kind !== 'checkout') expect(f.service.resources.get<any>(kind, id)?.data?.id).toBe(id);
  } finally { await f.close(); }
});
for (const code of ['IDEMPOTENCY_KEY_REUSED', 'TEMPORARY_ERROR']) test(`Square ${code} preserves the unresolved financial outcome instead of marking it rejected`, async () => {
  const f = squareFixture();
  try {
    const input = { operationId: 'idempotency-conflict-review', total: { amount: 1200, currency: 'usd' }, description: 'Custom work', paymentToken: 'cnon:card-nonce-ok' };
    f.fixture.dropAfter = request => request.path === '/v2/payments';
    await expect(f.service.charges.create(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' }); f.fixture.dropAfter = undefined;
    f.fixture.handle = request => request.path === '/v2/payments' ? Response.json({ errors: [{ category: 'INVALID_REQUEST_ERROR', code }] }, { status: 400 }) : undefined;
    await expect(f.service.charges.create(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await f.service.charges.operations.read(input.operationId))?.status).toBe('unknown'); expect(f.fixture.payments.size).toBe(1);
  } finally { await f.close(); }
});
for (const code of ['IDEMPOTENCY_KEY_REUSED', 'TEMPORARY_ERROR']) test(`Square ${code} cannot release the physical fence on a non-idempotent subscription write`, async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'uncertain-cancel-checkout', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    await f.service.ownership.subscription(completed.subId!);
    const input = { operationId: 'uncertain-cancel', subscriptionId: completed.subId!, timing: 'period-end' as const };
    f.fixture.handle = request => request.path.endsWith('/cancel') ? Response.json({ errors: [{ category: 'INVALID_REQUEST_ERROR', code }] }, { status: 400 }) : undefined;
    await expect(scoped.subscriptions.cancel(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    f.fixture.handle = undefined;
    await expect(scoped.subscriptions.cancel(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect(f.fixture.requests.filter(request => request.path.endsWith('/cancel'))).toHaveLength(1);
    expect((await scoped.operations.read(input.operationId))?.status).toBe('unknown');
  } finally { await f.close(); }
});
test('Square catalog quantities default to the declared minimum without breaking catalog reads', async () => {
  const f = squareFixture({ catalog: { credits: { kind: 'payment', label: 'Two or more credits', itemVariationId: 'ITEM_CREDIT', quantity: { min: 2, max: 10 } } } });
  try {
    const scoped = f.service.forAuthority(authority()); expect((await scoped.catalog())[0]?.quantity.min).toBe(2);
    const result = await scoped.checkout.create({ operationId: 'minimum-quantity-checkout', offer: 'credits' });
    const link = f.fixture.links.get(result.id), order = f.fixture.orders.get(link.order_id); expect(order.line_items[0].quantity).toBe('2'); expect(order.total_money.amount).toBe(200);
  } finally { await f.close(); }
});
test('Square invoice events retain the offer from their admitted one-time checkout order', async () => {
  const offers: (string | undefined)[] = [], f = squareFixture({ onEvent: async event => { if (event.resource.kind === 'invoice') offers.push(event.resource.offer); } });
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'invoice-offer-checkout', offer: 'credit' }), completed = f.fixture.complete(checkout.id);
    const id = 'inv:ONE_TIME_REVIEW';
    f.fixture.invoices.set(id, { id, order_id: completed.orderId, location_id: 'LOCATION_FIXTURE', primary_recipient: { customer_id: 'BUYER_SQUARE_CUSTOMER' }, status: 'PAID', created_at: new Date().toISOString(), payment_requests: [{ computed_amount_money: { amount: 100, currency: 'USD' } }] });
    const incoming = f.fixture.event('invoice.payment_made', id); await f.service.acceptWebhook(incoming.payload, incoming.signature); await f.service.drain();
    expect(offers).toEqual(['credit']); expect(f.service.resources.get('invoice', id)?.reference).toBeTruthy();
  } finally { await f.close(); }
});
test('Square cannot refund an approved but uncaptured payment', async () => {
  const f = squareFixture();
  try {
    const paid = await f.service.charges.create({ operationId: 'uncaptured-review-charge', total: { amount: 500, currency: 'usd' }, description: 'One-off', paymentToken: 'cnon:card-nonce-ok' });
    f.fixture.payments.get(paid.id).status = 'APPROVED';
    await expect(f.service.charges.refund({ operationId: 'uncaptured-review-refund', paymentId: paid.id })).rejects.toMatchObject({ code: 'PAYMENTS_REFUND_INVALID' });
    expect(f.fixture.requests.some(request => request.path === '/v2/refunds' && request.method === 'POST')).toBe(false);
  } finally { await f.close(); }
});
test('pausing Square sales cannot relabel an accepted but unresolved checkout as definitely rejected', async () => {
  const f = squareFixture(); let paused: SquarePayments | undefined;
  try {
    const input = { operationId: 'square-unknown-paused', total: { amount: 500, currency: 'usd' }, description: 'One-off' };
    f.fixture.dropAfter = request => request.path === '/v2/online-checkout/payment-links';
    await expect(f.service.charges.checkout(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' }); f.fixture.dropAfter = undefined;
    paused = new SquarePayments(f.db, { ...squareOptions, fetch: f.fixture.fetch, acceptingSales: false }); paused.worker.wake = () => {};
    await expect(paused.charges.checkout(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await paused.charges.operations.read(input.operationId))?.status).toBe('unknown'); expect(f.fixture.links.size).toBe(1);
  } finally { await paused?.stop(); await f.close(); }
});
test('Square STATIC checkout subscriptions retain ownership through the legacy top-level order template', async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'legacy-template-review', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    const sub = f.fixture.subscriptions.get(completed.subId!); sub.order_template_id = sub.phases[0].order_template_id; sub.phases = [];
    const event = f.fixture.event('subscription.created', completed.subId!); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect((await scoped.entitlements.read()).search).toBe(true); expect(f.service.resources.get('subscription', completed.subId!)?.owner).toEqual({ kind: 'user', id: 'user-fixture' });
  } finally { await f.close(); }
});
test('Square webhook resource resolution has one deadline across all canonical provider reads', async () => {
  const f = squareFixture({ timeoutMs: 100 });
  try {
    await f.service.verifyMerchant();
    f.fixture.handle = request => request.path.startsWith('/v2/payments/') || request.path.startsWith('/v2/orders/') ? new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(undefined), 60);
      const fail = () => { clearTimeout(timer); reject(new Error('Synthetic bounded resolve')); };
      request.signal.addEventListener('abort', fail, { once: true }); if (request.signal.aborted) fail();
    }) : undefined;
    const checkout = await f.service.forAuthority(authority()).checkout.create({ operationId: 'deadline-review-checkout', offer: 'credit' }), completed = f.fixture.complete(checkout.id);
    const event = f.fixture.event('payment.updated', completed.paymentId); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect(f.service.jobs.list().items.some(job => job.id === JSON.parse(event.payload).event_id && job.status === 'retry')).toBe(true);
  } finally { await f.close(); }
});

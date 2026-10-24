/** Financial failure tests use the real SDK against local synthetic transport, including accepted-but-disconnected writes. */
import { expect, test } from 'bun:test';
import { authority, squareFixture } from './square-fixture';

const chargeInput = { operationId: 'recovery-charge', total: { amount: 1200, currency: 'usd' }, description: 'One-off', paymentToken: 'cnon:card-nonce-ok' };
async function subscription(f: ReturnType<typeof squareFixture>) {
  const scoped = f.service.forAuthority(authority());
  const checkout = await scoped.checkout.create({ operationId: 'recovery-checkout', offer: 'pro' });
  const completed = f.fixture.complete(checkout.id);
  await f.service.ownership.subscription(completed.subId!);
  return { scoped, id: completed.subId! };
}
test('accepted charge/refund responses can be lost without duplicating money or recomputing the refund balance', async () => {
  const f = squareFixture();
  try {
    f.fixture.dropAfter = request => request.path === '/v2/payments';
    await expect(f.service.charges.create(chargeInput)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await f.service.charges.operations.read(chargeInput.operationId))?.status).toBe('unknown');
    f.fixture.dropAfter = undefined;
    const charged = await f.service.charges.create(chargeInput); expect(f.fixture.payments.size).toBe(1);
    f.fixture.dropAfter = request => request.path === '/v2/refunds';
    const input = { operationId: 'recovery-refund', paymentId: charged.id };
    await expect(f.service.charges.refund(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await f.service.charges.read(charged.id)).refunded).toBe(1200);
    f.fixture.dropAfter = undefined;
    const refunded = await f.service.charges.refund(input); expect(refunded.total.amount).toBe(1200); expect(f.fixture.refunds.size).toBe(1);
    expect((await f.service.ownership.refund(refunded.id))?.reference).toBeTruthy();
  } finally { await f.close(); }
});
test('hosted checkout replay retains exact original pricing even if the live catalog becomes unavailable', async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), input = { operationId: 'checkout-lost-response', offer: 'credit', quantity: 2 };
    f.fixture.dropAfter = request => request.path === '/v2/online-checkout/payment-links';
    await expect(scoped.checkout.create(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    f.fixture.dropAfter = undefined;
    f.fixture.handle = request => request.path.startsWith('/v2/catalog') ? Response.json({ errors: [{ code: 'NOT_FOUND' }] }, { status: 404 }) : undefined;
    expect((await scoped.checkout.create(input)).url).toContain('square.link'); expect(f.fixture.links.size).toBe(1);
    const posts = f.fixture.requests.filter(request => request.path === '/v2/online-checkout/payment-links');
    expect(posts[0]!.body).toEqual(posts[1]!.body); expect(posts[0]!.body.order.line_items[0].base_price_money.amount).toBe(100);
  } finally { await f.close(); }
});
test('non-idempotent cancellation and resume reconcile accepted outcomes without resending physical writes', async () => {
  const f = squareFixture();
  try {
    const { scoped, id } = await subscription(f), cancel = { operationId: 'cancel-disconnected', subscriptionId: id, timing: 'period-end' as const };
    f.fixture.dropAfter = request => request.path.endsWith('/cancel');
    await expect(scoped.subscriptions.cancel(cancel)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' }); f.fixture.dropAfter = undefined;
    expect((await scoped.subscriptions.cancel(cancel)).cancelAtPeriodEnd).toBe(true);
    expect(f.fixture.requests.filter(request => request.path.endsWith('/cancel'))).toHaveLength(1);
    const resume = { operationId: 'resume-disconnected', subscriptionId: id };
    f.fixture.dropAfter = request => request.method === 'DELETE';
    await expect(scoped.subscriptions.resume(resume)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' }); f.fixture.dropAfter = undefined;
    expect((await scoped.subscriptions.resume(resume)).cancelAtPeriodEnd).toBe(false);
    expect(f.fixture.requests.filter(request => request.method === 'DELETE')).toHaveLength(1);
  } finally { await f.close(); }
});
test('a genuinely unresolved non-idempotent send is never automatically repeated', async () => {
  const f = squareFixture();
  try {
    const { scoped, id } = await subscription(f), input = { operationId: 'cancel-truly-unknown', subscriptionId: id, timing: 'period-end' as const };
    f.fixture.handle = request => { if (request.path.endsWith('/cancel')) throw new Error('Synthetic ambiguous failure before observed acceptance'); return undefined; };
    await expect(scoped.subscriptions.cancel(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    f.fixture.handle = undefined;
    await expect(scoped.subscriptions.cancel(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect(f.fixture.requests.filter(request => request.path.endsWith('/cancel'))).toHaveLength(1);
  } finally { await f.close(); }
});
test('scheduled plan changes project separately and conflicting mutations share one durable resource fence', async () => {
  const f = squareFixture();
  try {
    const { scoped, id } = await subscription(f);
    const busy = f.service.store.lock('subscription:' + id)!;
    const input = { operationId: 'switch-plan-operation', subscriptionId: id, offer: 'plus', proration: 'none' as const, paymentBehavior: 'error_if_incomplete' as const };
    await expect(scoped.subscriptions.change(input)).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_BUSY' }); f.service.store.release(busy);
    const value = await scoped.subscriptions.change(input);
    expect(value.offers).toEqual(['pro']); expect(value.pendingChange?.offers).toEqual(['plus']); expect(value.pendingChange?.effectiveAt).toBeGreaterThan(0);
    await expect(scoped.subscriptions.cancel({ operationId: 'cancel-not-immediate', subscriptionId: id, timing: 'immediate' })).rejects.toMatchObject({ code: 'PAYMENTS_CAPABILITY_UNSUPPORTED' });
  } finally { await f.close(); }
});
test('authority is rechecked at the actual provider write and accepted receipts survive subsequent revocation', async () => {
  const f = squareFixture();
  try {
    const auth = authority(), scoped = f.service.forAuthority(auth);
    f.fixture.handle = request => { if (request.path.startsWith('/v2/catalog/')) auth.revoke(); return undefined; };
    await expect(scoped.checkout.create({ operationId: 'revoked-physical-send', offer: 'pro' })).rejects.toBeDefined();
    expect(f.fixture.links.size).toBe(0);
    const fresh = authority(); f.fixture.handle = request => { if (request.path === '/v2/online-checkout/payment-links') fresh.revoke(); return undefined; };
    const input = { operationId: 'revoked-after-acceptance', offer: 'pro' };
    await expect(f.service.forAuthority(fresh).checkout.create(input)).rejects.toBeDefined();
    expect((await f.service.forAuthority(authority()).checkout.create(input)).id).toBeTruthy(); expect(f.fixture.links.size).toBe(1);
  } finally { await f.close(); }
});
test('deleted provider customers revoke grants without destroying identity binding or payment history', async () => {
  const f = squareFixture();
  try {
    const { scoped } = await subscription(f); await scoped.reconcile(); expect((await scoped.entitlements.read()).search).toBe(true);
    const id = (await scoped.snapshot()).customer!.id; f.fixture.customers.delete(id);
    expect((await scoped.reconcile()).customer).toBeNull(); expect(await scoped.entitlements.read()).toEqual({});
    expect(f.service.store.customer({ kind: 'user', id: 'user-fixture' })).toBe(id);
  } finally { await f.close(); }
});
test('a paid subscription checkout remains paid after cancellation without retaining subscription grants', async () => {
  const f = squareFixture();
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'historical-paid-checkout', offer: 'pro' }), completed = f.fixture.complete(checkout.id);
    await f.service.ownership.subscription(completed.subId!); await scoped.reconcile();
    expect((await scoped.checkout.read(checkout.id)).paymentStatus).toBe('paid');
    f.fixture.subscriptions.get(completed.subId!).status = 'CANCELED'; await scoped.reconcile();
    expect((await scoped.checkout.read(checkout.id)).paymentStatus).toBe('paid'); expect(await scoped.entitlements.read()).toEqual({});
  } finally { await f.close(); }
});
test('captured totals are detached before awaits, unsafe properties never execute and merchant events identify their own refund', async () => {
  const seen: string[] = [], f = squareFixture({ onMerchantEvent: async event => { seen.push(event.operationId); } });
  try {
    let called = false;
    const unsafe = { ...chargeInput, get description() { called = true; return 'bad'; } };
    await expect(f.service.charges.create(unsafe)).rejects.toBeDefined(); expect(called).toBe(false);
    const input = structuredClone(chargeInput), promise = f.service.charges.create(input); input.total.amount = 1;
    const charge = await promise; expect(charge.total.amount).toBe(1200);
    const refund = await f.service.charges.refund({ operationId: 'merchant-refund-event', paymentId: charge.id, amount: 100 });
    const event = f.fixture.event('refund.updated', refund.id); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect(seen).toEqual(['merchant-refund-event']);
  } finally { await f.close(); }
});
test('merchant refunds of subject-owned payments retain scope and notify through the trusted merchant callback', async () => {
  const seen: string[] = [], f = squareFixture({ onMerchantEvent: async event => { seen.push(event.operationId); } });
  try {
    const scoped = f.service.forAuthority(authority()), checkout = await scoped.checkout.create({ operationId: 'owned-one-off-checkout', offer: 'credit' }), completed = f.fixture.complete(checkout.id);
    await f.service.ownership.payment(completed.paymentId);
    const refund = await f.service.charges.refund({ operationId: 'trusted-admin-refund', paymentId: completed.paymentId });
    const event = f.fixture.event('refund.updated', refund.id); await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect(seen).toEqual(['trusted-admin-refund']); expect(f.service.resources.get('payment', completed.paymentId)?.owner).toEqual({ kind: 'user', id: 'user-fixture' });
    expect((await scoped.refunds.list({ paymentId: completed.paymentId })).items[0]?.id).toBe(refund.id);
  } finally { await f.close(); }
});

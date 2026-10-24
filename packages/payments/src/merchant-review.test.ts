/** Stripe follow-up: exact checkout replay parameters and canonical resource/amount validation. No real provider calls. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '@zero/framework/sync';
import { StripePayments } from './service';
import { fixtureOptions, StripeFixture, payment } from './payments-fixture';

function fixture() {
  const db = createReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture();
  const service = new StripePayments(db, { ...fixtureOptions, catalog: {}, httpClient: stripe.httpClient });
  return { db, stripe, service, async close() { await service.stop(); db.dispose(); } };
}
const metadata = (data: URLSearchParams) => Object.fromEntries([...data].filter(([key]) => /^metadata\[[^\]]+\]$/.test(key)).map(([key, value]) => [key.slice(9, -1), value]));
test('Stripe merchant checkout retries retain original success and cancel URLs after configuration changes', async () => {
  const f = fixture(); let updated: StripePayments | undefined;
  try {
    let first = true;
    f.stripe.handle = request => {
      if (request.path !== '/v1/checkout/sessions') return undefined;
      if (first) { first = false; throw new Error('Synthetic ambiguous checkout response'); }
      return Response.json({ id: 'cs_returnreview', object: 'checkout.session', livemode: false, status: 'open', url: 'https://checkout.stripe.com/returnreview', amount_total: 1200, currency: 'usd', metadata: metadata(request.data) });
    };
    const input = { operationId: 'stripe-checkout-url-replay', total: { amount: 1200, currency: 'usd' }, description: 'One-off charge' };
    await expect(f.service.charges.checkout(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    updated = new StripePayments(f.db, { ...fixtureOptions, catalog: {}, httpClient: f.stripe.httpClient, successUrl: 'https://app.example.test/new-success', cancelUrl: 'https://app.example.test/new-cancel' });
    expect((await updated.charges.checkout(input)).id).toBe('cs_returnreview');
    const requests = f.stripe.requests.filter(request => request.path === '/v1/checkout/sessions'); expect(requests[1]!.data.toString()).toBe(requests[0]!.data.toString());
  } finally { await updated?.stop(); await f.close(); }
});
test('Stripe merchant checkout refuses a provider session with a different amount or currency', async () => {
  const f = fixture();
  try {
    f.stripe.handle = request => request.path === '/v1/checkout/sessions' ? Response.json({ id: 'cs_wrongtotal', object: 'checkout.session', livemode: false, status: 'open', url: 'https://checkout.stripe.com/wrong', amount_total: 9999, currency: 'eur', metadata: metadata(request.data) }) : undefined;
    await expect(f.service.charges.checkout({ operationId: 'stripe-wrong-checkout-total', total: { amount: 1200, currency: 'usd' }, description: 'One-off charge' })).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect(f.service.resources.get('checkout', 'cs_wrongtotal')).toBeNull();
  } finally { await f.close(); }
});
test('Stripe merchant refunds validate the exact captured amount and currency before saving a completed receipt', async () => {
  const f = fixture();
  try {
    f.stripe.handle = request => request.path === '/v1/refunds' ? Response.json({ id: 're_wrongtotal', object: 'refund', payment_intent: 'pi_fixture', amount: 1, currency: 'eur', status: 'succeeded', created: 100, metadata: metadata(request.data) }) : undefined;
    await expect(f.service.charges.refund({ operationId: 'stripe-wrong-refund-total', paymentId: 'pi_fixture', amount: 400 })).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await f.service.charges.operations.read('stripe-wrong-refund-total'))?.status).toBe('unknown');
  } finally { await f.close(); }
});
test('Stripe client action reads reject a different returned PaymentIntent instead of exposing its secret', async () => {
  const f = fixture();
  try {
    f.stripe.pay = payment({ id: 'pi_unrelated', status: 'requires_action', client_secret: 'unrelated-secret' });
    await expect(f.service.charges.clientAction('pi_fixture')).rejects.toMatchObject({ code: 'PAYMENTS_PROVIDER_RESPONSE_INVALID' });
  } finally { await f.close(); }
});
test('Stripe full merchant refunds use the captured balance, not an uncaptured part of the intent', async () => {
  const f = fixture();
  try {
    f.stripe.pay = payment({ amount: 1900, amount_received: 700, latest_charge: { id: 'ch_fixture', amount_refunded: 200 } });
    const refund = await f.service.charges.refund({ operationId: 'partial-capture-full-refund', paymentId: 'pi_fixture' });
    expect(refund.total.amount).toBe(500); expect(f.stripe.requests.find(request => request.path === '/v1/refunds')?.data.get('amount')).toBe('500');
  } finally { await f.close(); }
});
for (const kind of ['charge', 'checkout', 'refund'] as const) test(`Stripe merchant ${kind} acknowledgment must echo the admitted local intent`, async () => {
  const f = fixture();
  try {
    f.stripe.handle = request => {
      if (request.path === '/v1/payment_intents' && request.method === 'POST') return Response.json(payment({ amount: 1200, currency: 'usd', metadata: { zero_connection: 'another-connection', zero_merchant_operation: 'foreign' } }));
      if (request.path === '/v1/checkout/sessions') return Response.json({ id: 'cs_foreignbinding', object: 'checkout.session', livemode: false, status: 'open', url: 'https://checkout.stripe.com/foreign', amount_total: 1200, currency: 'usd', metadata: {} });
      if (request.path === '/v1/refunds') return Response.json({ id: 're_foreignbinding', object: 'refund', payment_intent: 'pi_fixture', amount: 400, currency: 'usd', status: 'succeeded', created: 100, metadata: {} });
      return undefined;
    };
    const input = { operationId: 'merchant-binding-' + kind, total: { amount: 1200, currency: 'usd' }, description: 'One-off charge' };
    const result = kind === 'charge' ? f.service.charges.create({ ...input, paymentToken: 'pm_fixture' }) : kind === 'checkout' ? f.service.charges.checkout(input) : f.service.charges.refund({ operationId: input.operationId, paymentId: 'pi_fixture', amount: 400 });
    await expect(result).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' }); expect((await f.service.charges.operations.read(input.operationId))?.status).toBe('unknown');
  } finally { await f.close(); }
});
test('pausing Stripe sales cannot relabel a previously unknown checkout as definitely rejected', async () => {
  const f = fixture(); let paused: StripePayments | undefined;
  try {
    f.stripe.handle = request => { if (request.path === '/v1/checkout/sessions') throw new Error('Synthetic unknown response'); return undefined; };
    const input = { operationId: 'stripe-unknown-paused', total: { amount: 500, currency: 'usd' }, description: 'One-off' };
    await expect(f.service.charges.checkout(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    paused = new StripePayments(f.db, { ...fixtureOptions, httpClient: f.stripe.httpClient, acceptingSales: false });
    await expect(paused.charges.checkout(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    expect((await paused.charges.operations.read(input.operationId))?.status).toBe('unknown'); expect(f.stripe.requests.filter(request => request.path === '/v1/checkout/sessions')).toHaveLength(1);
  } finally { await paused?.stop(); await f.close(); }
});

/** The same subjectless merchant facade over Stripe: arbitrary minor-unit amounts, stable receipts and no browser secrets. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '@zero/framework/sync';
import { StripePayments } from './service';
import { fixtureOptions, StripeFixture, payment, signedEvent } from './payments-fixture';

function fixture(extra: Partial<typeof fixtureOptions> = {}) {
  const db = createReactiveDB({ mode: 'memory', emitTelemetry: false }), stripe = new StripeFixture();
  const values = new Map<string, any>(), sessions = new Map<string, any>(), refunds = new Map<string, any>();
  let loseResponse = false;
  stripe.handle = request => {
    const { path, method, data, key } = request;
    const metadata = (prefix: string) => Object.fromEntries(['zero_connection', 'zero_merchant_operation'].map(name => [name, data.get(`${prefix}[${name}]`)]));
    if (path === '/v1/payment_intents' && method === 'POST') {
      let value = values.get(key!);
      if (!value) { value = payment({ id: 'pi_custom' + values.size, customer: null, amount: Number(data.get('amount')), amount_received: Number(data.get('amount')), currency: data.get('currency'), metadata: metadata('metadata') }); values.set(key!, value); }
      if (loseResponse) throw new Error('Synthetic lost payment response');
      return Response.json(value);
    }
    if (path.startsWith('/v1/payment_intents/pi_custom')) return Response.json([...values.values()].find(value => path.endsWith(value.id)));
    if (path === '/v1/checkout/sessions' && method === 'POST') {
      const value = { id: 'cs_custom', object: 'checkout.session', customer: null, livemode: false, status: 'open', url: 'https://checkout.stripe.com/custom', payment_status: 'unpaid',
        amount_total: Number(data.get('line_items[0][price_data][unit_amount]')), currency: data.get('line_items[0][price_data][currency]'), metadata: metadata('metadata') };
      sessions.set(value.id, value); return Response.json(value);
    }
    if (path === '/v1/checkout/sessions/cs_custom') return Response.json(sessions.get('cs_custom'));
    if (path === '/v1/refunds' && method === 'POST') {
      const value = refunds.get(key!) ?? { id: 're_custom', object: 'refund', status: 'succeeded', payment_intent: data.get('payment_intent'), amount: Number(data.get('amount')), currency: 'usd', created: 12345, metadata: metadata('metadata') };
      refunds.set(key!, value); return Response.json(value);
    }
    if (path === '/v1/refunds/re_custom') return Response.json([...refunds.values()][0]);
  };
  const service = new StripePayments(db, { ...fixtureOptions, catalog: {}, httpClient: stripe.httpClient, ...extra });
  service.start = () => {}; // All worker passes are explicit in these unit tests.
  return { db, stripe, service, values, sessions, refunds, lose(on: boolean) { loseResponse = on; }, async close() { await service.stop(); db.dispose(); } };
}
const input = { operationId: 'subjectless-charge', total: { amount: 1379, currency: 'USD' }, description: 'Custom work', paymentToken: 'pm_customtoken', reference: 'local-order-123' };
test('Stripe custom charges and checkout require neither a catalog product nor user/customer', async () => {
  const f = fixture();
  try {
    const charged = await f.service.charges.create(input); expect(charged.total).toEqual({ amount: 1379, currency: 'usd' }); expect(charged.status).toBe('succeeded');
    expect(await f.service.charges.create(input)).toEqual(charged); expect(f.values.size).toBe(1); expect(f.stripe.customerCount).toBe(0);
    const checkout = await f.service.charges.checkout({ operationId: 'subjectless-checkout', total: { amount: 321, currency: 'usd' }, description: 'One-off fee' });
    expect(checkout.url).toBe('https://checkout.stripe.com/custom');
    const sent = f.stripe.requests.find(request => request.path === '/v1/checkout/sessions')!.data;
    expect(sent.get('line_items[0][price_data][unit_amount]')).toBe('321'); expect(sent.has('customer')).toBe(false); expect(sent.has('line_items[0][price]')).toBe(false);
    expect((await f.service.charges.operations.read(input.operationId))?.status).toBe('complete');
    await expect(f.service.charges.create({ ...input, total: { amount: 1380, currency: 'usd' } })).rejects.toMatchObject({ code: 'PAYMENTS_COMMAND_CONFLICT' });
    expect(JSON.stringify(charged)).not.toContain('client_secret');
  } finally { await f.close(); }
});
test('an accepted Stripe charge with a lost response reuses its original provider idempotency key', async () => {
  const f = fixture();
  try {
    f.lose(true); await expect(f.service.charges.create(input)).rejects.toMatchObject({ code: 'PAYMENTS_OUTCOME_UNKNOWN' });
    f.lose(false); const charged = await f.service.charges.create(input); expect(charged.id).toBe('pi_custom0'); expect(f.values.size).toBe(1);
    const sent = f.stripe.requests.filter(request => request.path === '/v1/payment_intents'); expect(sent[0]!.key).toBe(sent[1]!.key);
    expect(sent[0]!.data.toString()).toBe(sent[1]!.data.toString());
  } finally { await f.close(); }
});
test('Stripe client actions are explicit trusted reads, never operation receipts or reactive snapshots', async () => {
  const f = fixture();
  try {
    const charged = await f.service.charges.create(input), value = [...f.values.values()][0]; value.status = 'requires_action';
    expect(await f.service.charges.clientAction(charged.id)).toEqual({ provider: 'stripe', clientSecret: 'must-never-escape' });
    expect(JSON.stringify(f.db.prepare('SELECT * FROM _zero_payments_commands').all())).not.toContain('must-never-escape');
    expect(JSON.stringify(f.db.prepare('SELECT * FROM _zero_payments_resources').all())).not.toContain('must-never-escape');
    value.status = 'succeeded'; expect(await f.service.charges.clientAction(charged.id)).toBeNull();
  } finally { await f.close(); }
});
test('Stripe merchant webhook callbacks use canonical state, durable local intent and refund operation correlation', async () => {
  const seen: any[] = [], f = fixture({ onMerchantEvent: async event => { seen.push(event); } });
  try {
    const charged = await f.service.charges.create(input), value = [...f.values.values()][0];
    const event = signedEvent({ id: 'evt_merchantcharge', type: 'payment_intent.succeeded', data: { object: { ...value, status: 'failed' } } });
    await f.service.acceptWebhook(event.payload, event.signature); await f.service.drain();
    expect(seen[0]).toMatchObject({ provider: 'stripe', operationId: input.operationId, reference: input.reference, resource: { status: 'succeeded', paymentStatus: 'paid' } });
    const refund = await f.service.charges.refund({ operationId: 'merchant-refund-1', paymentId: charged.id, amount: 379 });
    const refunded = [...f.refunds.values()][0]; expect(refund.total.amount).toBe(379);
    const incoming = signedEvent({ id: 'evt_merchantrefund', type: 'refund.created', data: { object: refunded } });
    await f.service.acceptWebhook(incoming.payload, incoming.signature); await f.service.drain();
    expect(seen[1]).toMatchObject({ operationId: 'merchant-refund-1', resource: { kind: 'refund', total: { amount: 379 } } });
    expect(f.service.store.pending().quarantined).toBe(0); expect(f.stripe.customerCount).toBe(0);
  } finally { await f.close(); }
});
test('Stripe captures mutable totals before awaiting and refuses raw card data or undocumented fields', async () => {
  const f = fixture();
  try {
    const next = structuredClone(input), promise = f.service.charges.create(next); next.total.amount = 1; expect((await promise).total.amount).toBe(1379);
    await expect(f.service.charges.create({ ...input, paymentToken: '4111111111111111' })).rejects.toBeDefined();
    await expect(f.service.charges.checkout({ operationId: 'unexpected-owner', total: input.total, description: 'bad', customer: 'cus_someone' } as never)).rejects.toBeDefined();
    await expect(f.service.charges.checkout({ operationId: 'negative-amount', total: { amount: -1, currency: 'usd' }, description: 'bad' })).rejects.toBeDefined();
  } finally { await f.close(); }
});

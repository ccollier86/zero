import { afterEach, describe, expect, test } from 'bun:test';
import { ReactiveDB } from '@zero/framework/sync';
import { StripePayments } from './service';
import { authority, customer, fixtureOptions, invoice, payment, signedEvent, StripeFixture, subscription } from './payments-fixture';

const fixtures: { service: StripePayments; db: ReactiveDB }[] = [];
function fixture(input: Partial<typeof fixtureOptions> = {}) {
  const db = new ReactiveDB({ mode: 'memory', observability: null, emitTelemetry: false }), stripe = new StripeFixture();
  const service = new StripePayments(db, { ...fixtureOptions, httpClient: stripe.httpClient, ...input });
  fixtures.push({ service, db }); return { db, service, stripe, scoped: service.forAuthority(authority()) };
}
afterEach(async () => { for (const item of fixtures.splice(0)) { await item.service.stop(); item.db.dispose(); } });

describe('Stripe scoped billing foundation', () => {
  test('Checkout, customer binding and durable operation replay use the official SDK', async () => {
    const { scoped, stripe, service } = fixture();
    const first = await scoped.checkout.create({ operationId: 'checkout-operation-1', offer: 'pro', quantity: 2 });
    expect(first.url).toBe('https://checkout.stripe.com/fixture');
    expect(await scoped.checkout.create({ operationId: 'checkout-operation-1', offer: 'pro', quantity: 2 })).toEqual(first);
    expect(stripe.customerCount).toBe(1);
    expect(stripe.requests.filter(r => r.path === '/v1/checkout/sessions')).toHaveLength(1);
    const posted = stripe.requests.find(r => r.path === '/v1/checkout/sessions')!;
    expect(posted.key).toStartWith('zero-'); expect(posted.data.get('line_items[0][price]')).toBe('price_pro'); expect(posted.data.get('line_items[0][quantity]')).toBe('2');
    expect(posted.data.get('customer')).toBe(customer.id); expect(posted.data.get('subscription_data[metadata][zero_offer]')).toBe('pro');
    expect(service.store.customer({ kind: 'user', id: 'user-fixture' })).toBe(customer.id);
    await expect(scoped.checkout.create({ operationId: 'checkout-operation-1', offer: 'credit' })).rejects.toMatchObject({ code: 'PAYMENTS_COMMAND_CONFLICT' });
  });
  test('catalog uses canonical prices, portal and Checkout reads are scoped', async () => {
    const { scoped } = fixture();
    expect((await scoped.catalog())[0]).toMatchObject({ id: 'pro', unitAmount: 1900, currency: 'usd', interval: 'month' });
    await scoped.customers.ensure({ operationId: 'customer-operation' });
    expect(await scoped.portal.create({ operationId: 'portal-operation' })).toEqual({ url: 'https://billing.stripe.com/fixture' });
    expect(await scoped.checkout.read('cs_test_fixture')).toMatchObject({ paymentStatus: 'paid' });
  });
  test('reconciliation publishes safe projections, not client secrets or invoice URLs', async () => {
    const { scoped, service, db } = fixture();
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    const changes: unknown[] = []; const remove = db.onChange(change => changes.push(change));
    const snapshot = await scoped.reconcile(); remove();
    expect(snapshot.entitlements).toEqual({ search: true, seats: 20 }); expect(snapshot.revision).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain('client_secret'); expect(JSON.stringify(snapshot)).not.toContain('invoice.stripe.com');
    expect(changes).toHaveLength(1); expect((await scoped.invoices.read('in_fixture')).paid).toBe(true);
    expect(await scoped.invoices.document('in_fixture')).toEqual({ hostedUrl: 'https://invoice.stripe.com/fixture', pdfUrl: null });
    expect((await scoped.payments.list()).items[0]!.id).toBe('pi_fixture');
  });
  test('paid, trial, past-due and stale entitlement states fail closed without mutating roles', async () => {
    const { scoped, service, stripe } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    stripe.sub = subscription({ status: 'past_due' }); expect((await scoped.reconcile()).entitlements).toEqual({});
    stripe.sub = subscription({ latest_invoice: invoice({ status: 'open' }) }); expect((await scoped.reconcile()).entitlements).toEqual({});
    stripe.sub = subscription({ status: 'trialing', trial_end: Math.floor(Date.now() / 1000) + 1000 }); expect((await scoped.reconcile()).entitlements.search).toBe(true);
    const lock = service.store.lock('customer:cus_fixture')!;
    service.store.writeView({ kind: 'user', id: 'user-fixture' }, { ...await scoped.snapshot(), reconciledAt: new Date(0).toISOString() }, lock); service.store.release(lock);
    expect(await scoped.entitlements.read()).toEqual({}); expect((await scoped.snapshot()).stale).toBe(true);
  });
  test('foreign resource IDs/cursors and non-admin refunds are denied', async () => {
    const { scoped, service, stripe } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    stripe.inv = invoice({ customer: 'cus_other' });
    await expect(scoped.invoices.read('in_fixture')).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
    await expect(scoped.invoices.list({ after: 'in_fixture' })).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
    await expect(scoped.refunds.create({ operationId: 'refund-operation', paymentId: 'pi_fixture' })).rejects.toMatchObject({ status: 403 });
    await expect(service.forAuthority(authority('other-user')).invoices.read('in_fixture')).rejects.toMatchObject({ code: 'PAYMENTS_CUSTOMER_REQUIRED' });
  });
  test('separately authorized refunds are idempotent and enforce the balance', async () => {
    const { service, stripe } = fixture(); service.store.bind({ kind: 'user', id: 'admin' }, customer.id);
    const scoped = service.forAuthority(authority('admin', 'admin'));
    const input = { operationId: 'refund-operation', paymentId: 'pi_fixture', amount: 400, reason: 'requested_by_customer' as const };
    expect((await scoped.refunds.create(input)).total.amount).toBe(400); await scoped.refunds.create(input);
    expect(stripe.requests.filter(r => r.path === '/v1/refunds' && r.method === 'POST')).toHaveLength(1);
    await expect(scoped.refunds.create({ ...input, operationId: 'refund-too-much', amount: 2000 })).rejects.toMatchObject({ code: 'PAYMENTS_REFUND_INVALID' });
    expect((await scoped.refunds.list({ paymentId: 'pi_fixture' })).items).toHaveLength(1);
  });
  test('subscription preview/change/cancel/resume preserve explicit policies', async () => {
    const { scoped, service, stripe } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    const input = { subscriptionId: 'sub_fixture', offer: 'pro', quantity: 3, proration: 'create_prorations' as const };
    const preview = await scoped.subscriptions.preview(input);
    await scoped.subscriptions.change({ ...input, operationId: 'subscription-change', paymentBehavior: 'error_if_incomplete', prorationDate: preview.prorationDate });
    const update = stripe.requests.find(r => r.path === '/v1/subscriptions/sub_fixture' && r.method === 'POST')!;
    expect(update.data.get('proration_date')).toBe(String(preview.prorationDate)); expect(update.data.get('payment_behavior')).toBe('error_if_incomplete');
    expect((await scoped.subscriptions.cancel({ operationId: 'subscription-cancel', subscriptionId: 'sub_fixture', timing: 'period-end' })).cancelAtPeriodEnd).toBe(true);
    expect((await scoped.subscriptions.resume({ operationId: 'subscription-resume', subscriptionId: 'sub_fixture' })).cancelAtPeriodEnd).toBe(false);
    expect((await scoped.subscriptions.cancel({ operationId: 'subscription-endnow', subscriptionId: 'sub_fixture', timing: 'immediate' })).status).toBe('canceled');
    await scoped.subscriptions.preview({ ...input, proration: 'none' });
    expect(stripe.requests.filter(r => r.path === '/v1/invoices/create_preview').at(-1)!.data.has('subscription_details[proration_date]')).toBe(false);
  });
  test('accepted provider results are recorded even if the caller is revoked during the response', async () => {
    const { service, stripe } = fixture(), auth = authority();
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    stripe.handle = r => { if (r.path === '/v1/billing_portal/sessions') auth.revoke(); return undefined; };
    await expect(service.forAuthority(auth).portal.create({ operationId: 'portal-revoked-op' })).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
    const fresh = service.forAuthority(authority());
    expect(await fresh.portal.create({ operationId: 'portal-revoked-op' })).toEqual({ url: 'https://billing.stripe.com/fixture' });
    expect(stripe.requests.filter(r => r.path === '/v1/billing_portal/sessions')).toHaveLength(1);
  });
  test('merchant mismatch, mode confusion and arbitrary card/amount fields never reach Stripe writes', async () => {
    const { scoped, stripe } = fixture(); stripe.accountId = 'acct_wrong';
    await expect(scoped.customers.ensure({ operationId: 'customer-operation' })).rejects.toMatchObject({ code: 'PAYMENTS_MERCHANT_MISMATCH' });
    expect(stripe.customerCount).toBe(0);
    expect(() => scoped.checkout.create({ operationId: 'checkout-operation', offer: 'pro', amount: 1 } as never)).toThrow('Unexpected payment input');
    const f = fixture(); f.stripe.inv = invoice({ livemode: true }); f.service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    await expect(f.scoped.invoices.read('in_fixture')).rejects.toMatchObject({ code: 'PAYMENTS_RESOURCE_FORBIDDEN' });
  });
  test('sales pause still permits billing reads, cancellation and portal', async () => {
    const { scoped, service } = fixture({ acceptingSales: false }); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    expect(() => scoped.checkout.create({ operationId: 'checkout-operation', offer: 'pro' })).toThrow('New sales');
    expect((await scoped.portal.create({ operationId: 'portal-operation' })).url).toStartWith('https:');
    await scoped.subscriptions.cancel({ operationId: 'subscription-cancel', subscriptionId: 'sub_fixture', timing: 'period-end' });
  });
});

describe('signature-verified durable webhook work', () => {
  test('duplicates collapse, old events fetch current canonical state, tampering is rejected', async () => {
    const { service, stripe } = fixture(); service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id);
    const event = signedEvent({ data: { object: subscription({ status: 'past_due' }) } });
    expect(await service.acceptWebhook(event.payload, event.signature)).toEqual({ received: true, supported: true });
    await service.acceptWebhook(event.payload, event.signature); expect(service.store.pending().pending).toBe(1);
    await service.drain(); expect(service.store.pending().pending).toBe(0);
    expect(service.snapshot({ kind: 'user', id: 'user-fixture' }).subscriptions[0]!.status).toBe('active');
    expect(stripe.requests.filter(r => r.path === '/v1/subscriptions')).toHaveLength(1);
    await expect(service.acceptWebhook(event.payload + ' ', event.signature)).rejects.toMatchObject({ code: 'PAYMENTS_WEBHOOK_SIGNATURE_INVALID' });
  });
  test('wrong environment/account/version is rejected; rotation is supported', async () => {
    const { service } = fixture({ webhookSecrets: ['whsec_rotated', 'whsec_fixture'] });
    for (const override of [{ livemode: true }, { account: 'acct_other' }, { api_version: '2020-08-27' }]) {
      const event = signedEvent(override); await expect(service.acceptWebhook(event.payload, event.signature)).rejects.toBeDefined();
    }
    const event = signedEvent(); expect((await service.acceptWebhook(event.payload, event.signature)).received).toBe(true);
  });
  test('unbound customers retry instead of trusting metadata; delivery failures stay durable', async () => {
    const { service } = fixture(), event = signedEvent(); await service.acceptWebhook(event.payload, event.signature); await service.drain();
    expect(service.store.pending()).toEqual({ pending: 1, quarantined: 0 });
    expect(service.store.owner(customer.id)).toBeNull();
  });
  test('onChange is an atomic durable outbox, with stable at-least-once event IDs', async () => {
    const calls: string[] = []; let fail = true;
    const { scoped, service, db } = fixture({ onChange: async event => { calls.push(event.eventId); if (fail) throw new Error('fixture callback unavailable'); } });
    service.store.bind({ kind: 'user', id: 'user-fixture' }, customer.id); await scoped.reconcile(); await service.drain();
    expect(calls).toHaveLength(1); expect(service.store.pending().pending).toBe(1);
    fail = false; service.store.replay(calls[0]!); await service.drain(); expect(calls).toEqual([calls[0]!, calls[0]!]); expect(service.store.pending().pending).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM _zero_payments_inbox WHERE kind='notify'").get()).toMatchObject({ n: 1 });
  });
});

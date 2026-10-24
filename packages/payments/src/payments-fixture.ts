/** Synthetic Stripe HTTP fixtures. No secret environment reads or Stripe network access. */
import Stripe from 'stripe';
import { createHmac } from 'node:crypto';
import { createRequestAuthorizationAccess, AuthError } from '@zero/framework/auth';
import type { PaymentsAuthority } from '@zero/framework/payments';
import { applicationServiceDataScope } from '../../../src/auth/service-data-scope';
import type { PaymentsOptions } from './options';

export const customer = { id: 'cus_fixture', object: 'customer', livemode: false, email: 'fixture@example.test', name: 'Fixture' };
export function subscription(overrides: Record<string, unknown> = {}) {
  return { id: 'sub_fixture', object: 'subscription', livemode: false, customer: customer.id, status: 'active', cancel_at_period_end: false, cancel_at: null, trial_end: null,
    items: { object: 'list', has_more: false, data: [{ id: 'si_fixture', quantity: 1, price: { id: 'price_pro' }, current_period_end: Math.floor(Date.now() / 1000) + 3600 }] },
    latest_invoice: invoice(), ...overrides };
}
export function invoice(overrides: Record<string, unknown> = {}) { return { id: 'in_fixture', object: 'invoice', livemode: false, customer: customer.id, number: 'TEST-1', status: 'paid', total: 1900, amount_due: 1900, currency: 'usd', created: 12345, due_date: null, hosted_invoice_url: 'https://invoice.stripe.com/fixture', invoice_pdf: null, ...overrides }; }
export function payment(overrides: Record<string, unknown> = {}) { return { id: 'pi_fixture', object: 'payment_intent', livemode: false, customer: customer.id, status: 'succeeded', amount: 1900, amount_received: 1900, currency: 'usd', created: 12345, client_secret: 'must-never-escape', latest_charge: { id: 'ch_fixture', amount_refunded: 0 }, ...overrides }; }
export const fixtureOptions: PaymentsOptions = {
  mode: 'test', connectionId: 'fixture', accountId: 'acct_fixture', secretKey: 'sk_test_fixture', webhookSecrets: ['whsec_fixture'], policyVersion: 'v1', allowEphemeralTestMode: true,
  successUrl: 'https://app.example.test/billing/success?session_id={CHECKOUT_SESSION_ID}', cancelUrl: 'https://app.example.test/billing', portalReturnUrl: 'https://app.example.test/billing', allowedOrigins: ['https://app.example.test'],
  maxNetworkRetries: 0,
  catalog: { pro: { label: 'Pro', price: 'price_pro', kind: 'subscription', quantity: { min: 1, max: 20 }, features: { search: true, seats: 20 } }, credit: { label: 'Credits', price: 'price_credit', kind: 'payment' } },
};
export function authority(userId = 'user-fixture', role = 'user'): PaymentsAuthority & { revoke(): void } {
  let revoked = false;
  const assert = () => { if (revoked) throw new AuthError('Authority changed.', 'AUTH_FORBIDDEN', 403); };
  return { access: createRequestAuthorizationAccess({ authContext: { userId, email: `${userId}@example.test`, role }, kernel: null, assertCurrentProfile: assert }), scope: applicationServiceDataScope(), assertCurrentAuthoritySync: assert, assertCurrentAuthority: async () => assert(), revoke() { revoked = true; } };
}
export class StripeFixture {
  requests: { method: string; path: string; data: URLSearchParams; key: string | null }[] = [];
  handle?: (request: StripeFixture['requests'][number]) => Promise<Response | undefined> | Response | undefined;
  sub = subscription(); inv = invoice(); pay = payment(); accountId = 'acct_fixture'; customerCount = 0;
  httpClient: NonNullable<Stripe.StripeConfig['httpClient']> = Stripe.createFetchHttpClient(Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url), data = new URLSearchParams(await request.text());
    const record = { method: request.method, path: url.pathname, data, key: request.headers.get('idempotency-key') };
    this.requests.push(record);
    const special = await this.handle?.(record); if (special) return special;
    let value: unknown;
    if (record.path === '/v1/account') value = { id: this.accountId, object: 'account' };
    else if (record.path.startsWith('/v1/prices/')) value = { id: record.path.split('/').at(-1), object: 'price', livemode: false, active: true, unit_amount: 1900, currency: 'usd', recurring: record.path.endsWith('price_pro') ? { interval: 'month' } : null };
    else if (record.path === '/v1/customers' && record.method === 'POST') { this.customerCount++; value = { ...customer, id: this.customerCount === 1 ? customer.id : `cus_fixture${this.customerCount}` }; }
    else if (record.path.startsWith('/v1/customers/')) value = { ...customer, id: record.path.split('/').at(-1) };
    else if (record.path === '/v1/subscriptions') value = list([this.sub]);
    else if (record.path.startsWith('/v1/subscriptions/')) value = { ...this.sub, ...(record.method === 'DELETE' ? { status: 'canceled' } : record.data.has('cancel_at_period_end') ? { cancel_at_period_end: record.data.get('cancel_at_period_end') === 'true' } : {}) };
    else if (record.path === '/v1/invoices') value = list([this.inv]);
    else if (record.path === '/v1/invoices/create_preview' || record.path.startsWith('/v1/invoices/')) value = this.inv;
    else if (record.path === '/v1/payment_intents') value = list([this.pay]);
    else if (record.path.startsWith('/v1/payment_intents/')) value = this.pay;
    else if (record.path === '/v1/checkout/sessions') value = { id: 'cs_test_fixture', object: 'checkout.session', customer: customer.id, livemode: false, url: 'https://checkout.stripe.com/fixture', status: 'open' };
    else if (record.path.startsWith('/v1/checkout/sessions/')) value = { id: 'cs_test_fixture', customer: customer.id, livemode: false, payment_status: 'paid', status: 'complete' };
    else if (record.path === '/v1/billing_portal/sessions') value = { id: 'bps_fixture', object: 'billing_portal.session', url: 'https://billing.stripe.com/fixture' };
    else if (record.path === '/v1/refunds') { const refund = { id: 're_fixture', object: 'refund', payment_intent: this.pay.id, amount: Number(data.get('amount') ?? 1900), currency: 'usd', status: 'succeeded', created: 12345 }; value = record.method === 'POST' ? refund : list([refund]); }
    else if (record.path.startsWith('/v1/refunds/')) value = { id: record.path.split('/').at(-1), payment_intent: this.pay.id, amount: 500, currency: 'usd', status: 'succeeded', created: 12345 };
    else return Response.json({ error: { type: 'invalid_request_error', message: 'Unknown synthetic endpoint.' } }, { status: 404 });
    return Response.json(value, { headers: { 'request-id': 'req_fixture' } });
  }, { preconnect: fetch.preconnect }));
}
export const list = (data: unknown[]) => ({ object: 'list', has_more: false, data, url: '/fixture' });
export function signedEvent(overrides: Record<string, unknown> = {}, secret = 'whsec_fixture') {
  const payload = JSON.stringify({ id: 'evt_fixture', object: 'event', type: 'customer.subscription.updated', livemode: false, api_version: Stripe.API_VERSION, created: 100, data: { object: subscription() }, ...overrides });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
  return { payload, signature };
}

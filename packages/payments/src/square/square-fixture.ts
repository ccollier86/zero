/** Synthetic Square wire server for the real official SDK. No live credentials, provider accounts, network sends or application data. */
import { createHmac } from 'node:crypto';
import { createReactiveDB } from '@zero/framework/sync';
import { SquarePayments } from './service';
import type { SquarePaymentsOptions } from './options';
export { authority } from '../payments-fixture';
export const squareOptions: SquarePaymentsOptions = { mode: 'test', connectionId: 'square-fixture', merchantId: 'MERCHANT_FIXTURE', locationId: 'LOCATION_FIXTURE',
  accessToken: 'synthetic-square-access-token', webhookSignatureKeys: ['synthetic-square-signature-key'], webhookNotificationUrl: 'https://app.example.test/api/webhooks/square',
  policyVersion: 'v1', successUrl: 'https://app.example.test/billing', allowedOrigins: ['https://app.example.test'], allowEphemeralTestMode: true,
  catalog: { pro: { label: 'Pro', kind: 'subscription', planVariationId: 'PLAN_PRO', features: { search: true, seats: 20 } }, plus: { label: 'Plus', kind: 'subscription', planVariationId: 'PLAN_PLUS' }, credit: { label: 'Credits', kind: 'payment', itemVariationId: 'ITEM_CREDIT', quantity: { min: 1, max: 10 } } } };
export interface SquareRequest { method: string; path: string; body: Record<string, any>; headers: Headers; signal: AbortSignal }
const fixtureDay = (offset = 0) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
export class SquareFixture {
  requests: SquareRequest[] = []; customers = new Map<string, any>(); orders = new Map<string, any>(); payments = new Map<string, any>(); invoices = new Map<string, any>(); subscriptions = new Map<string, any>(); refunds = new Map<string, any>(); links = new Map<string, any>();
  merchantId = squareOptions.merchantId; locationId = squareOptions.locationId;
  handle?: (request: SquareRequest) => Response | undefined | Promise<Response | undefined>;
  dropAfter?: (request: SquareRequest) => boolean;
  private idempotent = new Map<string, unknown>();
  fetch: typeof globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(input, init), body = await request.text(), record = { method: request.method, path: new URL(request.url).pathname, body: body ? JSON.parse(body) : {}, headers: request.headers, signal: request.signal };
    this.requests.push(record); const override = await this.handle?.(record); if (override) return override;
    const value = this.respond(record); if (this.dropAfter?.(record)) throw new Error('Synthetic connection lost after provider processing');
    return value instanceof Response ? value : Response.json(value);
  }, { preconnect: globalThis.fetch.preconnect });
  private respond(request: SquareRequest): unknown {
    const { path, method, body } = request, key = body.idempotency_key ? method + ':' + path + ':' + body.idempotency_key : null;
    if (key && this.idempotent.has(key)) return this.idempotent.get(key);
    let result: unknown;
    const id = decodeURIComponent(path.split('/').at(-1)!);
    if (path.startsWith('/v2/merchants/')) result = { merchant: { id: this.merchantId, status: 'ACTIVE' } };
    else if (path.startsWith('/v2/locations/')) result = { location: { id: this.locationId, merchant_id: this.merchantId, status: 'ACTIVE', currency: 'USD', timezone: 'America/New_York', capabilities: ['CREDIT_CARD_PROCESSING'] } };
    else if (path === '/v2/customers' && method === 'POST') {
      const value = { id: 'CUSTOMER_' + (this.customers.size + 1), given_name: body.given_name, reference_id: body.reference_id }; this.customers.set(value.id, value); result = { customer: value };
    } else if (path.startsWith('/v2/customers/')) result = this.customers.has(id) ? { customer: this.customers.get(id) } : this.missing();
    else if (path.startsWith('/v2/catalog/object/')) result = { object: id.startsWith('PLAN_') ? { id, type: 'SUBSCRIPTION_PLAN_VARIATION', present_at_all_locations: true, subscription_plan_variation_data: { subscription_plan_id: 'BASE_PLAN', phases: [{ uid: 'PHASE_0', ordinal: 0, cadence: 'MONTHLY', pricing: { type: 'STATIC', price_money: { amount: 1900, currency: 'USD' } } }] } }
      : { id, type: 'ITEM_VARIATION', present_at_all_locations: true, item_variation_data: { item_id: 'BASE_ITEM', name: 'Credit', pricing_type: 'FIXED_PRICING', price_money: { amount: 100, currency: 'USD' } } } };
    else if (path === '/v2/online-checkout/payment-links' && method === 'POST') {
      const orderId = 'ORDER_' + (this.orders.size + 1), line = body.order.line_items[0], amount = (line.base_price_money?.amount ?? 100) * Number(line.quantity);
      const order = { ...body.order, id: orderId, state: 'DRAFT', created_at: new Date().toISOString(), total_money: { amount, currency: 'USD' } };
      this.orders.set(orderId, order); const link = { id: 'LINK_' + (this.links.size + 1), order_id: orderId, version: 1, url: 'https://sandbox.square.link/u/' + orderId, checkout_options: body.checkout_options, created_at: new Date().toISOString() };
      this.links.set(link.id, link); result = { payment_link: link, related_resources: { orders: [order] } };
    } else if (path.startsWith('/v2/online-checkout/payment-links/')) result = this.links.has(id) ? { payment_link: this.links.get(id) } : this.missing();
    else if (path === '/v2/payments' && method === 'POST') {
      const payment = { id: 'PAYMENT_' + (this.payments.size + 1), location_id: body.location_id, reference_id: body.reference_id, amount_money: body.amount_money, total_money: body.amount_money,
        status: 'COMPLETED', created_at: new Date().toISOString(), refunded_money: { amount: 0, currency: 'USD' }, refund_ids: [] }; this.payments.set(payment.id, payment); result = { payment };
    } else if (path.startsWith('/v2/payments/')) result = this.payments.has(id) ? { payment: this.payments.get(id) } : this.missing();
    else if (path === '/v2/orders/search') result = { orders: [...this.orders.values()].filter(value => body.query.filter.customer_filter.customer_ids.includes(value.customer_id)) };
    else if (path.startsWith('/v2/orders/')) result = this.orders.has(id) ? { order: this.orders.get(id) } : this.missing();
    else if (path === '/v2/subscriptions/search') result = { subscriptions: [...this.subscriptions.values()].filter(value => body.query.filter.customer_ids.includes(value.customer_id)) };
    else if (/\/v2\/subscriptions\/[^/]+\/swap-plan$/.test(path)) {
      const sub = this.subscriptions.get(path.split('/')[3]!); sub.actions ??= []; sub.actions.push({ id: 'SWAP_ACTION', type: 'SWAP_PLAN', new_plan_variation_id: body.new_plan_variation_id, effective_date: fixtureDay(31) }); result = { subscription: sub, actions: sub.actions };
    } else if (/\/v2\/subscriptions\/[^/]+\/cancel$/.test(path)) {
      const sub = this.subscriptions.get(path.split('/')[3]!); sub.actions ??= []; sub.actions.push({ id: 'CANCEL_ACTION', type: 'CANCEL', effective_date: fixtureDay(31) }); sub.canceled_date = fixtureDay(31); result = { subscription: sub, actions: sub.actions };
    } else if (/\/v2\/subscriptions\/[^/]+\/actions\//.test(path) && method === 'DELETE') {
      const sub = this.subscriptions.get(path.split('/')[3]!); sub.actions = sub.actions.filter((action: any) => action.id !== id); sub.canceled_date = null; result = { subscription: sub };
    } else if (path.startsWith('/v2/subscriptions/')) result = this.subscriptions.has(id) ? { subscription: this.subscriptions.get(id) } : this.missing();
    else if (path === '/v2/invoices/search') result = { invoices: [...this.invoices.values()].filter(value => body.query.filter.customer_ids.includes(value.primary_recipient.customer_id)) };
    else if (path.startsWith('/v2/invoices/')) result = this.invoices.has(id) ? { invoice: this.invoices.get(id) } : this.missing();
    else if (path === '/v2/refunds' && method === 'POST') {
      const payment = this.payments.get(body.payment_id), amount = Number(body.amount_money.amount);
      if (!payment || amount > Number(payment.total_money.amount) - Number(payment.refunded_money.amount)) return Response.json({ errors: [{ code: 'INVALID_REQUEST_ERROR', category: 'INVALID_REQUEST_ERROR' }] }, { status: 400 });
      const refund = { id: 'REFUND_' + (this.refunds.size + 1), payment_id: body.payment_id, location_id: this.locationId, amount_money: body.amount_money, status: 'COMPLETED', created_at: new Date().toISOString() };
      this.refunds.set(refund.id, refund); payment.refunded_money.amount += amount; payment.refund_ids.push(refund.id); result = { refund };
    } else if (path.startsWith('/v2/refunds/')) result = this.refunds.has(id) ? { refund: this.refunds.get(id) } : this.missing();
    else return this.missing();
    if (key && !(result instanceof Response)) this.idempotent.set(key, structuredClone(result)); return result;
  }
  private missing() { return Response.json({ errors: [{ code: 'NOT_FOUND', category: 'INVALID_REQUEST_ERROR', detail: 'Synthetic private provider detail' }] }, { status: 404 }); }
  complete(linkId: string, buyer = 'BUYER_SQUARE_CUSTOMER') {
    const link = this.links.get(linkId), template = this.orders.get(link.order_id), subscription = !!link.checkout_options?.subscription_plan_id;
    const paymentId = 'PAYMENT_' + (this.payments.size + 1), orderId = subscription ? 'INVOICE_ORDER_' + paymentId : template.id;
    const order = { ...template, id: orderId, state: 'COMPLETED', reference_id: subscription ? undefined : template.reference_id, tenders: [{ payment_id: paymentId, amount_money: template.total_money }] };
    this.orders.set(orderId, order);
    const payment = { id: paymentId, status: 'COMPLETED', location_id: this.locationId, order_id: orderId, customer_id: buyer, total_money: template.total_money, amount_money: template.total_money, refunded_money: { amount: 0, currency: 'USD' }, refund_ids: [], created_at: new Date().toISOString() }; this.payments.set(paymentId, payment);
    if (subscription) {
      const invoiceId = 'inv:INVOICE_' + paymentId, subId = 'SUB_' + paymentId;
      this.invoices.set(invoiceId, { id: invoiceId, order_id: orderId, location_id: this.locationId, status: 'PAID', primary_recipient: { customer_id: buyer }, invoice_number: '1001', timezone: 'America/New_York', created_at: new Date().toISOString(), public_url: 'https://squareup.com/pay-invoice/test', payment_requests: [{ computed_amount_money: template.total_money, completed_amount_money: template.total_money, due_date: fixtureDay() }] });
      this.subscriptions.set(subId, { id: subId, customer_id: buyer, location_id: this.locationId, plan_variation_id: link.checkout_options.subscription_plan_id, status: 'ACTIVE', charged_through_date: fixtureDay(30), start_date: fixtureDay(), created_at: new Date().toISOString(), timezone: 'America/New_York', invoice_ids: [invoiceId], phases: [{ ordinal: 0, order_template_id: template.id }], actions: [] });
      return { paymentId, orderId, invoiceId, subId };
    }
    return { paymentId, orderId, invoiceId: null, subId: null };
  }
  event(kind: string, id: string, eventId = 'event-' + crypto.randomUUID()) {
    const payload = JSON.stringify({ merchant_id: this.merchantId, type: kind, event_id: eventId, created_at: new Date().toISOString(), data: { type: kind.split('.')[0], id } });
    const signature = createHmac('sha256', squareOptions.webhookSignatureKeys![0]!).update(squareOptions.webhookNotificationUrl).update(payload).digest('base64');
    return { payload, signature };
  }
}
export function squareFixture(extra: Partial<SquarePaymentsOptions> = {}) {
  const db = createReactiveDB({ mode: 'memory', emitTelemetry: false }), fixture = new SquareFixture();
  const service = new SquarePayments(db, { ...squareOptions, fetch: fixture.fetch, ...extra });
  service.worker.wake = () => {}; // Unit tests explicitly drive durable drain; managed HTTP tests exercise the actual worker.
  return { db, fixture, service, async close() { await service.stop(); db.dispose(); } };
}
